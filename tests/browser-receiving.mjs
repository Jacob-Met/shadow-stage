import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

// Execute against the real maintained HTTP entry point, with Playwright installed
// on the receiving host. Screenshots are evidence for separate human/model review.
const url=process.env.SHADOW_STAGE_URL||'http://127.0.0.1:4173';
const out=path.resolve(process.env.SHADOW_STAGE_EVIDENCE||'test-artifacts/receiving');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,chromiumSandbox:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await context.newPage();
await page.addInitScript(function observeNativeWorkers(){
  const NativeWorker=window.Worker,records=[];
  Object.defineProperty(window,'__receivingWorkers',{value:records});
  function ObservedWorker(...args){
    if(!new.target)throw new TypeError('Worker constructor requires new');
    const worker=Reflect.construct(NativeWorker,args,new.target===ObservedWorker?NativeWorker:new.target);
    const record={id:records.length,url:String(args[0]),posts:[],terminated:0};records.push(record);
    const post=worker.postMessage,terminate=worker.terminate;
    worker.postMessage=function(...values){
      const result=Reflect.apply(post,this,values),message=values[0];
      record.posts.push({mode:message?.mode??message?.type??message?.action??null});
      return result;
    };
    worker.terminate=function(...values){const result=Reflect.apply(terminate,this,values);record.terminated++;return result;};
    return worker;
  }
  ObservedWorker.prototype=NativeWorker.prototype;Object.setPrototypeOf(ObservedWorker,NativeWorker);window.Worker=ObservedWorker;
});
const errors=[];
page.on('pageerror',e=>errors.push(String(e)));
const checks=[];
const record=(name,details={})=>checks.push({name,passed:true,...details});
const project=()=>page.evaluate(()=>window.shadowStage.getProject());
const pixels=()=>page.locator('#stageCanvas').evaluate(c=>c.toDataURL('image/png'));
const digest=value=>createHash('sha256').update(value).digest('hex');
const renderState=()=>page.evaluate(()=>{
  const c=document.querySelector('#stageCanvas'),ctx=c.getContext('2d'),r=c.getBoundingClientRect();
  return {state:window.shadowStage.getState(),width:c.width,height:c.height,rect:{width:r.width,height:r.height,x:r.x,y:r.y},
    dpr:devicePixelRatio,showTarget:document.querySelector('#showTarget').checked,showTrail:document.querySelector('#showTrail').checked,
    context:{font:ctx.font,lineWidth:ctx.lineWidth,lineDash:ctx.getLineDash(),transform:Array.from(ctx.getTransform().toFloat64Array()),globalAlpha:ctx.globalAlpha,globalCompositeOperation:ctx.globalCompositeOperation}};
});
async function waitFor(check,arg,receiver=page,timeout=5000){
  const deadline=Date.now()+timeout;
  do {if(await receiver.evaluate(check,arg))return;await delay(25);}while(Date.now()<deadline);
  throw new Error(`Receiving condition did not become true within ${timeout}ms: ${check.toString()}`);
}
async function time(t) {
  await page.evaluate(t=>window.shadowStage.setTime(t),t);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function solve(){
 await page.locator('#solveButton').click();
 await waitFor(()=>!document.querySelector('#solveButton').disabled,undefined,page,30000);
}
async function nudge(selector) {
  const control=page.locator(selector);
  await control.focus();
  const initial=await control.inputValue();
  const max=await control.getAttribute('max');
  const direction=max!==null&&Number(initial)>=Number(max)?'ArrowLeft':'ArrowRight';
  for(let i=0;i<8;i++)await control.press(direction);
  assert.notEqual(await control.inputValue(),initial,`${selector} responds to actual keyboard input`);
}
try {
  await page.goto(url,{waitUntil:'networkidle'});
  await waitFor(()=>Boolean(window.shadowStage?.getProject && window.shadowStage?.setTime));
  for(const selector of ['#stageCanvas','#rigCanvas','#solveButton','#playButton','#timeline','#targetSelect',
    '#targetX','#lightX','#saveProject','#importProject','#newProject','#fitStatus','#modelStatus']) {
    assert.equal(await page.locator(selector).count(),1,`Required consumer control ${selector}`);
  }
  await solve();
  await time(.37);
  await page.screenshot({path:path.join(out,'01-initial-stage.png'),fullPage:true});

  const balanceRace=await page.evaluate(()=>{
    const before=window.shadowStage.getProject(),records=window.__receivingWorkers,start=records.length;
    document.querySelector('#solveButton').click();
    const jobs=records.slice(start).filter(r=>r.posts.some(p=>p.mode==='single'));
    if(jobs.length!==1||jobs[0].terminated!==0)throw new Error('Expected one live native single-cutout solve');
    if(!document.querySelector('#solveButton').disabled)throw new Error('Solve must be admitted before changing balance');
    const input=document.querySelector('#lightShare'),chosen=Number(input.value)>.5?.25:.75;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(chosen));
    input.dispatchEvent(new Event('input',{bubbles:true}));
    return {before,after:window.shadowStage.getProject(),chosen,job:structuredClone(jobs[0])};
  });
  assert.ok(balanceRace.job.terminated>0,'Motion-balance edit must terminate the older real worker');
  assert.deepEqual(balanceRace.after.scene,balanceRace.before.scene,'Cancelled solve preserves the prior physical scene');
  assert.deepEqual(balanceRace.after.targets,balanceRace.before.targets);
  await time(.37);
  assert.deepEqual((await project()).scene,balanceRace.before.scene);
  await solve();
  const balanceSolved=await project();
  assert.equal(balanceSolved.lightShare,balanceRace.chosen,'Committed configuration must match the dispatched solve');
  assert.notDeepEqual(balanceSolved.scene,balanceRace.before.scene,'Changed motion balance changes the physical mechanism');
  assert.deepEqual(balanceSolved.targets,balanceRace.before.targets);
  record('motion-balance edit cancels pending solve and next fit commits captured configuration',{worker:balanceRace.job,lightShare:balanceSolved.lightShare});

  const initial=await project();
  assert.ok(initial.targets?.length>=2 && initial.scene,'Fresh project has authored sequence and physical scene');
  const options=page.locator('#targetSelect option');
  assert.ok(await options.count()>=2,'Timeline exposes multiple authored targets');
  await page.locator('#targetSelect').selectOption({index:1});
  await nudge('#targetX');
  const edited=await project();
  assert.notDeepEqual(edited.targets,initial.targets,'Target authoring changes the stored target');
  await solve();
  await time(.37);
  const solved=await project();
  assert.deepEqual(solved.targets,edited.targets,'Solve preserves authored targets');
  assert.notDeepEqual(solved.scene,initial.scene,'Changed authored sequence produces a changed physical scene');
  assert.ok((await page.locator('#fitStatus').innerText()).trim().length>0,'Fit status communicates actual result');
  record('edit target and synthesize without substituting authored targets');

  const beforeLightPixels=await pixels();
  await nudge('#lightX');
  await time(.37);
  const physicalEdit=await project();
  assert.deepEqual(physicalEdit.targets,solved.targets,'Physical editing preserves desired targets');
  assert.notDeepEqual(physicalEdit.scene,solved.scene,'Light control changes the exported physical scene');
  assert.notEqual(await pixels(),beforeLightPixels,'Physical edit changes rendered stage pixels');
  await page.screenshot({path:path.join(out,'02-physical-edit.png'),fullPage:true});
  record('physical light edit affects the real stage canvas');

  await time(.2);
  const start=Number(await page.locator('#timeline').inputValue());
  await page.locator('#playButton').click();
  await waitFor(start=>Math.abs(Number(document.querySelector('#timeline').value)-start)>.015,start);
  await page.locator('#playButton').click();
  record('continuous playback advances actual timeline');

  await time(.37);
  const expected=await project(),expectedPixels=await pixels(),expectedRenderState=await renderState();
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#saveProject').click();
  const download=await downloadPromise;
  const exported=path.join(out,'exported-project.json');
  await download.saveAs(exported);
  // A fresh document proves the scene can be received without live solver state.
  await page.reload({waitUntil:'networkidle'});
  await waitFor(()=>Boolean(window.shadowStage?.getProject));
  await page.locator('#newProject').click();
  await page.locator('#importProject').setInputFiles(exported);
  await waitFor(expected=>JSON.stringify(window.shadowStage.getProject().scene)===JSON.stringify(expected.scene),expected);
  await time(.37);
  const reopened=await project();
  assert.equal(await page.locator('#presetSelect').inputValue(),'current','Imported project must not be mislabeled as a built-in preset');
  assert.deepEqual(reopened.targets,expected.targets);
  assert.deepEqual(reopened.scene,expected.scene);
  const actualPixels=await pixels();
  if(actualPixels!==expectedPixels){
    const diagnostics={expectedHash:digest(expectedPixels),actualHash:digest(actualPixels),expected:expectedRenderState,actual:await renderState()};
    await writeFile(path.join(out,'exported-before.png'),Buffer.from(expectedPixels.split(',')[1],'base64'));
    await writeFile(path.join(out,'import-after.png'),Buffer.from(actualPixels.split(',')[1],'base64'));
    await writeFile(path.join(out,'render-difference.json'),JSON.stringify(diagnostics,null,2));
    assert.ok(false,`Fresh import must render identical pixels: ${diagnostics.expectedHash} != ${diagnostics.actualHash}; see render-difference.json`);
  }
  await page.screenshot({path:path.join(out,'03-reopened-stage.png'),fullPage:true});
  record('actual download, fresh document, file import and identical canvas replay');

  // Queue a refit and immediately receive the deliberately hand-edited scene.
  // Its asynchronous file read must invalidate the older scheduled solver commit.
  await page.evaluate(p=>{
    document.querySelector('#solveButton').click();
    const input=document.querySelector('#importProject'),transfer=new DataTransfer();
    transfer.items.add(new File([JSON.stringify(p)],'queued-receiving.json',{type:'application/json'}));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  },expected);
  await waitFor(()=>document.querySelector('#notice').textContent.includes('queued-receiving.json'));
  await time(.37);
  assert.deepEqual((await project()).scene,expected.scene,'An earlier queued solve cannot replace imported physical edits');
  record('queued solve cannot overwrite incoming project');

  const singleton=structuredClone(expected);singleton.targets=[singleton.targets[0]];
  const singletonPath=path.join(out,'singleton-project.json');
  await writeFile(singletonPath,JSON.stringify(singleton));
  await page.locator('#importProject').setInputFiles(singletonPath);
  await waitFor(()=>window.shadowStage.getProject().targets.length===1);
  await page.locator('#addMoment').click();
  const expanded=await project();
  assert.equal(expanded.targets.length,2,'A valid singleton import can add its next authored moment');
  assert.ok(expanded.targets[1].t>expanded.targets[0].t,'Added moment has a distinct increasing time');
  record('singleton project import can add another moment');
  await page.locator('#importProject').setInputFiles(exported);
  await waitFor(expected=>JSON.stringify(window.shadowStage.getProject().targets)===JSON.stringify(expected.targets),expected);
  await time(.37);

  async function receiveOfflinePlayer(expected,label){
  const playerDownloadPromise=page.waitForEvent('download');
  await page.locator('#exportPlayer').click();
  const playerDownload=await playerDownloadPromise;
  const playerFile=path.join(out,label+'-player.html');
  await playerDownload.saveAs(playerFile);
  const offlineContext=await browser.newContext({offline:true,viewport:{width:1100,height:900}});
  const player=await offlineContext.newPage();
  const playerErrors=[];player.on('pageerror',e=>playerErrors.push(String(e)));
  await player.goto(pathToFileURL(playerFile).href,{waitUntil:'load'});
  await player.locator('#seek').evaluate(input=>{input.value='.37';input.dispatchEvent(new Event('input',{bubbles:true}));});
  const mask=await player.evaluate(()=>{
    const scene=window.shadowStageScene,t=.37;
    function pose(keys,fields){
      let i=0;while(i<keys.length-1&&keys[i+1].t<t)i++;
      const a=keys[i],b=keys[Math.min(i+1,keys.length-1)];
      let u=a.t===b.t?0:Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t)));u=u*u*(3-2*u);
      return Object.fromEntries(fields.map(f=>{let delta=b[f]-a[f];if(f==='angle')delta=Math.atan2(Math.sin(delta),Math.cos(delta));return [f,a[f]+u*delta];}));
    }
    const light=pose(scene.light.keys,['x','y','z']);
    const polygons=(scene.occluders||[scene.occluder]).map(piece=>{
      const cutout=pose(piece.keys,['x','y','z','angle']);
      return piece.vertices.map(([x,y])=>{
        const vx=cutout.x+x*Math.cos(cutout.angle)-y*Math.sin(cutout.angle);
        const vy=cutout.y+x*Math.sin(cutout.angle)+y*Math.cos(cutout.angle);
        const distance=light.z/(light.z-cutout.z);
        return [500+(light.x+distance*(vx-light.x))*260,350-(light.y+distance*(vy-light.y))*260];
      });
    });
    function inside(x,y){return polygons.some(polygon=>{let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;});}
    function edgeDistance(x,y){return Math.min(...polygons.flatMap(polygon=>polygon.map((a,i)=>{const b=polygon[(i+1)%polygon.length],dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy,u=d?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/d)):0;return Math.hypot(x-a[0]-u*dx,y-a[1]-u*dy);})))}
    const c=document.querySelector('#screen'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let total=0,mismatch=0,shadow=0;
    for(let y=4;y<c.height;y+=8)for(let x=4;x<c.width;x+=8){if(edgeDistance(x+.5,y+.5)<2)continue;const offset=4*(y*c.width+x),dark=data[offset]<80&&data[offset+1]<100&&data[offset+2]<90;const expected=inside(x+.5,y+.5);total++;if(dark)shadow++;if(dark!==expected)mismatch++;}
    return {scene,total,mismatch,shadow,width:c.width,height:c.height};
  });
  assert.deepEqual(mask.scene,expected.scene,'Standalone player contains the actual exported physical scene');
  assert.ok(mask.shadow>20 && mask.total>1000,'Mask comparison includes actual foreground and background');
  assert.ok(mask.mismatch/mask.total<.002,`Offline player fails independent ray/mask oracle: ${mask.mismatch}/${mask.total}`);
  assert.deepEqual(playerErrors,[]);
  await player.screenshot({path:path.join(out,label+'-offline-player.png'),fullPage:true});
  await player.locator('#play').click();
  await waitFor(()=>Math.abs(Number(document.querySelector('#seek').value)-.37)>.015,undefined,player);
  await player.locator('#play').click();
  await offlineContext.close();
  record(label+': offline standalone HTML independently matches ray-projected shadow mask',{samples:mask.total,mismatches:mask.mismatch});
  }
  await receiveOfflinePlayer(expected,'04-planar');
  await page.locator('#presetSelect').selectOption('shape-change');
  await waitFor(()=>!document.querySelector('#solveButton').disabled,undefined,page,30000);
  await page.locator('#constructionMode').selectOption('pieces');
  await page.locator('#pieceBudget').selectOption('1');
  await solve();
  const constrained=await project(),lowBudgetState=await page.evaluate(()=>window.shadowStage.getState());
  assert.equal(constrained.scene.format,'shadow-stage/articulated-v1');
  assert.equal(constrained.scene.occluders.length,1);
  assert.ok(lowBudgetState.report.authoredMaskError>.08,'Insufficient geometry remains a visible residual');
  await page.locator('#pieceBudget').selectOption('24');
  await solve();
  const articulated=await project(),multiState=await page.evaluate(()=>window.shadowStage.getState());
  assert.deepEqual(articulated.targets,constrained.targets,'Additional geometry preserves authored request');
  assert.ok(articulated.scene.occluders.length>1&&articulated.scene.occluders.length<=24);
  assert.ok(multiState.report.authoredMaskError<lowBudgetState.report.authoredMaskError*.8,'Multi-piece construction improves same distinct silhouettes');
  await time(.37);
  await page.screenshot({path:path.join(out,'05-articulated-stage.png'),fullPage:true});
  record('distinct silhouettes improve with persistent multi-piece construction',{onePieceError:lowBudgetState.report.authoredMaskError,multiPieceError:multiState.report.authoredMaskError,pieces:articulated.scene.occluders.length});
  await page.locator('#cutoutSelect').selectOption({index:0});
  await nudge('#cutoutX');
  const editedRig=await project();
  assert.deepEqual(editedRig.targets,articulated.targets);
  assert.notDeepEqual(editedRig.scene,articulated.scene,'Selected physical cutout is editable');
  await page.locator('#lockCutout').check();
  const locked=await project();
  assert.ok(Array.isArray(locked.lockedCutouts)&&locked.lockedCutouts.length>0);
  const lockedPieces=locked.scene.occluders.filter(p=>locked.lockedCutouts.includes(p.id));
  assert.ok(lockedPieces.length>0);
  await page.locator('#refineButton').click();
  await waitFor(()=>!document.querySelector('#refineButton').disabled,undefined,page,30000);
  const refined=await project(),refineState=await page.evaluate(()=>window.shadowStage.getState());
  assert.match(refineState.report.optimization.method,/coordinate search/i,'Successful completion must report actual refinement');
  assert.ok(refineState.report.optimization.work.candidateAttempts>0,'Refinement must attempt candidates');
  assert.ok(refineState.report.optimization.work.candidateRasterEvaluations>0,'Refinement must evaluate actual candidate masks');
  for(const p of lockedPieces)assert.deepEqual(refined.scene.occluders.find(q=>q.id===p.id),p,'Refinement preserves exact locked physical track and mesh');
  assert.deepEqual(refined.targets,locked.targets);
  record('selected cutout edit and exact lock survive real refinement',{work:refineState.report.optimization.work});

  await page.locator('#cutoutSelect').selectOption({index:1});
  for(const change of ['physical','lock']){
    const race=await page.evaluate(change=>{
      const before=window.shadowStage.getProject(),records=window.__receivingWorkers,start=records.length;
      document.querySelector('#refineButton').click();
      const jobs=records.slice(start).filter(r=>r.posts.length>0);
      if(jobs.length!==1)throw new Error('Refinement must post one job to one actual native worker');
      const job=jobs[0];
      if(job.terminated!==0)throw new Error('Original worker must be live before the edit');
      if(!document.querySelector('#refineButton').disabled)throw new Error('Refinement admission must disable its control');
      if(change==='physical'){
        const input=document.querySelector('#cutoutX');
        if(input.disabled)throw new Error('Physical edit must be available during refinement');
        const value=Number(input.value),step=Number(input.step)||.01,next=value+step<=Number(input.max)?value+step:value-step;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(next));
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.dispatchEvent(new Event('change',{bubbles:true}));
      }else{
        const input=document.querySelector('#lockCutout');
        if(input.disabled)throw new Error('Lock edit must be available during refinement');input.click();
      }
      return {before,after:window.shadowStage.getProject(),job:structuredClone(job)};
    },change);
    assert.ok(race.job.terminated>0,'The original real worker must be terminated by the newer edit');
    if(change==='physical')assert.notDeepEqual(race.after.scene,race.before.scene,'Race must exercise an actual newer physical edit');
    else assert.notDeepEqual(race.after.lockedCutouts,race.before.lockedCutouts,'Race must exercise an actual newer lock change');
    assert.deepEqual(race.after.targets,race.before.targets);
    await time(.37);
    const surviving=await project();
    assert.deepEqual(surviving.scene,race.after.scene,'Cancelled refinement cannot replace the newer scene');
    assert.deepEqual(surviving.targets,race.after.targets);
    assert.deepEqual(surviving.lockedCutouts,race.after.lockedCutouts,'Cancelled refinement cannot replace the newer locks');
    record(`same-project ${change} edit terminates original native refinement worker`,{worker:race.job});
  }

  await time(.37);
  const multiExpected=await project(),multiPixels=await pixels();
  const multiDownloadPromise=page.waitForEvent('download');
  await page.locator('#saveProject').click();
  const multiDownload=await multiDownloadPromise,multiFile=path.join(out,'articulated-project.json');
  await multiDownload.saveAs(multiFile);
  await page.reload({waitUntil:'networkidle'});
  await waitFor(()=>Boolean(window.shadowStage?.getProject));
  await page.locator('#importProject').setInputFiles(multiFile);
  await waitFor(expected=>JSON.stringify(window.shadowStage.getProject().scene)===JSON.stringify(expected.scene),multiExpected);
  await time(.37);
  const multiReopened=await project();
  assert.equal(await page.locator('#presetSelect').inputValue(),'current','Imported project must not be mislabeled as a built-in preset');
  assert.deepEqual(multiReopened.scene,multiExpected.scene);
  assert.deepEqual(multiReopened.targets,multiExpected.targets);
  assert.deepEqual(multiReopened.lockedCutouts,multiExpected.lockedCutouts);
  assert.ok((await pixels())===multiPixels,'Articulated fresh import reproduces exact stage pixels');
  await page.screenshot({path:path.join(out,'06-articulated-reopened.png'),fullPage:true});
  record('multi-piece project download, fresh import, locks and exact canvas replay');
  await receiveOfflinePlayer(multiExpected,'07-articulated');

  await page.setViewportSize({width:393,height:852});
  await time(.37);
  const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  assert.ok(layout.scrollWidth<=layout.width+1,'Narrow viewport must not require horizontal scrolling');
  await page.screenshot({path:path.join(out,'08-narrow-studio.png'),fullPage:true});
  record('narrow viewport retains responsive studio layout',layout);
  assert.deepEqual(errors,[],'No uncaught browser runtime errors');
  await writeFile(path.join(out,'receipt.json'),JSON.stringify({url,checks,errors,screenshotReview:'Required separately; automated checks do not establish artistic quality.'},null,2));
  console.log(JSON.stringify({passed:true,checks:checks.map(c=>c.name),evidence:out}));
} catch(error) {
  await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(path.join(out,'receipt.json'),JSON.stringify({url,checks,errors,failure:String(error)},null,2));
  throw error;
} finally {await browser.close();}
