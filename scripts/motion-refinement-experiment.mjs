import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {validateArticulatedScene,sampleArticulatedScene,projectArticulated} from '../src/articulated.js';
import {targetAt} from '../src/core.js';
const inputPath=path.resolve(process.argv[2]||'../estate95a-transition-v9-quality-v1.json'),outputPath=path.resolve(process.argv[3]||'../estate95a-motion-refinement-v1.json'),input=JSON.parse(fs.readFileSync(inputPath,'utf8'));
const clone=v=>structuredClone(v),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const TRAIN=[1/6,1/3,2/3,5/6],HELD=[1/12,.25,5/12,7/12,.75,11/12],MAX_EVALUATIONS=64,WINDOW={lo:-1.2,side:2.4},REFERENCE_PIXELS_PER_WORLD_UNIT=260;
function inside(x,y,p){let hit=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function requireCoverage(p,label){if(!Array.isArray(p)||p.length<3||p.some(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y)||x<WINDOW.lo||x>WINDOW.lo+WINDOW.side||y<WINDOW.lo||y>WINDOW.lo+WINDOW.side))throw Error('Unqualified target coverage: '+label);}
function prepare(targets,times,n){return times.map(t=>{const p=targetAt(targets,t);requireCoverage(p,'intermediate '+t);const desired=[];let occupied=0;for(let y=0;y<n;y++)for(let x=0;x<n;x++){const v=inside(WINDOW.lo+(x+.5)*WINDOW.side/n,WINDOW.lo+(y+.5)*WINDOW.side/n,p);desired.push(v);if(v)occupied++;}if(occupied<4)throw Error('Unresolved reference silhouette');return{t,n,desired};});}
function shape(scene,refs){
 const rows=refs.map(({t,n,desired})=>{const polygons=projectArticulated(scene,t),outside=polygons.flat().filter(([x,y])=>x<WINDOW.lo||x>WINDOW.lo+WINDOW.side||y<WINDOW.lo||y>WINDOW.lo+WINDOW.side).length;let union=0,xor=0;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const X=WINDOW.lo+(x+.5)*WINDOW.side/n,Y=WINDOW.lo+(y+.5)*WINDOW.side/n,actual=polygons.some(p=>inside(X,Y,p)),expected=desired[y*n+x];if(actual||expected)union++;if(actual!==expected)xor++;}
 return{t,error:union?xor/union:1,outsideVertices:outside};});
 return{rows,mean:rows.reduce((s,r)=>s+r.error,0)/rows.length,maximum:Math.max(...rows.map(r=>r.error)),qualified:rows.every(r=>r.outsideVertices===0)};
}
function motion(scene,intervals=100){
 const dt=scene.duration/intervals;let previous=null,previousVelocity=null,maximumStep=0,maximumVelocity=0,maximumVelocityChange=0,velocityPeak=null,velocityChangePeak=null;
 const perPiece=scene.occluders.map(()=>0);
 for(let i=0;i<=intervals;i++){
  const polygons=projectArticulated(scene,i/intervals);
  if(previous){
   const velocities=polygons.map((polygon,j)=>polygon.map((p,k)=>{
    const dx=p[0]-previous[j][k][0],dy=p[1]-previous[j][k][1],step=Math.hypot(dx,dy),v=[REFERENCE_PIXELS_PER_WORLD_UNIT*dx/dt,REFERENCE_PIXELS_PER_WORLD_UNIT*dy/dt],speed=Math.hypot(...v);
    maximumStep=Math.max(maximumStep,step);perPiece[j]=Math.max(perPiece[j],speed);
    if(speed>maximumVelocity){maximumVelocity=speed;velocityPeak={pieceId:scene.occluders[j].id,vertexIndex:k,intervalStartNormalizedTime:(i-1)/intervals,intervalEndNormalizedTime:i/intervals,intervalStartSeconds:(i-1)*dt,intervalEndSeconds:i*dt,velocityWorldUnitsPerSecond:v.map(x=>x/REFERENCE_PIXELS_PER_WORLD_UNIT),speedWorldUnitsPerSecond:speed/REFERENCE_PIXELS_PER_WORLD_UNIT};}
    if(previousVelocity){const change=Math.hypot(v[0]-previousVelocity[j][k][0],v[1]-previousVelocity[j][k][1])/dt;if(change>maximumVelocityChange){maximumVelocityChange=change;velocityChangePeak={pieceId:scene.occluders[j].id,vertexIndex:k,previousIntervalStartSeconds:(i-2)*dt,sharedBoundarySeconds:(i-1)*dt,currentIntervalEndSeconds:i*dt,previousVelocityWorldUnitsPerSecond:previousVelocity[j][k].map(x=>x/REFERENCE_PIXELS_PER_WORLD_UNIT),currentVelocityWorldUnitsPerSecond:v.map(x=>x/REFERENCE_PIXELS_PER_WORLD_UNIT),velocityChangeRateWorldUnitsPerSecondSquared:change/REFERENCE_PIXELS_PER_WORLD_UNIT};}}
    return v;
   }));previousVelocity=velocities;
  }previous=polygons;
 }
 return{durationSeconds:scene.duration,intervals,actualIntervalSeconds:dt,normalizedTimeInterval:1/intervals,maximumVertexStepWorldUnits:maximumStep,referencePixelsPerWorldUnit:REFERENCE_PIXELS_PER_WORLD_UNIT,coordinateMeaning:'Fixed reference projection; not a measured browser canvas',maximumReferencePixelVelocityPerSecond:maximumVelocity,maximumReferencePixelVelocityChangePerSecondSquared:maximumVelocityChange,maximumVelocityWorldUnitsPerSecond:maximumVelocity/REFERENCE_PIXELS_PER_WORLD_UNIT,maximumVelocityChangeWorldUnitsPerSecondSquared:maximumVelocityChange/REFERENCE_PIXELS_PER_WORLD_UNIT,perPieceMaximumReferencePixelVelocity:perPiece,velocityPeak,velocityChangePeak};
}
function structure(original,candidate,locks){
 if(original.duration!==candidate.duration||original.occluders.length!==candidate.occluders.length||!same(original.light,candidate.light))throw Error('Original/candidate physical structure mismatch');
 original.occluders.forEach((p,i)=>{const q=candidate.occluders[i];if(p.id!==q.id||!same(p.vertices,q.vertices))throw Error('Original/candidate geometry mismatch');if(locks.includes(p.id)&&!same(p,q))throw Error('Candidate changed locked piece');for(const k of p.keys)if(!same(q.keys.find(x=>x.t===k.t),k))throw Error('Candidate changed original anchor');});
}
function invariant(original,candidate,proposal,locks){
 structure(original,proposal,locks);
 if(proposal.occluders.length!==candidate.occluders.length||!same(proposal.light,candidate.light)||proposal.duration!==candidate.duration)throw Error('Candidate structure changed');
 proposal.occluders.forEach((p,i)=>{const q=candidate.occluders[i];if(p.id!==q.id||!same(p.vertices,q.vertices)||p.keys.length!==q.keys.length)throw Error('Proposal geometry/topology changed');if(locks.includes(p.id)&&!same(p,q))throw Error('Locked candidate track changed');p.keys.forEach((k,j)=>{if(k.t!==q.keys[j].t||k.angle!==q.keys[j].angle)throw Error('Key time/angle changed');});});
 validateArticulatedScene(proposal);
}
const receipt={experiment:'estate95a-motion-refinement-v1',startedAt:new Date().toISOString(),source:{inputPath,inputSha256:hash(inputPath),scriptSha256:hash('scripts/motion-refinement-experiment.mjs'),coreSha256:hash('src/core.js'),articulatedSha256:hash('src/articulated.js')},method:{trainingTimes:TRAIN,heldOutTimes:HELD,trainingRasterResolution:64,heldOutRasterResolution:120,observationWindow:WINDOW,selectionMotionIntervals:100,finalMotionIntervals:200,maximumCandidateEvaluations:MAX_EVALUATIONS,trainingErrorAllowance:.01,selection:'Training-shape constraint plus projected motion objective; held-out scoring begins after selection',automaticAdoption:false},cases:[]};
if(receipt.source.inputSha256!=='af11e8db7dd36160c3b520e12ab3e62469f594cc99598f96b51afc178b4707f5')throw Error('Unexpected retained input receipt');
for(const item of input.cases){
 const started=performance.now(),sourceCaseBefore=JSON.stringify(item),row={name:item.name,status:'unresolved',adopted:false};let originalBefore,candidateBefore;
 try{
  const original=validateArticulatedScene(item.initialScene),candidate=validateArticulatedScene(item.finalScene);originalBefore=JSON.stringify(original);candidateBefore=JSON.stringify(candidate);
  if(!Array.isArray(item.transitionReport?.lockedIds)||item.transitionReport.lockedIds.some(id=>typeof id!=='string'))throw Error('Missing explicit locks');const lockedIds=[...item.transitionReport.lockedIds];
  if(new Set(lockedIds).size!==lockedIds.length||lockedIds.some(id=>!candidate.occluders.some(p=>p.id===id)))throw Error('Invalid lock identities');
  if(original.duration!==8||candidate.duration!==8)throw Error('Retained-fixture experiment requires unchanged eight-second duration');
  structure(original,candidate,lockedIds);item.targets.forEach((k,i)=>requireCoverage(k.polygon,'authored '+i));
  const training=prepare(item.targets,TRAIN,64),baseShape=shape(candidate,training),baseMotion=motion(candidate);
  if(!baseShape.qualified)throw Error('Candidate exceeds fixed observation window');
  const vk='maximumReferencePixelVelocityPerSecond',ck='maximumReferencePixelVelocityChangePerSecondSquared',vs=Math.max(baseMotion[vk],1e-9),cs=Math.max(baseMotion[ck],1e-9),objective=m=>m[vk]/vs+.35*m[ck]/cs;
  let best=clone(candidate),bestMotion=baseMotion,bestShape=baseShape,bestScore=objective(baseMotion),evaluations=0,selectionMotionPasses=1,trainingShapePasses=1;
  const accepted=[],adjustable=[];
  function consider(proposal,label){
   if(evaluations>=MAX_EVALUATIONS)return false;evaluations++;
   try{
    invariant(original,candidate,proposal,lockedIds);selectionMotionPasses++;const m=motion(proposal);
    if(m[vk]>baseMotion[vk]*1.001||m[ck]>baseMotion[ck]*1.001||objective(m)>=bestScore-1e-8)return false;
    trainingShapePasses++;const s=shape(proposal,training);if(!s.qualified||s.mean>baseShape.mean+.01)return false;
    best=proposal;bestMotion=m;bestShape=s;bestScore=objective(m);accepted.push({label,evaluation:evaluations,shapeMean:s.mean,motion:m});return true;
   }catch{return false;}
  }
  candidate.occluders.forEach((p,pi)=>{if(lockedIds.includes(p.id))return;const anchors=original.occluders[pi].keys;p.keys.forEach((k,ki)=>{if(!anchors.some(a=>a.t===k.t))adjustable.push({pi,ki,t:k.t});});});
  for(const fraction of [.75,.5,.25,0]){
   const proposal=clone(candidate);for(const{pi,ki,t}of adjustable){const reference=sampleArticulatedScene(original,t).occluders[pi],key=proposal.occluders[pi].keys[ki];for(const f of ['x','y','z'])key[f]=reference[f]+fraction*(key[f]-reference[f]);}
   consider(proposal,'joint-original-pose-pull-'+fraction);
  }
  for(const scale of [1,.5]){
   const ranked=bestMotion.perPieceMaximumReferencePixelVelocity.map((speed,index)=>({speed,index})).sort((a,b)=>b.speed-a.speed).slice(0,2).map(r=>r.index);
   for(const v of adjustable.filter(a=>ranked.includes(a.pi)))for(const[field,step]of [['x',.015],['y',.015],['z',.05]])for(const direction of [-1,1]){if(evaluations>=MAX_EVALUATIONS)break;const proposal=clone(best);proposal.occluders[v.pi].keys[v.ki][field]+=direction*step*scale;consider(proposal,'local-'+v.pi+'-'+v.ki+'-'+field+'-'+direction+'-'+scale);}
  }
  invariant(original,candidate,best,lockedIds);
  // No selection occurs after the held-out references become available.
  const held=prepare(item.targets,HELD,120),originalHeld=shape(original,held),candidateHeld=shape(candidate,held),proposedHeld=shape(best,held),originalMotion=motion(original,200),candidateMotion=motion(candidate,200),proposedMotion=motion(best,200);
  const existingGain=originalHeld.mean-candidateHeld.mean,allowedGainLoss=Math.max(0,Math.min(.005,existingGain*.10)),preservesShapeGain=existingGain>0&&proposedHeld.qualified&&proposedHeld.mean<=candidateHeld.mean+allowedGainLoss&&proposedHeld.mean<originalHeld.mean,improvesMotion=proposedMotion[vk]<candidateMotion[vk]*.99&&proposedMotion[ck]<=candidateMotion[ck]*1.001;
  if(JSON.stringify(original)!==originalBefore||JSON.stringify(candidate)!==candidateBefore||JSON.stringify(item)!==sourceCaseBefore)throw Error('Input mutated during experiment');
  Object.assign(row,{status:'measured',qualifiedImprovement:originalHeld.qualified&&candidateHeld.qualified&&preservesShapeGain&&improvesMotion,actualDurationSeconds:8,candidateEvaluations:evaluations,work:{selectionMotionPasses,trainingShapePasses,heldOutShapePasses:3,finalMotionPasses:3},lockedIds,adjustableInsertedKeys:adjustable.length,acceptedSteps:accepted,training:{candidate:baseShape,proposal:bestShape},heldOut:{original:originalHeld,candidate:candidateHeld,proposal:proposedHeld,existingGain,allowedGainLoss,preservesShapeGain},motion:{original:originalMotion,candidate:candidateMotion,proposal:proposedMotion,improvesMotion},originalCandidate:candidate,proposedScene:best,preservationVerified:true,elapsedMs:performance.now()-started});
 }catch(error){row.error=error.message;row.elapsedMs=performance.now()-started;}
 if(JSON.stringify(item)!==sourceCaseBefore){row.status='unresolved';row.qualifiedImprovement=false;row.error='Source receipt case mutated';}
 receipt.cases.push(row);
 console.log(JSON.stringify({name:row.name,status:row.status,qualifiedImprovement:row.qualifiedImprovement,candidateEvaluations:row.candidateEvaluations,heldOut:row.heldOut?{original:row.heldOut.original.mean,candidate:row.heldOut.candidate.mean,proposal:row.heldOut.proposal.mean,preservesShapeGain:row.heldOut.preservesShapeGain}:null,motion:row.motion?{candidateVelocity:row.motion.candidate.maximumVelocityWorldUnitsPerSecond,proposalVelocity:row.motion.proposal.maximumVelocityWorldUnitsPerSecond,candidateVelocityChange:row.motion.candidate.maximumVelocityChangeWorldUnitsPerSecondSquared,proposalVelocityChange:row.motion.proposal.maximumVelocityChangeWorldUnitsPerSecondSquared,improvesMotion:row.motion.improvesMotion}:null,work:row.work,elapsedMs:row.elapsedMs,error:row.error}));
}
receipt.finishedAt=new Date().toISOString();receipt.limitations=['Smoothstep still forces zero velocity at every key.','Bounded local search, not global optimum.','Training tolerance is explicit; held-out quality is observed only after selection.','Motion extrema are sampled, not analytic bounds; reference pixel units use declared260px/worldunit, not a browser-canvas measurement.','No automatic adoption or artistic/collision qualification.','Raw losses and unqualified cases remain in this receipt.'];
fs.writeFileSync(outputPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({receipt:outputPath,sha256:hash(outputPath)}));
