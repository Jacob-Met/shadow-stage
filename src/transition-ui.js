import {validateTargets,targetAt} from './core.js';
import {validateArticulatedScene,projectArticulated,sampleArticulatedScene} from './articulated.js';
const copy=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const mean=rows=>rows.length?rows.reduce((sum,row)=>sum+row.maskError,0)/rows.length:0;
const number=value=>Number.isFinite(value)?value.toFixed(4):'Unavailable';
function relevant(project){return {duration:project.duration,targets:project.targets,scene:project.scene,lockedCutouts:project.lockedCutouts??[]};}
export function transitionSignature(project){return JSON.stringify(relevant(project));}
function snapshot(project){
 const saved=copy(relevant(project));saved.targets=validateTargets(saved.targets);saved.scene=validateArticulatedScene(saved.scene);
 const ids=new Set(saved.scene.occluders.map(p=>p.id));
 if(!Array.isArray(saved.lockedCutouts)||new Set(saved.lockedCutouts).size!==saved.lockedCutouts.length||saved.lockedCutouts.some(id=>!ids.has(id)))throw new Error('The locked-cutout selection is invalid.');
 return saved;
}
function verifyPreservation(original,input){
 const candidate=validateArticulatedScene(input);
 if(candidate.duration!==original.scene.duration||!same(candidate.light,original.scene.light)||candidate.occluders.length!==original.scene.occluders.length)throw new Error('Candidate changed duration, light or piece count.');
 const locked=new Set(original.lockedCutouts);
 for(let i=0;i<original.scene.occluders.length;i++){
  const before=original.scene.occluders[i],after=candidate.occluders[i];
  if(before.id!==after.id||!same(before.vertices,after.vertices))throw new Error('Candidate changed piece identity or fixed geometry.');
  if(locked.has(before.id)&&!same(before,after))throw new Error('Candidate changed a locked piece.');
  for(const key of before.keys){const retained=after.keys.find(k=>k.t===key.t);if(!retained||!same(retained,key))throw new Error('Candidate changed an existing physical key.');}
 }
 return candidate;
}
export function mountTransitionUI({root,getProject,isBusy=()=>false,notify=()=>{},onAdopt,workerURL=new URL('./solver-worker.js',import.meta.url)}){
 if(!root||typeof getProject!=='function'||typeof onAdopt!=='function')throw new Error('Transition UI requires root, getProject and onAdopt.');
 const document=root.ownerDocument,section=document.createElement('section');
 section.className='transition-panel';section.setAttribute('aria-label','Transition refinement');
 section.innerHTML=`
 <h2>Explore transition motion</h2>
 <p>Preview a separate physical performance before adopting it. Your current motion remains unchanged during preview.</p>
 <div class="transition-actions"><button type="button" data-role="run">Prepare transition preview</button><button type="button" data-role="cancel" hidden>Cancel calculation</button></div>
 <p data-role="status" role="status" aria-live="polite"></p>
 <div data-role="preview" hidden>
  <p data-role="qualification"></p><p data-role="stale" role="status" hidden></p>
  <div class="transition-preview-grid">
   <figure class="transition-preview-figure"><figcaption>Original motion</figcaption><canvas data-role="original" width="600" height="420" class="transition-preview-canvas" aria-label="Original physical shadow"></canvas></figure>
   <figure class="transition-preview-figure"><figcaption>Candidate motion</figcaption><canvas data-role="candidate" width="600" height="420" class="transition-preview-canvas" aria-label="Candidate physical shadow"></canvas></figure>
  </div>
  <p class="transition-reference-description">Both previews show the same dashed target outline: a chosen boundary morph, not an observed intermediate silhouette.</p>
  <p data-role="clipping" class="transition-clipping-notice" role="status" hidden></p>
  <div class="transition-actions">
   <button type="button" data-role="play">Play both</button>
   <label>Preview time <input data-role="time" type="range" min="0" max="1" step="0.001" value="0"></label><output data-role="time-label"></output>
   <label>Playback speed <select data-role="speed"><option value="1">Normal</option><option value="0.25">Quarter speed</option></select></label>
  </div>
  <div class="transition-actions"><button type="button" data-role="quarter">Inspect t = 0.25</button><button type="button" data-role="worst">Inspect worst held-out moment</button></div>
  <p data-role="keys"></p>
  <div class="transition-actions"><button type="button" data-role="prepare-motion">Prepare motion alternative</button><button type="button" data-role="return-shape" hidden>Return to shape candidate</button></div>
  <div data-role="motion-alternative-evidence" hidden>
   <h3>Motion alternative</h3><p data-role="motion-alternative-qualification"></p><p data-role="motion-alternative-speed"></p><p data-role="motion-alternative-shape"></p>
   <p>These motion measures track projected shadow vertices. Improvements may concern pieces hidden inside the opaque silhouette and need not produce a visible improvement. Inspect both performances before adopting.</p>
   <details><summary>Motion refinement evidence</summary><pre data-role="motion-alternative-raw" class="transition-physical-data"></pre></details>
  </div>
  <table class="transition-metrics"><caption>Held-out silhouette error — lower is better</caption><thead><tr><th>Motion</th><th>Mean error</th><th>Peak error</th></tr></thead><tbody data-role="metrics"></tbody></table>
  <p data-role="motion"></p><p>Mask improvement does not establish artistic quality, collision clearance or fabricability.</p>
  <details><summary>Inspect the physical pieces</summary><label>Highlight piece <select data-role="piece"></select></label><p>Select a piece, then scrub the timeline to compare its position, height and rotation. Colored outlines show its actual projected boundary. The dark silhouette is the opaque union of all pieces.</p><pre data-role="physical" class="transition-physical-data"></pre></details>
  <div class="transition-actions"><button type="button" data-role="adopt">Adopt this motion</button><button type="button" data-role="keep">Keep original</button></div>
 </div>
 <div><button type="button" data-role="undo" disabled>Undo motion adoption — this session</button><p>Preview does not change normal project exports. Adopted geometry can be saved in the project; this session's undo history is not saved.</p></div>`;
 root.append(section);const $=role=>section.querySelector('[data-role="'+role+'"]');
 let worker=null,requestId=0,working=false,adopting=false,destroyed=false,lifecycle=0;
 let original=null,candidate=null,report=null,sourceSignature=null,stale=false,undo=null,time=0,playing=false,lastFrame=0,raf=null,view={x:0,y:0,span:2.4};
 let motionMode=false,shapeResult=null,motionReport=null;
 function comparisonReferenceScene(){return motionMode&&shapeResult?shapeResult.scene:original.scene;}
 function clearMotionAlternative(){motionMode=false;shapeResult=null;motionReport=null;}
 const listeners=[];
 function listen(element,event,handler){element.addEventListener(event,handler);listeners.push(()=>element.removeEventListener(event,handler));}
 function message(text,error=false){if(destroyed)return;$('status').textContent=text;notify(text,error);}
 function stop(){playing=false;lastFrame=0;if(raf!==null)cancelAnimationFrame(raf);raf=null;$('play').textContent='Play both';}
 function cancelWorker(){requestId++;if(worker)worker.terminate();worker=null;working=false;$('cancel').hidden=true;}
 function currentMatches(){return !!original&&transitionSignature(getProject())===sourceSignature;}
 function updateButtons(){
  if(destroyed)return;const project=getProject(),busy=working||adopting||isBusy();
  $('run').disabled=busy||project.scene?.format!=='shadow-stage/articulated-v1';$('cancel').hidden=!working;$('keep').disabled=adopting;
  $('adopt').disabled=!candidate||stale||busy||!currentMatches();$('undo').disabled=!undo||busy||transitionSignature(project)!==undo.expectedSignature;
  $('prepare-motion').disabled=busy||stale||motionMode||!shapeResult||!currentMatches();$('return-shape').disabled=working||adopting;
 }
 function invalidate(reason='The project changed after this preview was prepared.'){
  if(destroyed)return;cancelWorker();
  if(candidate){stale=true;$('stale').hidden=false;$('stale').textContent=reason+' Prepare a new preview before adoption.';$('keep').textContent='Dismiss comparison';if(motionMode)updateMotionPresentation();else $('qualification').textContent='Historical shape-refinement comparison. Its measurements describe the retained scenes, not necessarily the current project.';}
  if(undo&&transitionSignature(getProject())!==undo.expectedSignature){undo=null;message('The project changed after adoption. Session undo will not overwrite newer edits.');}updateButtons();
 }
 function refresh(){if(destroyed)return;if(original&&!currentMatches()&&!adopting)invalidate();else updateButtons();}
 function resetProject(){if(destroyed)return;lifecycle++;cancelWorker();stop();clearMotionAlternative();original=null;candidate=null;report=null;sourceSignature=null;stale=false;undo=null;time=0;$('preview').hidden=true;$('stale').hidden=true;$('status').textContent='';updateButtons();}
 function establishView(){
  let minX=-1.2,maxX=1.2,minY=-1.2,maxY=1.2;
  for(const scene of [comparisonReferenceScene(),candidate])for(let i=0;i<=32;i++)for(const polygon of projectArticulated(scene,i/32))for(const [x,y]of polygon){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  view={x:(minX+maxX)/2,y:(minY+maxY)/2,span:Math.max(maxX-minX,maxY-minY)*1.1};
 }
 function draw(canvas,scene,reference){
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,scale=Math.min(w,h)*.9/view.span;
  const world=([x,y])=>[w/2+(x-view.x)*scale,h/2-(y-view.y)*scale];
  const path=polygon=>{ctx.beginPath();polygon.forEach((p,i)=>{const q=world(p);if(i)ctx.lineTo(...q);else ctx.moveTo(...q);});ctx.closePath();};
  ctx.fillStyle='#e7ebd7';ctx.fillRect(0,0,w,h);const polygons=projectArticulated(scene,time);ctx.fillStyle='#283e32';for(const polygon of polygons){path(polygon);ctx.fill();}
  const selected=$('piece').value;
  polygons.forEach((polygon,i)=>{if(selected&&scene.occluders[i].id!==selected)return;path(polygon);ctx.strokeStyle='hsl('+((i*137.5)%360)+' 60% 48%)';ctx.lineWidth=selected?2.5:.8;ctx.stroke();});
  ctx.save();path(reference);ctx.strokeStyle='#a16c28';ctx.lineWidth=1.8;ctx.setLineDash([7,5]);ctx.stroke();ctx.restore();
  return polygons.some(p=>p.some(point=>{const [x,y]=world(point);return x<0||x>w||y<0||y>h;}));
 }
 function render(){
  if(destroyed||!candidate||!original)return;const reference=targetAt(original.targets,time),referenceScene=comparisonReferenceScene();
  const originalClipped=draw($('original'),referenceScene,reference),candidateClipped=draw($('candidate'),candidate,reference),clipped=[originalClipped?(motionMode?'shape candidate':'original'):null,candidateClipped?(motionMode?'motion alternative':'candidate'):null].filter(Boolean);
  $('clipping').hidden=clipped.length===0;$('clipping').textContent=clipped.length?'The '+clipped.join(' and ')+' shadow extends outside the fixed preview frame at this time. The camera has not changed; the visible crop is incomplete.':'';
  $('time').value=String(time);$('time-label').textContent=(time*original.duration).toFixed(2)+' s · t='+time.toFixed(3);
  const selected=$('piece').value;
  if(selected){const before=referenceScene.occluders.find(p=>p.id===selected),after=candidate.occluders.find(p=>p.id===selected),a=sampleArticulatedScene(referenceScene,time),b=sampleArticulatedScene(candidate,time);const pose=(p,l)=>({x:p.x,y:p.y,heightAboveStage:p.z,angleDegrees:p.angle*180/Math.PI,clearanceBelowLight:l.z-p.z});$('physical').textContent=JSON.stringify({piece:selected,referenceKind:motionMode?'shape-candidate':'original',time:{normalized:time,seconds:time*original.duration},currentOriginalPose:pose(a.occluders.find(p=>p.id===selected),a.light),currentCandidatePose:pose(b.occluders.find(p=>p.id===selected),b.light),fixedVertices:before.vertices,originalKeys:before.keys,candidateKeys:after.keys},null,2);}
  else $('physical').textContent=candidate.occluders.length+' persistent pieces. Select a piece to inspect its current physical pose, retained geometry and motion keys.';
 }
 function setTime(value){if(!Number.isFinite(value))return;time=Math.max(0,Math.min(1,value));render();}
 function frame(now){if(!playing||destroyed)return;if(lastFrame)time=Math.min(1,time+(now-lastFrame)/1000/original.duration*Number($('speed').value));lastFrame=now;render();if(time>=1){stop();return;}raf=requestAnimationFrame(frame);}
 function option(label,value){const element=document.createElement('option');element.textContent=label;element.value=value;return element;}
 function updateMotionPresentation(){
  const captions=section.querySelectorAll('.transition-preview-figure figcaption');captions[0].textContent=motionMode?'Shape-optimized candidate':'Original motion';captions[1].textContent=motionMode?'Motion alternative':'Candidate motion';
  $('original').setAttribute('aria-label',motionMode?'Shape candidate physical shadow':'Original physical shadow');$('candidate').setAttribute('aria-label',motionMode?'Motion alternative physical shadow':'Candidate physical shadow');
  $('return-shape').hidden=!motionMode;$('motion-alternative-evidence').hidden=!motionMode;if(!motionMode)return;
  const before=motionReport.motion.candidate,after=motionReport.motion.proposal,shapeBefore=motionReport.heldOut.candidate,shapeAfter=motionReport.heldOut.proposal;
  $('qualification').textContent=stale||!currentMatches()?'Historical comparison of the shape candidate and motion alternative. The displayed scenes may differ from the current project; adoption is unavailable.':'Comparing the shape candidate with a separate motion alternative. The project remains unchanged until you adopt the displayed alternative.';
  $('metrics').closest('table').querySelector('caption').textContent='Shape-refinement stage evidence — original, inserted keys, shape candidate';
  $('motion').textContent='Shape-refinement stage: maximum sampled vertex step '+number(report.motion.before.maximumVertexStep)+' → '+number(report.motion.after.maximumVertexStep)+' per Δt='+report.motion.after.deltaT+'. '+(report.motion.after.maximumVertexStep>report.motion.before.maximumVertexStep?'That stage worsened this motion measure. ':'')+'The separate alternative above is evaluated against the shape candidate.';
  $('motion-alternative-qualification').textContent=motionReport.qualifiedImprovement?'The alternative meets the module’s bounded mean-error-gain retention and sampled velocity-reduction criteria. This is not a visual-quality verdict.':'The alternative does not meet the module’s qualification criteria. Its raw result remains inspectable.';
  $('motion-alternative-speed').textContent='Maximum projected shadow-vertex speed: '+number(before.maximumVelocityWorldUnitsPerSecond)+' → '+number(after.maximumVelocityWorldUnitsPerSecond)+' stage units/s. Maximum finite-difference velocity-change rate: '+number(before.maximumVelocityChangeWorldUnitsPerSecondSquared)+' → '+number(after.maximumVelocityChangeWorldUnitsPerSecondSquared)+' stage units/s². This is not 3D cutout acceleration.';
  $('motion-alternative-shape').textContent='Held-out silhouette error, shape candidate → alternative: mean '+number(shapeBefore.mean)+' → '+number(shapeAfter.mean)+'; maximum '+number(shapeBefore.maximum)+' → '+number(shapeAfter.maximum)+'. '+(shapeAfter.maximum>shapeBefore.maximum?'The worst sampled silhouette error increased. ':'')+'Qualification limits mean-error gain loss; it does not guarantee every silhouette is preserved.';
  $('motion-alternative-raw').textContent=JSON.stringify(motionReport,null,2);
 }
 function showResult(){
  if(!motionMode)shapeResult={scene:copy(candidate),report:copy(report)};
  $('preview').hidden=false;$('stale').hidden=!stale;if(stale&&!$('stale').textContent.trim())$('stale').textContent='This is a historical comparison. It cannot be adopted into the current project.';$('keep').textContent=stale?'Dismiss comparison':'Keep original';
  $('qualification').textContent=stale?'Historical shape-refinement comparison. Its measurements describe the retained scenes, not necessarily the current project.':report.heldOut.qualifiedImprovement?'This candidate meets the declared held-out mask-error criterion. Inspect its motion before adopting.':'This candidate does not meet the declared held-out criterion. Its raw results remain available for inspection.';
  $('metrics').closest('table').querySelector('caption').textContent='Held-out silhouette error — lower is better';
  const peak=rows=>rows.reduce((m,r)=>Math.max(m,r.maskError),0);$('metrics').replaceChildren();
  for(const [label,rows]of [['Original',report.heldOut.before],['After inserting keys',report.heldOut.initialized],['Candidate',report.heldOut.after]]){const tr=document.createElement('tr');for(const value of [label,number(mean(rows)),number(peak(rows))]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('metrics').append(tr);}
  const before=report.motion.before.maximumVertexStep,after=report.motion.after.maximumVertexStep;
  $('motion').textContent='Maximum sampled vertex step: '+number(before)+' → '+number(after)+' per Δt='+report.motion.after.deltaT+'. '+(after>before?'This measure worsened: the candidate moves farther between samples. ':'This sampled measure did not increase. ')+'It does not measure artistic smoothness. Inspect pauses and motion at quarter speed.';
  const inserted=[...new Set(report.insertedKeys.map(k=>k.t))].sort((a,b)=>a-b);
  $('keys').textContent='Authored moments: '+original.targets.map(k=>k.t.toFixed(3)).join(', ')+'. Inserted physical keys: '+inserted.map(t=>t.toFixed(3)).join(', ')+'.';
  $('piece').replaceChildren(option('All pieces',''));for(const p of candidate.occluders)$('piece').append(option(p.id,p.id));
  updateMotionPresentation();establishView();setTime(0);updateButtons();
 }
 function run(){
  if(destroyed||working||adopting||isBusy())return;stop();
  try{
   const fresh=snapshot(getProject());clearMotionAlternative();original=fresh;sourceSignature=transitionSignature(getProject());candidate=null;report=null;stale=false;$('preview').hidden=true;
   const id=++requestId;worker=new Worker(workerURL,{type:'module'});working=true;updateButtons();message('Preparing a separate transition candidate. Current motion is unchanged.');
   worker.onmessage=({data})=>{
    if(destroyed||id!==requestId||data.id!==id)return;worker.terminate();worker=null;working=false;
    try{
     if(data.error)throw new Error(data.error);if(!currentMatches())throw new Error('Project changed during refinement; the result was not adopted.');
     candidate=verifyPreservation(original,data.result.scene);report=data.result.report;
     if(!report?.heldOut?.before?.length||!report?.heldOut?.initialized?.length||!report?.heldOut?.after?.length||!report?.motion?.before||!report?.motion?.after||!Array.isArray(report.insertedKeys))throw new Error('Refinement returned an incomplete assessment.');
     showResult();message('Candidate ready. Preview both performances before choosing.');
    }catch(error){candidate=null;report=null;message(error.message,true);updateButtons();}
   };
   worker.onerror=event=>{if(id!==requestId||destroyed)return;cancelWorker();message(event.message||'Transition worker failed.',true);updateButtons();};
   worker.postMessage({id,mode:'transition',targets:copy(original.targets),scene:copy(original.scene),options:{lockedIds:copy(original.lockedCutouts),iterations:4,maxEvaluations:2304,resolution:40,measurementResolution:120}});
  }catch(error){cancelWorker();message(error.message,true);updateButtons();}
 }
 function prepareMotionAlternative(){
  if(destroyed||working||adopting||isBusy()||stale||motionMode||!shapeResult||!currentMatches())return;
  stop();const id=++requestId,suppliedShape=copy(shapeResult.scene),suppliedOriginal=copy(original.scene),suppliedTargets=copy(original.targets),suppliedLocks=copy(original.lockedCutouts);
  try{
   worker=new Worker(workerURL,{type:'module'});working=true;updateButtons();message('Preparing a separate motion alternative. The shape candidate and current project are retained.');
   worker.onmessage=({data})=>{
    if(destroyed||id!==requestId||data.id!==id)return;worker.terminate();worker=null;working=false;
    try{
     if(data.error)throw new Error(data.error);if(!currentMatches())throw new Error('Project changed during motion refinement; the result was not adopted.');if(!same(data.result.originalCandidate,suppliedShape))throw new Error('Motion refinement did not retain the supplied shape candidate.');
     const next=verifyPreservation(original,data.result.scene),evidence=data.result.report,before=evidence?.motion?.candidate,after=evidence?.motion?.proposal,shapeBefore=evidence?.heldOut?.candidate,shapeAfter=evidence?.heldOut?.proposal;
     if(![before?.maximumVelocityWorldUnitsPerSecond,after?.maximumVelocityWorldUnitsPerSecond,before?.maximumVelocityChangeWorldUnitsPerSecondSquared,after?.maximumVelocityChangeWorldUnitsPerSecondSquared,shapeBefore?.mean,shapeAfter?.mean,shapeBefore?.maximum,shapeAfter?.maximum].every(Number.isFinite))throw new Error('Motion refinement returned incomplete comparison evidence.');
     candidate=next;motionReport=copy(evidence);motionMode=true;report=copy(shapeResult.report);showResult();message('Motion alternative ready. Compare it with the shape candidate; lower sampled vertex speed does not prove a visible improvement.');
    }catch(error){message(error.message,true);updateButtons();}
   };
   worker.onerror=event=>{if(id!==requestId||destroyed)return;cancelWorker();message(event.message||'Motion refinement worker failed.',true);updateButtons();};
   worker.postMessage({id,mode:'motion',targets:suppliedTargets,originalScene:suppliedOriginal,scene:suppliedShape,options:{lockedIds:suppliedLocks,maxEvaluations:64,trainingResolution:64,measurementResolution:120,motionIntervals:100,assessmentIntervals:200,window:{lo:-1.2,side:2.4}}});
  }catch(error){cancelWorker();message(error.message,true);updateButtons();}
 }
 async function adopt(){
  if(destroyed||!candidate||stale||working||adopting||isBusy())return;if(!currentMatches()){invalidate();return;}
  const adoptionSnapshot=copy(original),next=verifyPreservation(adoptionSnapshot,candidate),previous=copy(adoptionSnapshot.scene),expectedSignature=sourceSignature,evidence=copy(report),adoptionLifecycle=lifecycle;
  evidence.displayedCandidateKind=motionMode?'motion-alternative':'shape-candidate';if(motionMode)evidence.motionRefinement=copy(motionReport);
  adopting=true;stop();updateButtons();
  try{
   await onAdopt(copy(next),{kind:'transition-adoption',expectedSignature,expectedSnapshot:copy(adoptionSnapshot),report:evidence});
   if(destroyed||lifecycle!==adoptionLifecycle)return;const current=getProject();
   if(!same(current.scene,next)||current.duration!==adoptionSnapshot.duration||!same(current.targets,adoptionSnapshot.targets)||!same(current.lockedCutouts??[],adoptionSnapshot.lockedCutouts))throw new Error('Adoption hook did not preserve the expected project state.');
   undo={scene:previous,expectedSignature:transitionSignature(current)};stale=true;$('keep').textContent='Dismiss comparison';$('stale').hidden=false;$('stale').textContent=motionMode?'Motion alternative adopted. Preview remains a historical comparison with the shape candidate.':'Candidate adopted. Preview remains a comparison with its original motion.';updateMotionPresentation();message('Motion adopted. Session undo can restore the previous performance.');
  }catch(error){if(!destroyed&&lifecycle===adoptionLifecycle)message('Motion adoption was not confirmed: '+error.message,true);}finally{adopting=false;updateButtons();}
 }
 async function undoAdoption(){
  if(destroyed||!undo||working||adopting||isBusy())return;
  if(transitionSignature(getProject())!==undo.expectedSignature){undo=null;updateButtons();message('The project changed after adoption; session undo will not overwrite those edits.',true);return;}
  const saved=copy(undo),undoLifecycle=lifecycle;adopting=true;stop();updateButtons();
  try{
   await onAdopt(copy(saved.scene),{kind:'transition-session-undo',expectedSignature:saved.expectedSignature});
   if(destroyed||lifecycle!==undoLifecycle)return;if(!same(getProject().scene,saved.scene))throw new Error('Undo hook did not restore the previous scene.');
   undo=null;message('Previous motion restored. This undo history was session-only.');
  }catch(error){if(!destroyed&&lifecycle===undoLifecycle)message('Undo was not confirmed: '+error.message,true);}finally{adopting=false;updateButtons();}
 }
 listen($('run'),'click',run);listen($('cancel'),'click',()=>{cancelWorker();message('Calculation cancelled. Current motion is unchanged.');updateButtons();});
 listen($('adopt'),'click',adopt);listen($('undo'),'click',undoAdoption);
 listen($('prepare-motion'),'click',prepareMotionAlternative);
 listen($('return-shape'),'click',()=>{if(working||adopting||!shapeResult)return;stop();motionMode=false;motionReport=null;candidate=copy(shapeResult.scene);report=copy(shapeResult.report);showResult();if(stale||!currentMatches())$('qualification').textContent='Showing the historical shape candidate. The current project has not been changed by this view switch; this comparison cannot be adopted.';else message('Returned to the shape candidate. The current project is unchanged.');});
 listen($('keep'),'click',()=>{if(adopting)return;cancelWorker();stop();clearMotionAlternative();candidate=null;report=null;original=null;sourceSignature=null;$('preview').hidden=true;message('Preview dismissed. The current project was not changed.');updateButtons();});
 listen($('time'),'input',()=>{stop();setTime(Number($('time').value));});listen($('quarter'),'click',()=>{stop();setTime(.25);});
 listen($('worst'),'click',()=>{if(!report)return;const rows=motionMode?motionReport?.heldOut?.proposal?.rows:report.heldOut.after;if(!Array.isArray(rows)||!rows.length||rows.some(row=>!Number.isFinite(row.t)||!Number.isFinite(motionMode?row.error:row.maskError))){message('The displayed stage has no complete worst-moment assessment.',true);return;}const worst=motionMode?rows.reduce((a,b)=>b.error>a.error?b:a):rows.reduce((a,b)=>b.maskError>a.maskError?b:a);stop();setTime(worst.t);});
 listen($('piece'),'change',render);listen($('play'),'click',()=>{if(!candidate)return;if(playing){stop();return;}if(time>=1)time=0;playing=true;lastFrame=0;$('play').textContent='Pause both';raf=requestAnimationFrame(frame);});
 updateButtons();
 return {invalidate,refresh,resetProject,setTime,isWorking:()=>working||adopting,getState:()=>copy({working,adopting,stale,time,playing,hasCandidate:!!candidate,hasSessionUndo:!!undo,original,candidate,report,motionMode,shapeResult,motionReport}),destroy(){lifecycle++;destroyed=true;cancelWorker();stop();for(const remove of listeners)remove();section.remove();}};
}

