import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const url=process.env.SHADOW_STAGE_URL;
assert(url,'Set SHADOW_STAGE_URL to the served candidate');
const out=path.resolve(process.env.SHADOW_STAGE_EVIDENCE||'test-artifacts/target-history');
await mkdir(out,{recursive:true});
const receipt={url,startedAt:new Date().toISOString(),checks:[],errors:[],screenshots:[],observations:{}};
let browser,page,fixture,importSequence=0;
async function waitFor(receiver,predicate,arg,{timeout=30000}={}){
 const deadline=Date.now()+timeout;
 while(true){
  if(await receiver.evaluate(predicate,arg))return;
  if(Date.now()>=deadline)throw new Error('Browser condition timed out: '+predicate.toString());
  await new Promise(resolve=>setTimeout(resolve,25));
 }
}
const project=()=>page.evaluate(()=>window.shadowStage.getProject());
const custody=p=>({scene:p.scene,construction:p.construction,lockedCutouts:p.lockedCutouts,lightShare:p.lightShare});
const history=()=>page.evaluate(()=>({undo:document.querySelector('#undoTargetEdit').disabled,redo:document.querySelector('#redoTargetEdit').disabled}));
async function targets(expected){await waitFor(page,expected=>JSON.stringify(window.shadowStage.getProject().targets)===expected,JSON.stringify(expected),{timeout:10000});}
async function ready(){await waitFor(page,()=>window.shadowStage&&document.querySelector('#solveButton')&&!document.querySelector('#solveButton').disabled,undefined,{timeout:60000});}
async function receive(p=fixture,name='history-fixture.json'){
 name=String(++importSequence).padStart(3,'0')+'-'+name;
 await page.locator('#importProject').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});
 await waitFor(page,name=>document.querySelector('#importProject').files.length===0&&document.querySelector('#notice').textContent.includes('Opened '+name),name);
 await targets(p.targets);await ready();assert.deepEqual(await history(),{undo:true,redo:true});
 return project();
}
async function undo(expected){assert(await page.locator('#undoTargetEdit').isEnabled());await page.locator('#undoTargetEdit').click();await targets(expected);}
async function redo(expected){assert(await page.locator('#redoTargetEdit').isEnabled());await page.locator('#redoTargetEdit').click();await targets(expected);}
async function shot(name){await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});receipt.screenshots.push(name+'.png');}
async function check(name,fn){await fn();receipt.checks.push({name,passed:true});console.log('PASS '+name);}
async function world(x,y){
 const canvas=page.locator('#stageCanvas');await canvas.scrollIntoViewIfNeeded();
 const box=await canvas.boundingBox();assert(box);const s=Math.min(box.width,box.height)*.365;
 return {x:box.x+box.width/2+x*s,y:box.y+box.height*.47-y*s};
}
async function drag(){
 await page.locator('#moveMode').click();const a=await world(0,0),b=await world(.19,.13);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();
}
async function draw(){
 await page.locator('#drawMode').click();
 const vertices=[[-.32,-.24],[.04,.37],[.35,-.24],[-.25,-.24]],first=await world(...vertices[0]);
 await page.mouse.move(first.x,first.y);await page.mouse.down();
 for(const vertex of vertices.slice(1)){const p=await world(...vertex);await page.mouse.move(p.x,p.y,{steps:8});}
 await page.mouse.up();
}
async function range(id){
 const input=page.locator('#'+id);await input.scrollIntoViewIfNeeded();
 const v=await input.evaluate(el=>({min:+el.min,max:+el.max,value:+el.value,type:el.type}));
 assert.equal(v.type,'range');const box=await input.boundingBox();assert(box);
 await input.evaluate(el=>{
  window.__rangeEvents=[];const record=e=>window.__rangeEvents.push(e.type);
  el.addEventListener('input',record);el.addEventListener('change',record);
  window.__rangeCleanup=()=>{el.removeEventListener('input',record);el.removeEventListener('change',record);};
 });
 const f=(v.value-v.min)/(v.max-v.min),inset=Math.min(9,box.width/8);
 const x=f=>box.x+inset+(box.width-2*inset)*f,y=box.y+box.height/2;
 try{await page.mouse.move(x(f),y);await page.mouse.down();await page.mouse.move(x(f<.55?.78:.22),y,{steps:14});await page.mouse.up();}
 finally{await input.evaluate(()=>{window.__rangeCleanup();delete window.__rangeCleanup;});}
 const events=await page.evaluate(()=>window.__rangeEvents);
 assert(events.filter(e=>e==='input').length>1,id+' must receive multiple native inputs');
 assert.equal(events.at(-1),'change',id+' native change ends the gesture');
}
async function cancelPointer(){
 await page.locator('#stageCanvas').dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse',isPrimary:true,bubbles:true});
 await page.mouse.up();
}
try{
 browser=await chromium.launch({headless:true,chromiumSandbox:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.addInitScript(()=>{
  const NativeWorker=window.Worker,log={nextId:1,created:[],posts:[],terminated:[],messages:[]};window.__historyWorkers=log;
  window.Worker=new Proxy(NativeWorker,{construct(Target,args){
   const worker=Reflect.construct(Target,args),id=log.nextId++;
   log.created.push({id,url:String(args[0])});
   const post=worker.postMessage,terminate=worker.terminate;
   worker.postMessage=function(...args){log.posts.push({id});return Reflect.apply(post,this,args);};
   worker.terminate=function(...args){log.terminated.push({id});return Reflect.apply(terminate,this,args);};
   worker.addEventListener('message',()=>log.messages.push({id}));return worker;
  }});
 });
 page=await context.newPage();page.on('pageerror',e=>receipt.errors.push(String(e)));
 await page.goto(url,{waitUntil:'domcontentloaded'});await ready();fixture=await project();
 assert(fixture.scene&&fixture.targets.length>1);await writeFile(path.join(out,'fixture.json'),JSON.stringify(fixture,null,2));
 await check('accessible Undo/Redo controls',async()=>{
  for(const [id,name] of [['undoTargetEdit','Undo target edit'],['redoTargetEdit','Redo target edit']])
   assert.equal(await page.getByRole('button',{name,exact:true}).getAttribute('id'),id);
 });
 await check('canvas move and drawing each restore in one step',async()=>{
  const a=await receive();await drag();const b=await project();assert.notDeepEqual(b.targets,a.targets);
  assert.deepEqual(custody(b),custody(a));await undo(a.targets);assert.equal((await history()).undo,true);await redo(b.targets);
  await draw();const c=await project();assert.notDeepEqual(c.targets,b.targets);
  await undo(b.targets);await undo(a.targets);await redo(b.targets);await redo(c.targets);
  assert.deepEqual(custody(await project()),custody(a));await shot('01-canvas-history');
 });
 await check('cancelled move commits once; cancelled drawing preserves redo',async()=>{
  const a=await receive();await page.locator('#moveMode').click();
  const from=await world(0,0),to=await world(.15,-.10);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});
  const b=await project();assert.notDeepEqual(b.targets,a.targets);await cancelPointer();await targets(b.targets);
  await undo(a.targets);assert.equal((await history()).undo,true);await redo(b.targets);await undo(a.targets);
  await page.locator('#drawMode').click();const p=await world(-.1,-.1),q=await world(.1,.1);
  await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(q.x,q.y);await cancelPointer();
  await targets(a.targets);assert.deepEqual(await history(),{undo:true,redo:false});await redo(b.targets);
  assert.deepEqual(custody(await project()),custody(a));
 });
 await check('separate slider gestures preserve their intermediate states and newer lighting',async()=>{
  const a=await receive();await range('targetX');const b=await project();assert.notDeepEqual(b.targets,a.targets);
  await range('targetX');const c=await project();assert.notDeepEqual(c.targets,b.targets);
  await undo(b.targets);await undo(a.targets);assert.equal((await history()).undo,true);await redo(b.targets);await redo(c.targets);
  await range('lightX');const physical=await project();assert.notDeepEqual(physical.scene,a.scene);
  await undo(b.targets);assert.deepEqual(custody(await project()),custody(physical));
  await redo(c.targets);assert.deepEqual(custody(await project()),custody(physical));
 });
 await check('add/remove restore exact key times, order and active selection',async()=>{
  const a=await receive(),aState=await page.evaluate(()=>window.shadowStage.getState());
  await page.locator('#addMoment').click();const b=await project(),bState=await page.evaluate(()=>window.shadowStage.getState());
  assert.equal(b.targets.length,a.targets.length+1);await undo(a.targets);
  assert.equal((await page.evaluate(()=>window.shadowStage.getState())).active,aState.active);
  await redo(b.targets);assert.equal((await page.evaluate(()=>window.shadowStage.getState())).active,bState.active);
  await page.locator('#removeMoment').click();const c=await project();assert.equal(c.targets.length,b.targets.length-1);
  await undo(b.targets);assert.equal((await page.evaluate(()=>window.shadowStage.getState())).active,bState.active);
  await redo(c.targets);assert.deepEqual(custody(await project()),custody(a));
 });
 await check('no-op preserves redo; an accepted new edit clears the old branch',async()=>{
  const a=await receive();await range('targetX');const b=await project();await range('targetY');const c=await project();
  assert.notDeepEqual(b.targets,a.targets);assert.notDeepEqual(c.targets,b.targets);await undo(b.targets);
  await page.locator('#targetY').evaluate(el=>{el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
  await targets(b.targets);assert.equal((await history()).redo,false);await redo(c.targets);await undo(b.targets);
  await range('targetScale');const d=await project();assert.notDeepEqual(d.targets,b.targets);assert.equal((await history()).redo,true);
  await page.locator('#moveMode').focus();await page.keyboard.press('Control+y');await targets(d.targets);
 });
 await check('Ctrl and Cmd history shortcuts preserve native editing ownership',async()=>{
  const a=await receive();await drag();const b=await project();assert.notDeepEqual(b.targets,a.targets);
  await page.locator('#moveMode').focus();
  for(const [key,expected] of [['Control+z',a.targets],['Control+Shift+z',b.targets],['Control+z',a.targets],['Control+y',b.targets]]){
   await page.keyboard.press(key);await targets(expected);
  }
  for(const [shiftKey,expected] of [[false,a.targets],[true,b.targets]]){
   const consumed=await page.locator('#moveMode').evaluate((el,shiftKey)=>!el.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,shiftKey,bubbles:true,cancelable:true})),shiftKey);
   assert.equal(consumed,true);await targets(expected);
  }
  const native=await page.locator('#duration').evaluate(el=>{
   return [{key:'z',ctrlKey:true},{key:'z',ctrlKey:true,shiftKey:true},{key:'y',ctrlKey:true},{key:'z',metaKey:true}].map(chord=>{
    const e=new KeyboardEvent('keydown',{...chord,bubbles:true,cancelable:true});el.dispatchEvent(e);return e.defaultPrevented;
   });
  });
  assert(native.every(v=>v===false));await targets(b.targets);await undo(a.targets);
 });
 await check('locked construction and later physical edits survive target Undo/Redo',async()=>{
  const locked=structuredClone(fixture);
  const original=locked.scene.occluder;
  locked.scene={format:'shadow-stage/articulated-v1',duration:locked.duration,light:locked.scene.light,occluders:[{id:'history-piece',vertices:original.vertices,keys:original.keys}]};
  locked.construction={mode:'pieces',maxPieces:1};locked.lockedCutouts=['history-piece'];locked.lightShare=.31;
  const a=await receive(locked,'locked-history-fixture.json');assert.deepEqual(a.lockedCutouts,['history-piece']);assert.equal(a.construction.mode,'pieces');assert.equal(a.scene.occluders.length,1);assert.equal(a.scene.occluders[0].id,'history-piece');assert.equal(a.construction.maxPieces,1);assert.equal(a.lightShare,.31);
  await range('targetAngle');const b=await project();assert.notDeepEqual(b.targets,a.targets);
  await range('lightX');const physical=await project();assert.notDeepEqual(physical.scene,a.scene);
  await undo(a.targets);assert.deepEqual(custody(await project()),custody(physical));
  await redo(b.targets);assert.deepEqual(custody(await project()),custody(physical));
 });
 await check('pending real solve is terminated across target edit and Undo',async()=>{
  const a=await receive();
  const race=await page.evaluate(()=>{
   const log=window.__historyWorkers,posts=log.posts.length,terminated=log.terminated.length;
   document.querySelector('#solveButton').click();
   const input=document.querySelector('#targetX');input.value='.24';
   input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
   const edited=window.shadowStage.getProject().targets,enabled=!document.querySelector('#undoTargetEdit').disabled;
   document.querySelector('#undoTargetEdit').click();
   return {posts:log.posts.slice(posts),terminated:log.terminated.slice(terminated),edited,enabled,after:window.shadowStage.getProject()};
  });
  assert(race.enabled);assert.notDeepEqual(race.edited,a.targets);assert.deepEqual(race.after.targets,a.targets);
  assert(race.posts.length>0);assert(race.terminated.some(t=>race.posts.some(p=>p.id===t.id)));
  await ready();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await targets(a.targets);assert.deepEqual(custody(await project()),custody(a));
  receipt.observations.workerRace=race;await shot('02-solver-cancellation');
 });
 await check('rejected import preserves history; successful import and New reset it',async()=>{
  const a=await receive();await drag();const b=await project();assert.equal((await history()).undo,false);
  await page.locator('#importProject').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  await waitFor(page,()=>document.querySelector('#notice').textContent.startsWith('Project was not opened:'));
  await targets(b.targets);assert.equal((await history()).undo,false);await undo(a.targets);await redo(b.targets);
  await receive();await drag();await page.locator('#newProject').click();await ready();
  assert.deepEqual(await history(),{undo:true,redo:true});const c=await project();
  await page.locator('#moveMode').focus();await page.keyboard.press('Control+z');await targets(c.targets);
 });
 await check('narrow controls remain visible, keyboard operable and within viewport',async()=>{
  await page.setViewportSize({width:390,height:844});const a=await receive();await drag();const b=await project();assert.notDeepEqual(b.targets,a.targets);
  for(const id of ['undoTargetEdit','redoTargetEdit']){const el=page.locator('#'+id);assert(await el.isVisible());const box=await el.boundingBox();assert(box&&box.width>0&&box.x>=-1&&box.x+box.width<=391);}
  await page.locator('#undoTargetEdit').focus();await page.keyboard.press('Enter');await targets(a.targets);
  await page.locator('#redoTargetEdit').focus();await page.keyboard.press('Enter');await targets(b.targets);
  const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  assert(layout.scrollWidth<=layout.width+1);assert.deepEqual(custody(await project()),custody(a));
  receipt.observations.narrowLayout=layout;await shot('03-narrow-history');
 });

 // Consumer receiving for the phone feedback surface. Existing history checks above stay intact.
 async function feedback(id='targetX'){
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  return page.evaluate(id=>{
   const stage=document.querySelector('#stageCanvas'),copy=document.querySelector('#phoneStageCanvas'),panel=document.querySelector('#phoneStagePreview'),input=document.getElementById(id);
   const rect=e=>{const b=e.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};
   const fraction=r=>Math.max(0,Math.min(innerWidth,r.right)-Math.max(0,r.left))*Math.max(0,Math.min(innerHeight,r.bottom)-Math.max(0,r.top))/(r.width*r.height);
   const a=stage.getContext('2d').getImageData(0,0,stage.width,stage.height).data,b=copy.getContext('2d').getImageData(0,0,copy.width,copy.height).data;
   let mismatches=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])mismatches++;
   const preview=rect(panel),control=rect(input),hit=document.elementFromPoint((control.left+control.right)/2,(control.top+control.bottom)/2);
   return {viewport:{width:innerWidth,height:innerHeight},rootFontSize:getComputedStyle(document.documentElement).fontSize,scrollY,preview,control,previewFraction:fraction(preview),controlFraction:fraction(control),controlHit:hit===input,focused:document.activeElement?.id,position:getComputedStyle(panel).position,dimensionsEqual:stage.width===copy.width&&stage.height===copy.height,pixelMismatches:mismatches,overlap:Math.min(preview.right,control.right)>Math.max(preview.left,control.left)&&Math.min(preview.bottom,control.bottom)>Math.max(preview.top,control.top),status:document.querySelector('#phoneStageStatus').textContent,state:window.shadowStage.getState()};
  },id);
 }
 function exactMirror(value){assert(value.dimensionsEqual);assert.equal(value.pixelMismatches,0,'Phone feedback must show the actual current stage, not a separately fitted or stale scene');}
 async function viewportShot(name){await page.screenshot({path:path.join(out,name+'.png'),fullPage:false,caret:'initial'});receipt.screenshots.push(name+'.png');}
 await check('phone transforms keep actual stage feedback and native controls visible without changing physical custody',async()=>{
  await page.setViewportSize({width:393,height:852});receipt.observations.phoneTransforms=[];
  for(const id of ['targetX','targetY','targetScale','targetAngle']){
   const original=await receive(),oldHistory=await history(),workers=await page.evaluate(()=>window.__historyWorkers.created.length);
   const input=page.locator('#'+id);await input.focus();const before=await feedback(id);
   assert.deepEqual(await project(),original,'Focus and preview visibility must not alter the project');assert.deepEqual(await history(),oldHistory);
   await input.press('ArrowRight');const changed=await project();assert.notDeepEqual(changed.targets,original.targets);
   assert.deepEqual(custody(changed),custody(original));assert.equal(await page.evaluate(()=>window.__historyWorkers.created.length),workers,'Preview and target editing must not implicitly fit');
   const observed=await feedback(id);exactMirror(observed);assert.equal(observed.focused,id);assert(observed.previewFraction>.99,'Phone feedback must be in viewport during transform editing');assert(observed.controlFraction>.99);assert(observed.controlHit,'Preview must not intercept the native slider');assert(!observed.overlap,'Feedback must not cover the edited control');
   assert.notEqual(await input.inputValue(),id==='targetScale'?'1':'0');
   receipt.observations.phoneTransforms.push({id,before,after:observed});await viewportShot('phone-'+id);
  }
  await page.locator('#targetX').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'targetY','Native keyboard navigation remains on the author controls');
 });
 await check('phone feedback tracks Undo Redo selected moments project reopen and New without becoming saved content',async()=>{
  const original=await receive();await page.locator('#targetX').focus();await page.locator('#targetX').press('ArrowRight');const edited=await project();exactMirror(await feedback());
  await undo(original.targets);exactMirror(await feedback());await redo(edited.targets);exactMirror(await feedback());
  await page.locator('#targetSelect').selectOption('1');exactMirror(await feedback());assert.equal((await page.evaluate(()=>window.shadowStage.getState())).active,1);assert.deepEqual(await project(),edited);
  const beforeNavigation=await project(),state=await page.evaluate(()=>window.shadowStage.getState()),oldHistory=await history();
  await page.locator('#targetX').focus();await page.getByRole('button',{name:'Edit on full stage',exact:true}).click();
  const navigation=await page.evaluate(()=>({focused:document.activeElement.id,state:window.shadowStage.getState(),box:document.querySelector('#stageCanvas').getBoundingClientRect().toJSON(),height:innerHeight}));
  assert.equal(navigation.focused,'stageCanvas');assert(navigation.box.bottom>0&&navigation.box.top<navigation.height);assert.deepEqual(navigation.state,state);assert.deepEqual(await project(),beforeNavigation);assert.deepEqual(await history(),oldHistory);
  const promised=page.waitForEvent('download');await page.locator('#saveProject').click();const download=await promised;const file=path.join(out,'phone-edited-project.json');await download.saveAs(file);assert.equal(await download.failure(),null);
  const saved=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(saved.targets,edited.targets);assert.deepEqual(saved.scene,edited.scene);assert(!JSON.stringify(saved).includes('phoneStage'),'Presentation-only feedback must not enter saved project');
  await receive(saved,'phone-edited-project.json');exactMirror(await feedback());
  // New scene is deliberately hidden on phones; exercise its real desktop entry then return.
  await page.setViewportSize({width:1440,height:1000});await page.locator('#newProject').click();await ready();
  await page.setViewportSize({width:393,height:852});exactMirror(await feedback());assert.deepEqual(await history(),{undo:true,redo:true});
  receipt.observations.phoneNavigation=navigation;
 });
 await check('phone native touch changes a target while feedback stays usable and has no alternate pointer editing path',async()=>{
  const previous=page,touchContext=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,deviceScaleFactor:1,acceptDownloads:true});
  page=await touchContext.newPage();page.on('pageerror',e=>receipt.errors.push(String(e)));
  const session=await touchContext.newCDPSession(page);
  try{
   await page.goto(url,{waitUntil:'domcontentloaded'});await ready();const original=await receive();
   const preview=page.locator('#phoneStageCanvas');await preview.scrollIntoViewIfNeeded();const previewBox=await preview.boundingBox();assert(previewBox);
   const previewState=await page.evaluate(()=>window.shadowStage.getState()),previewHistory=await history();
   await page.evaluate(()=>{window.__previewTouch=[];document.querySelector('#phoneStagePreview').addEventListener('pointerdown',e=>window.__previewTouch.push({trusted:e.isTrusted,pointerType:e.pointerType,target:e.target.id}));});
   const previewPoint={x:previewBox.x+previewBox.width/2,y:previewBox.y+previewBox.height/2};
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[previewPoint]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.evaluate(()=>new Promise(done=>requestAnimationFrame(done)));
   assert.deepEqual(await project(),original,'Touching the read-only preview must not edit the project');assert.deepEqual(await history(),previewHistory);assert.deepEqual(await page.evaluate(()=>window.shadowStage.getState()),previewState);
   const previewTouch=await page.evaluate(()=>window.__previewTouch);assert(previewTouch.some(e=>e.trusted&&e.pointerType==='touch'&&e.target!=='stageCanvas'),'Trusted touch stays on the read-only preview panel');
   const input=page.locator('#targetX');await input.scrollIntoViewIfNeeded();
   const box=await input.boundingBox();assert(box);const x=box.x+box.width*.7,y=box.y+box.height/2;
   await page.evaluate(()=>{window.__phoneTouch=[];for(const type of ['pointerdown','input','change'])document.querySelector('#targetX').addEventListener(type,e=>window.__phoneTouch.push({type:e.type,trusted:e.isTrusted,pointerType:e.pointerType||null}));});
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+10,y}]});
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await waitFor(page,p=>JSON.stringify(window.shadowStage.getProject().targets)!==p,JSON.stringify(original.targets));
   const changed=await project(),observed=await feedback();assert.deepEqual(custody(changed),custody(original));exactMirror(observed);assert(observed.previewFraction>.99&&observed.controlFraction>.99&&!observed.overlap&&observed.controlHit);
   const events=await page.evaluate(()=>window.__phoneTouch);assert(events.some(e=>e.type==='pointerdown'&&e.pointerType==='touch'&&e.trusted));assert(events.some(e=>e.type==='input'&&e.trusted));
   receipt.observations.phoneTouch={previewTouch,events,observed,scope:'Chromium native touch protocol simulation, not physical-device testing'};await viewportShot('phone-touch');
  }finally{await session.detach();await touchContext.close();page=previous;}
 });
 await check('phone preview survives a zero-size stage and recovers its exact pixels without changing state',async()=>{
  await page.setViewportSize({width:393,height:852});const original=await receive(),originalHistory=await history(),originalState=await page.evaluate(()=>window.shadowStage.getState());
  try{
   await page.evaluate(()=>document.querySelector('#stageCanvas').parentElement.style.display='none');
   await waitFor(page,()=>{const c=document.querySelector('#stageCanvas');return c.width===0&&c.height===0;});
   assert.deepEqual(await project(),original);assert.deepEqual(await history(),originalHistory);assert.deepEqual(await page.evaluate(()=>window.shadowStage.getState()),originalState);
  }finally{await page.evaluate(()=>document.querySelector('#stageCanvas').parentElement.style.removeProperty('display'));}
  await waitFor(page,()=>{const c=document.querySelector('#stageCanvas');return c.width>0&&c.height>0;});
  const observed=await feedback();exactMirror(observed);assert.deepEqual(await project(),original);assert.deepEqual(await history(),originalHistory);assert.deepEqual(await page.evaluate(()=>window.shadowStage.getState()),originalState);
  receipt.observations.zeroSizeRecovery={dimensionsEqual:observed.dimensionsEqual,pixelMismatches:observed.pixelMismatches,stateUnchanged:true,scope:'Explicit transient hidden-stage layout fixture; original natural trigger not established'};
 });
 await check('short viewport and enlarged text preserve uncovered controls full-stage navigation and desktop canvas editing',async()=>{
  receipt.observations.phoneFallbacks=[];
  for(const variant of [{width:700,height:400,fontSize:null},{width:393,height:852,fontSize:'32px'}]){
   await page.setViewportSize({width:variant.width,height:variant.height});await receive();
   // Explicit text-scale fixture; no product/CSP bypass and no assertion about a particular sticky design.
   if(variant.fontSize)await page.evaluate(size=>document.documentElement.style.fontSize=size,variant.fontSize);
   try{
    await page.locator('#targetAngle').focus();await page.locator('#targetAngle').press('ArrowRight');const observed=await feedback('targetAngle');if(variant.fontSize)assert.equal(observed.rootFontSize,variant.fontSize);exactMirror(observed);assert(observed.controlFraction>.99&&observed.controlHit&&!observed.overlap);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await viewportShot('phone-fallback-controls-'+variant.width+'-'+(variant.fontSize?'text':'short'));
    const original=await project(),state=await page.evaluate(()=>window.shadowStage.getState());
    await page.getByRole('button',{name:'Edit on full stage',exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement.id),'stageCanvas');assert.deepEqual(await project(),original);assert.deepEqual(await page.evaluate(()=>window.shadowStage.getState()),state);
    receipt.observations.phoneFallbacks.push({variant,observed});await viewportShot('phone-fallback-'+variant.width+'-'+(variant.fontSize?'text':'short'));
   }finally{if(variant.fontSize)await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));}
  }
  await page.setViewportSize({width:1440,height:1000});const original=await receive();assert.equal(await page.locator('#phoneStagePreview').isVisible(),false);await drag();const changed=await project();assert.notDeepEqual(changed.targets,original.targets);assert.deepEqual(custody(changed),custody(original));await undo(original.targets);
 });
 assert.deepEqual(receipt.errors,[]);receipt.passed=true;
}catch(error){
 receipt.passed=false;receipt.failure={message:error.message,stack:error.stack};process.exitCode=1;
 if(page)try{await shot('failure');receipt.observations.failureProject=await project();receipt.observations.failureState=await page.evaluate(()=>window.shadowStage.getState());}catch{}
}finally{
 receipt.finishedAt=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2));await browser?.close();
 console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,evidence:out,failure:receipt.failure?.message}));
}
