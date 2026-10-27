import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const base=process.env.SHADOW_STAGE_URL||'http://127.0.0.1:4319',evidence=process.env.SHADOW_STAGE_EVIDENCE||'/tmp/estate95a-transition-receiving';
await fs.mkdir(evidence,{recursive:true});
const report={startedAt:new Date().toISOString(),base,checks:[],errors:[],limitations:['Behavioral receiving preserves measured shape-versus-motion tradeoffs; it does not establish artistic quality.','Project reopening uses the maintained projection module and establishes exact replay, not an independent geometry oracle.','Session undo is not persisted in project files.']};
const browser=await chromium.launch({headless:true,chromiumSandbox:true}),context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
await context.addInitScript(()=>{
 window.__receivingWorkers=[];window.__receivingCSP=[];
 document.addEventListener('securitypolicyviolation',event=>window.__receivingCSP.push({directive:event.effectiveDirective,blockedURI:event.blockedURI}));
 const Native=window.Worker;
 window.Worker=class extends Native{
  constructor(url,options){super(url,options);this.__receipt={url:String(url),posts:[],terminated:false};window.__receivingWorkers.push(this.__receipt);}
  postMessage(data,...rest){this.__receipt.posts.push({id:data?.id,mode:data?.mode,at:performance.now()});return super.postMessage(data,...rest);}
  terminate(){this.__receipt.terminated=true;return super.terminate();}
 };
});
const pages=[];function attach(p){pages.push(p);p.on('pageerror',e=>report.errors.push({type:'pageerror',message:e.message}));return p;}
const page=attach(await context.newPage()),project=p=>p.evaluate(()=>window.shadowStage.getProject()),state=p=>p.evaluate(()=>window.shadowStage.getTransitionState());
const role=(p,n)=>p.locator('#transitionPanel [data-role="'+n+'"]'),comp=(p,n)=>p.locator('#comparisonPanel [data-role="'+n+'"]');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),passed=(name,detail={})=>report.checks.push({name,status:'passed',...detail});
async function poll(p,predicate,arg,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await p.evaluate(predicate,arg))return;await delay(25);}throw Error('Bounded receiving poll timed out.');}
async function ready(p){await poll(p,()=>!!window.shadowStage?.getTransitionState);await poll(p,()=>!document.querySelector('#solveButton').disabled&&!!window.shadowStage.getProject().scene);}
async function waitScene(p,scene){await poll(p,s=>JSON.stringify(window.shadowStage.getProject().scene)===JSON.stringify(s),scene);}
async function load(p,value){await p.locator('#importProject').setInputFiles({name:'transition-receiving.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await waitScene(p,value.scene);await poll(p,()=>!window.shadowStage.getTransitionState().working);}
async function prepare(p){
 await poll(p,()=>!document.querySelector('#transitionPanel [data-role="run"]').disabled);await role(p,'run').click();
 await poll(p,()=>!window.shadowStage.getTransitionState().working);
 const result=await state(p);if(!result.hasCandidate)throw Error('Transition returned no candidate: '+await role(p,'status').textContent());
 assert.ok(result.candidate);assert.ok(result.report?.heldOut?.after?.length);return result;
}
async function workers(p){return p.evaluate(()=>window.__receivingWorkers.filter(w=>w.posts.some(x=>x.mode==='transition')));}
async function projections(p,times){return p.evaluate(async times=>{const {projectArticulated}=await import('/src/articulated.js');const scene=window.shadowStage.getProject().scene;return times.map(t=>({t,polygons:projectArticulated(scene,t)}));},times);}
async function compare(p){await comp(p,'compare').click();await poll(p,()=>!window.shadowStage.getComparisonState().pending);assert.ok((await p.evaluate(()=>window.shadowStage.getComparisonState())).result,await comp(p,'status').textContent());assert.equal(await comp(p,'cards').locator('.comparison-card').count(),4);}
let failure=null;
try{
 await page.goto(base);await ready(page);await page.locator('#presetSelect').selectOption('shape-change');await poll(page,()=>!document.querySelector('#solveButton').disabled);
 await page.locator('#constructionMode').selectOption('pieces');await page.locator('#pieceBudget').selectOption('24');await page.locator('#solveButton').click();
 await poll(page,()=>!document.querySelector('#solveButton').disabled&&window.shadowStage.getProject().scene?.format==='shadow-stage/articulated-v1');
 let baseline=await project(page);assert.equal(baseline.targets.length,3);assert.equal(baseline.scene.occluders.length,24);assert.equal(baseline.duration,8);
 baseline.authoring={status:'proposed',original:{title:'Retained source fixture',duration:baseline.duration,targets:structuredClone(baseline.targets),scene:structuredClone(baseline.scene)},evidence:{provider:'Historical receiving fixture, not inference',executed:false}};
 await load(page,baseline);baseline=await project(page);passed('Distinct-shape preset fitted through maintained app; historical custody retained',{pieces:24,duration:8});
 await comp(page,'capture').click();for(const [name,value]of [['iterations','1'],['resolution','16'],['budget','12'],['observation','32']])await comp(page,name).fill(value);
 await compare(page);await comp(page,'cards').locator('.comparison-card').nth(0).locator('button').click();await compare(page);
 const comparisonBefore=await page.evaluate(()=>window.shadowStage.getComparisonState());assert.equal(comparisonBefore.adoptionHistory.length,1);assert.ok(same(await project(page),baseline));
 const preview=await prepare(page);assert.ok(same(await project(page),baseline));const firstWorkers=await workers(page);assert.ok(firstWorkers.at(-1).url.includes('solver-worker.js'));passed('Real worker produces separate transition preview',{worker:firstWorkers.at(-1)});
 await role(page,'quarter').click();assert.equal((await state(page)).time,.25);const worst=preview.report.heldOut.after.reduce((a,b)=>b.maskError>a.maskError?b:a);await role(page,'worst').click();assert.equal((await state(page)).time,worst.t);
 assert.ok(preview.report.motion.after.maximumVertexStep>preview.report.motion.before.maximumVertexStep,'Retained preset worse-motion observation changed');
 assert.match(await role(page,'motion').textContent(),/measure worsened/i);assert.match(await role(page,'metrics').textContent(),/After inserting keys/);assert.equal(await page.locator('#transitionPanel [style]').count(),0);
 assert.match(await page.locator('.transition-reference-description').textContent(),/chosen boundary morph/);passed('Initialized error, selected morph and worse-motion evidence remain visible',{heldOut:preview.report.heldOut,motion:preview.report.motion});
 await page.locator('#transitionPanel details').evaluate(e=>{e.open=true;});
 const selectedPiece=await page.evaluate(async()=>{const {sampleArticulatedScene}=await import('/src/articulated.js'),s=window.shadowStage.getTransitionState().candidate,a=sampleArticulatedScene(s,0),b=sampleArticulatedScene(s,.25);return a.occluders.find((p,i)=>p.x!==b.occluders[i].x||p.y!==b.occluders[i].y||p.z!==b.occluders[i].z)?.id;});
 assert.ok(selectedPiece);await role(page,'piece').selectOption(selectedPiece);
 const physicalBefore=JSON.parse(await role(page,'physical').textContent());
 await role(page,'quarter').click();
 const physical=JSON.parse(await role(page,'physical').textContent());
 const expectedPose=await page.evaluate(async id=>{const {sampleArticulatedScene}=await import('/src/articulated.js'),s=window.shadowStage.getTransitionState(),a=sampleArticulatedScene(s.candidate,.25),p=a.occluders.find(p=>p.id===id);return{x:p.x,y:p.y,heightAboveStage:p.z,angleDegrees:p.angle*180/Math.PI,clearanceBelowLight:a.light.z-p.z};},selectedPiece);
 assert.deepEqual(physical.currentCandidatePose,expectedPose);assert.equal(physical.time.seconds,2);
 await page.evaluate(()=>{const e=document.querySelector('#transitionPanel [data-role="time"]');e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});
 const physicalAtZero=JSON.parse(await role(page,'physical').textContent());assert.notDeepEqual(physical.currentCandidatePose,physicalAtZero.currentCandidatePose);passed('Selected physical piece shows live canonical poses while scrubbing');
 await page.locator('#transitionPanel details').evaluate(e=>{e.open=false;});
 await role(page,'quarter').click();await page.locator('#transitionPanel').screenshot({path:path.join(evidence,'transition-quarter-preview.png')});
 await role(page,'speed').selectOption('0.25');await role(page,'play').click();await poll(page,()=>window.shadowStage.getTransitionState().time>.25);await role(page,'play').click();assert.equal((await state(page)).playing,false);assert.ok(same(await project(page),baseline));passed('Shared preview timeline and quarter-speed playback preserve the project');
 await role(page,'keep').click();assert.equal((await state(page)).hasCandidate,false);assert.ok(same(await project(page),baseline));passed('Keep original dismisses without mutation');
 const adoptionPreview=await prepare(page),candidate=adoptionPreview.candidate;await role(page,'adopt').click();await waitScene(page,candidate);await poll(page,()=>window.shadowStage.getTransitionState().hasSessionUndo);
 const adopted=await project(page);assert.deepEqual(adopted.targets,baseline.targets);assert.deepEqual(adopted.authoring,baseline.authoring);assert.equal(adopted.duration,baseline.duration);assert.deepEqual(adopted.lockedCutouts??[],baseline.lockedCutouts??[]);assert.deepEqual(adopted.scene.light,baseline.scene.light);
 for(let i=0;i<baseline.scene.occluders.length;i++){const a=baseline.scene.occluders[i],b=adopted.scene.occluders[i];assert.equal(a.id,b.id);assert.deepEqual(a.vertices,b.vertices);for(const key of a.keys)assert.deepEqual(b.keys.find(k=>k.t===key.t),key);}
 assert.equal(await role(page,'keep').textContent(),'Dismiss comparison');passed('Explicit adoption survives parent invalidation and preserves physical anchors and custody');
 // No incidental edit/refresh is allowed before these availability assertions.
 await poll(page,()=>{const p=document.querySelector('#comparisonPanel');return !p.querySelector('[data-role="capture"]').disabled&&!p.querySelector('[data-role="compare"]').disabled&&p.querySelector('[data-role="results"]').hidden;});
 const compared=await page.evaluate(()=>window.shadowStage.getComparisonState());assert.deepEqual(compared.baseline,comparisonBefore.baseline);assert.deepEqual(compared.adoptionHistory,comparisonBefore.adoptionHistory);assert.equal(compared.result,null);assert.equal(await comp(page,'cards').locator('button').count(),0);
 await compare(page);assert.deepEqual((await page.evaluate(()=>window.shadowStage.getComparisonState())).baseline,comparisonBefore.baseline);passed('Transition adoption retains comparison baseline/history, removes stale scores and immediately permits a new real comparison');
 const times=[0,.125,.25,.5,.75,.875,1],adoptedProjection=await projections(page,times);
 const event=page.waitForEvent('download',{timeout:15000});await page.locator('#saveProject').click();const download=await event,file=path.join(evidence,'adopted-transition-project.json');await download.saveAs(file);const saved=JSON.parse(await fs.readFile(file,'utf8'));
 const reopened=attach(await context.newPage());await reopened.goto(base);await ready(reopened);await load(reopened,saved);assert.deepEqual(await projections(reopened,times),adoptedProjection);assert.equal((await state(reopened)).hasSessionUndo,false);passed('Actual downloaded project reproduces adopted geometry in a fresh studio');
 await role(page,'undo').click();await waitScene(page,baseline.scene);assert.equal((await state(page)).hasSessionUndo,false);assert.deepEqual((await project(page)).targets,baseline.targets);passed('Session undo restores exact prior motion');
 // Trigger cancellation synchronously, so a fast worker cannot race harness clicks.
 await page.evaluate(()=>{document.querySelector('#transitionPanel [data-role="run"]').click();document.querySelector('#transitionPanel [data-role="cancel"]').click();});
 assert.equal((await state(page)).working,false);assert.equal((await state(page)).hasCandidate,false);assert.ok((await workers(page)).at(-1).terminated);assert.deepEqual((await project(page)).scene,baseline.scene);passed('Cancellation terminates native worker before any result can apply');
 await prepare(page);await page.locator('#duration').fill('9');await page.locator('#duration').dispatchEvent('change');assert.equal((await state(page)).stale,true);assert.equal(await role(page,'adopt').isDisabled(),true);assert.equal((await project(page)).duration,9);passed('Duration edit prevents stale candidate adoption');
 await load(page,baseline);
 await page.evaluate(()=>{document.querySelector('#transitionPanel [data-role="run"]').click();const e=document.querySelector('#lightX');e.value='0.1';e.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal((await state(page)).working,false);assert.equal((await state(page)).hasCandidate,false);assert.ok((await workers(page)).at(-1).terminated);assert.ok((await project(page)).scene.light.keys.some(k=>k.x===.1));passed('Same-turn physical edit cancels pending refinement and preserves the edit');
 await load(page,baseline);await role(page,'run').click();await poll(page,()=>window.shadowStage.getTransitionState().working);const index=(await workers(page)).length-1;assert.equal((await workers(page))[index].terminated,false);await load(page,saved);
 assert.equal((await state(page)).hasCandidate,false);assert.equal((await state(page)).hasSessionUndo,false);assert.equal((await workers(page))[index].terminated,true);assert.deepEqual((await project(page)).scene,saved.scene);passed('Project replacement clears pending preview and session history');
 await load(page,baseline);await page.locator('#lockCutout').check();const locked=await project(page),id=locked.lockedCutouts[0];const lockPreview=await prepare(page);assert.deepEqual(lockPreview.candidate.occluders.find(p=>p.id===id),locked.scene.occluders.find(p=>p.id===id));assert.deepEqual(lockPreview.report.lockedIds,locked.lockedCutouts);passed('Locked physical piece retains exact mesh and complete track in the real transition result');
 await load(page,baseline);await prepare(page);await role(page,'adopt').click();await poll(page,()=>window.shadowStage.getTransitionState().hasSessionUndo);await page.locator('#duration').fill('10');await page.locator('#duration').dispatchEvent('change');assert.equal(await role(page,'undo').isDisabled(),true);assert.match(await role(page,'status').textContent(),/will not overwrite newer edits/);assert.equal((await project(page)).duration,10);passed('Later edits disable session undo instead of overwriting new work');
 await page.setViewportSize({width:390,height:844});await page.locator('#transitionPanel').screenshot({path:path.join(evidence,'transition-narrow.png')});
 const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,panelWidth:document.querySelector('#transitionPanel').getBoundingClientRect().width}));assert.ok(layout.scrollWidth<=layout.width+1,JSON.stringify(layout));for(const p of pages)assert.deepEqual(await p.evaluate(()=>window.__receivingCSP),[]);assert.deepEqual(report.errors,[]);passed('Narrow layout and actual served CSP remain valid',layout);report.status='passed';
}catch(error){failure=error;report.status='failed';report.failure={name:error.name,message:error.message,stack:error.stack};try{report.lastTransitionState=await state(page);report.lastProject=await project(page);report.workerReceipts=await workers(page);await page.screenshot({path:path.join(evidence,'transition-failure.png'),fullPage:true});}catch(e){report.captureError=e.message;}}
finally{report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(evidence,'transition-receiving.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({status:report.status,passedChecks:report.checks.length,evidence,failure:report.failure}));if(failure)throw failure;

