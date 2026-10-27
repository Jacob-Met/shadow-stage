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
  await page.locator('#solveButton').click();
  await time(.37);
  await page.screenshot({path:path.join(out,'01-initial-stage.png'),fullPage:true});
  const initial=await project();
  assert.ok(initial.targets?.length>=2 && initial.scene,'Fresh project has authored sequence and physical scene');
  const options=page.locator('#targetSelect option');
  assert.ok(await options.count()>=2,'Timeline exposes multiple authored targets');
  await page.locator('#targetSelect').selectOption({index:1});
  await nudge('#targetX');
  const edited=await project();
  assert.notDeepEqual(edited.targets,initial.targets,'Target authoring changes the stored target');
  await page.locator('#solveButton').click();
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

  const playerDownloadPromise=page.waitForEvent('download');
  await page.locator('#exportPlayer').click();
  const playerDownload=await playerDownloadPromise;
  const playerFile=path.join(out,'standalone-player.html');
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
    const light=pose(scene.light.keys,['x','y','z']),cutout=pose(scene.occluder.keys,['x','y','z','angle']);
    const polygon=scene.occluder.vertices.map(([x,y])=>{
      const vx=cutout.x+x*Math.cos(cutout.angle)-y*Math.sin(cutout.angle);
      const vy=cutout.y+x*Math.sin(cutout.angle)+y*Math.cos(cutout.angle);
      const distance=light.z/(light.z-cutout.z);
      return [500+(light.x+distance*(vx-light.x))*260,350-(light.y+distance*(vy-light.y))*260];
    });
    function inside(x,y){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
    function edgeDistance(x,y){return Math.min(...polygon.map((a,i)=>{const b=polygon[(i+1)%polygon.length],dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy,u=d?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/d)):0;return Math.hypot(x-a[0]-u*dx,y-a[1]-u*dy);}));}
    const c=document.querySelector('#screen'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let total=0,mismatch=0,shadow=0;
    for(let y=4;y<c.height;y+=8)for(let x=4;x<c.width;x+=8){if(edgeDistance(x+.5,y+.5)<2)continue;const offset=4*(y*c.width+x),dark=data[offset]<80&&data[offset+1]<100&&data[offset+2]<90;const expected=inside(x+.5,y+.5);total++;if(dark)shadow++;if(dark!==expected)mismatch++;}
    return {scene,total,mismatch,shadow,width:c.width,height:c.height};
  });
  assert.deepEqual(mask.scene,expected.scene,'Standalone player contains the actual exported physical scene');
  assert.ok(mask.shadow>20 && mask.total>1000,'Mask comparison includes actual foreground and background');
  assert.ok(mask.mismatch/mask.total<.002,`Offline player fails independent ray/mask oracle: ${mask.mismatch}/${mask.total}`);
  assert.deepEqual(playerErrors,[]);
  await player.screenshot({path:path.join(out,'04-offline-player.png'),fullPage:true});
  await player.locator('#play').click();
  await waitFor(()=>Math.abs(Number(document.querySelector('#seek').value)-.37)>.015,undefined,player);
  await player.locator('#play').click();
  await offlineContext.close();
  record('offline standalone HTML independently matches ray-projected shadow mask',{samples:mask.total,mismatches:mask.mismatch});
  assert.deepEqual(errors,[],'No uncaught browser runtime errors');
  await writeFile(path.join(out,'receipt.json'),JSON.stringify({url,checks,errors,screenshotReview:'Required separately; automated checks do not establish artistic quality.'},null,2));
  console.log(JSON.stringify({passed:true,checks:checks.map(c=>c.name),evidence:out}));
} catch(error) {
  await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(path.join(out,'receipt.json'),JSON.stringify({url,checks,errors,failure:String(error)},null,2));
  throw error;
} finally {await browser.close();}
