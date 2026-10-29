import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const base=process.env.SHADOW_STAGE_URL;
assert(base,'Set SHADOW_STAGE_URL to the served candidate');
const out=path.resolve(process.env.SHADOW_STAGE_EVIDENCE||'test-artifacts/motion-history');
await mkdir(out,{recursive:true});
const receipt={schema:'shadow-stage.motion-history-receiving.v1',startedAt:new Date().toISOString(),base,checks:[],errors:[],limits:['Integration receiving uses the maintained renderer; pixel agreement is not an independent geometry or artistic-quality assessment.','Phone viewport is browser simulation, not physical-device testing.']};
let browser,page;
const role=(p,name)=>p.locator('#transitionPanel [data-role="'+name+'"]');
const project=p=>p.evaluate(()=>window.shadowStage.getProject());
const state=p=>p.evaluate(()=>window.shadowStage.getTransitionState());
async function poll(p,predicate,arg,timeout=30000){const deadline=Date.now()+timeout;while(true){if(await p.evaluate(predicate,arg))return;if(Date.now()>=deadline)throw Error('Bounded browser condition timed out: '+predicate.toString());await new Promise(resolve=>setTimeout(resolve,25));}}
async function ready(p){await poll(p,()=>window.shadowStage?.getTransitionState&&!document.querySelector('#solveButton').disabled&&window.shadowStage.getProject().scene,undefined,60000);}
async function settled(p){await poll(p,()=>!window.shadowStage.getTransitionState().working,undefined,60000);}
async function shape(p){await role(p,'run').click();await settled(p);assert.equal((await state(p)).hasCandidate,true);}
async function motion(p){await role(p,'prepare-motion').click();await settled(p);const s=await state(p);assert.equal(s.motionMode,true);assert.ok(s.motionReport);return s;}
async function mirror(p){
 assert.equal(await p.locator('#phoneStagePreview').isVisible(),true);
 await p.locator('#phoneStagePreview').scrollIntoViewIfNeeded();
 await p.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 const observation=await p.evaluate(()=>{
  const a=document.querySelector('#stageCanvas'),b=document.querySelector('#phoneStageCanvas');
  const x=a.getContext('2d').getImageData(0,0,a.width,a.height).data,y=b.getContext('2d').getImageData(0,0,b.width,b.height).data;
  let different=0,nonuniform=false,opaque=false;for(let i=0;i<x.length;i++)if(x[i]!==y[i])different++;
  for(let i=0;i<y.length;i+=4){if(y[i+3]>0)opaque=true;if(y[i]!==y[0]||y[i+1]!==y[1]||y[i+2]!==y[2])nonuniform=true;}
  const rect=b.getBoundingClientRect();const inViewport=rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth;
  return {nonuniform,opaque,inViewport,sameDimensions:a.width===b.width&&a.height===b.height,different,overflow:document.documentElement.scrollWidth>innerWidth+1};
 });assert.equal(observation.inViewport,true);assert.equal(observation.opaque,true);assert.equal(observation.nonuniform,true,'Phone mirror must contain rendered variation, not blank matching canvases');assert.equal(observation.sameDimensions,true);assert.equal(observation.different,0);assert.equal(observation.overflow,false);return observation;
}
function attach(p){p.on('pageerror',e=>receipt.errors.push({type:'pageerror',message:String(e)}));p.on('console',m=>{if(m.type()==='error')receipt.errors.push({type:'console',message:m.text(),location:m.location()});});p.on('requestfailed',r=>receipt.errors.push({type:'requestfailed',url:r.url(),error:r.failure()?.errorText}));p.on('response',r=>{if(r.status()>=400)receipt.errors.push({type:'http',url:r.url(),status:r.status()});});}
try{
 browser=await chromium.launch({headless:true,chromiumSandbox:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const cdp=await browser.newBrowserCDPSession(),command=await cdp.send('Browser.getBrowserCommandLine');assert.equal(command.arguments.some(x=>['--no-sandbox','--disable-setuid-sandbox'].includes(x)),false);
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.addInitScript(()=>{
  window.__motionHistoryWorkers=[];window.__motionHistoryCSP=[];
  document.addEventListener('securitypolicyviolation',e=>window.__motionHistoryCSP.push(e.effectiveDirective));
  const Native=window.Worker;window.Worker=class extends Native{
   constructor(...args){super(...args);this.receipt={modes:[],terminated:false};window.__motionHistoryWorkers.push(this.receipt);}
   postMessage(data,...rest){this.receipt.modes.push(data?.mode);return super.postMessage(data,...rest);}
   terminate(){this.receipt.terminated=true;return super.terminate();}
  };
 });
 page=await context.newPage();attach(page);await page.goto('chrome://sandbox');receipt.sandbox=await page.locator('body').innerText();assert.match(receipt.sandbox,/Seccomp-BPF sandbox\s+Yes/i);
 await page.goto(base);await ready(page);await page.selectOption('#presetSelect','shape-change');await ready(page);
 await page.selectOption('#constructionMode','pieces');await page.selectOption('#pieceBudget','24');await page.click('#solveButton');await ready(page);
 let original=await project(page);assert.equal(original.scene.format,'shadow-stage/articulated-v1');
 original.authoring={status:'proposed',original:{title:'Motion-history receiving source',duration:original.duration,targets:structuredClone(original.targets),scene:structuredClone(original.scene)},evidence:{provider:'Controlled receiving fixture, not inference',executed:false}};
 await page.locator('#importProject').setInputFiles({name:'motion-history-source.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});
 await poll(page,()=>document.querySelector('#importProject').files.length===0&&document.querySelector('#notice').textContent.includes('Opened motion-history-source.json'));
 await ready(page);original=await project(page);assert.equal(original.authoring.original.title,'Motion-history receiving source');
 // A real target gesture creates history before motion refinement/adoption.
 await page.locator('#targetX').focus();await page.locator('#targetX').press('ArrowRight');await page.locator('#targetX').press('Tab');
 const edited=await project(page);assert.notDeepEqual(edited.targets,original.targets);assert.equal(await page.locator('#undoTargetEdit').isEnabled(),true);
 await shape(page);const proposed=await motion(page);assert.deepEqual(await project(page),edited);
 await role(page,'adopt').click();await poll(page,()=>window.shadowStage.getTransitionState().hasSessionUndo&&!window.shadowStage.getTransitionState().adopting);
 const adopted=await project(page);assert.deepEqual(adopted.scene,proposed.candidate);assert.deepEqual(adopted.targets,edited.targets);assert.deepEqual(adopted.authoring,edited.authoring);assert.deepEqual(adopted.lockedCutouts,edited.lockedCutouts);
 await page.setViewportSize({width:393,height:852});await page.locator('#targetX').focus();await mirror(page);
 await page.click('#undoTargetEdit');const undone=await project(page);assert.deepEqual(undone.targets,original.targets);assert.deepEqual(undone.scene,adopted.scene);assert.deepEqual(undone.authoring,adopted.authoring);
 assert.equal((await state(page)).stale,true);assert.equal(await role(page,'undo').isDisabled(),true);assert.equal(await role(page,'adopt').isDisabled(),true);await mirror(page);
 await page.click('#redoTargetEdit');assert.deepEqual((await project(page)).targets,edited.targets);assert.deepEqual((await project(page)).scene,adopted.scene);await mirror(page);
 await page.screenshot({path:path.join(out,'motion-history-phone.png'),fullPage:true});
 await page.screenshot({path:path.join(out,'motion-history-phone-viewport.png')});
 receipt.checks.push({name:'Target Undo/Redo retains adopted motion and source custody, invalidates stale motion actions and updates exact phone stage feedback',passed:true});

 const pendingDownload=page.waitForEvent('download');await page.click('#saveProject');const downloaded=await pendingDownload;
 const file=path.join(out,'motion-with-target-history.json');await downloaded.saveAs(file);assert.equal(await downloaded.failure(),null);
 const saved=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(saved.scene,adopted.scene);assert.deepEqual(saved.targets,edited.targets);assert.deepEqual(saved.authoring,adopted.authoring);
 const fresh=await context.newPage();attach(fresh);await fresh.setViewportSize({width:393,height:852});await fresh.goto(base);await ready(fresh);
 await fresh.locator('#importProject').setInputFiles(file);
 await poll(fresh,expected=>JSON.stringify(window.shadowStage.getProject().scene)===expected,JSON.stringify(saved.scene));
 assert.deepEqual((await project(fresh)).targets,saved.targets);assert.deepEqual((await project(fresh)).authoring,saved.authoring);assert.equal(await fresh.locator('#undoTargetEdit').isDisabled(),true);assert.equal((await state(fresh)).hasSessionUndo,false);await mirror(fresh);
 receipt.checks.push({name:'Actual downloaded combined project reopens at phone width with identical targets/physical scene and no inherited session undo',passed:true});

 await page.bringToFront();await page.setViewportSize({width:1440,height:1000});await shape(page);
 const before=await project(page);
 const pending=await page.evaluate(()=>{
  document.querySelector('#transitionPanel [data-role="prepare-motion"]').click();
  const working=window.shadowStage.getTransitionState().working;
  document.querySelector('#undoTargetEdit').click();return working;
 });assert.equal(pending,true);
 const worker=await page.evaluate(()=>window.__motionHistoryWorkers.filter(w=>w.modes.includes('motion')).at(-1));assert.equal(worker.terminated,true);
 const cancelled=await project(page);assert.deepEqual(cancelled.targets,original.targets);assert.deepEqual(cancelled.scene,before.scene);
 assert.equal((await state(page)).working,false);assert.equal(await role(page,'adopt').isDisabled(),true);
 await page.waitForTimeout(150);assert.deepEqual(await project(page),cancelled);
 await page.click('#redoTargetEdit');assert.deepEqual((await project(page)).targets,before.targets);assert.deepEqual((await project(page)).scene,before.scene);
 receipt.checks.push({name:'Same-turn target Undo terminates pending native motion work; no replacement observed after cancellation and target Redo remains usable',passed:true,worker});
 for(const p of [page,fresh])assert.deepEqual(await p.evaluate(()=>window.__motionHistoryCSP),[]);
 assert.deepEqual(receipt.errors,[]);receipt.passed=true;
}catch(error){receipt.passed=false;receipt.failure={message:error.message,stack:error.stack};process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'motion-history-failure.png'),fullPage:true}).catch(()=>{});}
finally{receipt.finishedAt=new Date().toISOString();await writeFile(path.join(out,'motion-history-receiving.json'),JSON.stringify(receipt,null,2)+'\n');await browser?.close();console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,evidence:out,failure:receipt.failure?.message}));}
