import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const baselineURL=process.env.SHADOW_STAGE_BASELINE_URL,candidateURL=process.env.SHADOW_STAGE_URL;
assert(baselineURL&&candidateURL,'Set SHADOW_STAGE_BASELINE_URL and SHADOW_STAGE_URL');
const out=path.resolve(process.env.SHADOW_STAGE_EVIDENCE||'test-artifacts/target-history-baseline');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,chromiumSandbox:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
const viewport={width:1440,height:1000},contexts=[],errors=[];
async function waitFor(receiver,predicate,arg,{timeout=30000}={}){
 const deadline=Date.now()+timeout;
 while(true){
  if(await receiver.evaluate(predicate,arg))return;
  if(Date.now()>=deadline)throw new Error('Browser condition timed out: '+predicate.toString());
  await new Promise(resolve=>setTimeout(resolve,25));
 }
}
const project=p=>p.evaluate(()=>window.shadowStage.getProject());
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const receipt={baselineURL,candidateURL,viewport};
try{
 async function open(url){
  const c=await browser.newContext({viewport});contexts.push(c);const p=await c.newPage();
  p.on('pageerror',e=>errors.push(String(e)));await p.goto(url);
  await waitFor(p,()=>window.shadowStage&&document.querySelector('#solveButton').disabled===false);
  return p;
 }
 const baseline=await open(baselineURL),candidate=await open(candidateURL),fixture=await project(baseline);
 assert(fixture.scene);const original=JSON.stringify(fixture.targets);
 async function receive(p){
  await p.locator('#importProject').setInputFiles({name:'comparison-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await waitFor(p,expected=>document.querySelector('#importProject').files.length===0&&
   document.querySelector('#notice').textContent.includes('Opened comparison-fixture.json')&&
   !document.querySelector('#solveButton').disabled&&JSON.stringify(window.shadowStage.getProject().targets)===expected,original);
  const accepted=await project(p);assert.deepEqual(accepted.targets,fixture.targets);assert.deepEqual(accepted.scene,fixture.scene);
 }
 await receive(baseline);await receive(candidate);
 async function gesture(p){
  await p.locator('#moveMode').click();const canvas=p.locator('#stageCanvas');await canvas.scrollIntoViewIfNeeded();
  const box=await canvas.boundingBox();assert(box&&box.width>0&&box.height>0);
  const s=Math.min(box.width,box.height)*.365,x=box.x+box.width/2,y=box.y+box.height*.47;
  await p.mouse.move(x,y);await p.mouse.down();
  try{await p.mouse.move(x+.19*s,y-.13*s,{steps:12});}finally{await p.mouse.up();}
  const edited=await project(p);assert.notDeepEqual(edited.targets,fixture.targets);assert.deepEqual(edited.scene,fixture.scene);return edited;
 }
 const baselineEdited=await gesture(baseline),candidateEdited=await gesture(candidate);
 assert.deepEqual(baselineEdited.targets,candidateEdited.targets,'The identical canvas gesture must produce identical edits');
 assert(await candidate.locator('#undoTargetEdit').isEnabled());
 for(const p of [baseline,candidate]){
  await p.locator('#moveMode').focus();await p.keyboard.press('Control+z');
  await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 }
 const baselineAfter=await project(baseline),candidateAfter=await project(candidate);
 assert.deepEqual(baselineAfter.targets,baselineEdited.targets,'Maintained baseline retains the target edit');
 assert.deepEqual(candidateAfter.targets,fixture.targets,'Candidate restores the full gesture with one Undo');
 assert.deepEqual(baselineAfter.scene,fixture.scene);assert.deepEqual(candidateAfter.scene,fixture.scene);assert.deepEqual(errors,[]);
 await baseline.screenshot({path:path.join(out,'baseline-after-undo.png'),fullPage:true});
 await candidate.screenshot({path:path.join(out,'candidate-after-undo.png'),fullPage:true});
 Object.assign(receipt,{passed:true,gesture:{from:[0,0],to:[.19,.13],steps:12},bothDragsChangedTargets:true,identicalEdits:true,
  baselineRetainedEdit:true,candidateRestoredOriginal:true,physicalScenePreserved:true,
  targetHashes:{original:hash(fixture.targets),edited:hash(candidateEdited.targets),baselineAfter:hash(baselineAfter.targets),candidateAfter:hash(candidateAfter.targets)}});
}catch(error){Object.assign(receipt,{passed:false,failure:String(error),stack:error.stack});process.exitCode=1;}
finally{
 await Promise.all(contexts.map(c=>c.close()));await browser.close();await writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}
