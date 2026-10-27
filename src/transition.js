import {validateTargets,targetAt} from './core.js';
import {validateArticulatedScene,sampleArticulatedScene,projectArticulated} from './articulated.js';
const clone=v=>structuredClone(v);
const near=(a,b)=>Math.abs(a-b)<1e-10;
function inside(x,y,p){let hit=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function domainOf(polygons){let x=Infinity,y=Infinity,X=-Infinity,Y=-Infinity,n=0;for(const p of polygons)for(const [a,b] of p){if(!Number.isFinite(a)||!Number.isFinite(b))throw new Error('Nonfinite observation geometry.');x=Math.min(x,a);y=Math.min(y,b);X=Math.max(X,a);Y=Math.max(Y,b);n++;}const size=Math.max(X-x,Y-y);if(!n||!(size>0&&Number.isFinite(size)))throw new Error('Invalid observation extent.');return {x:x-size*.25,y:y-size*.25,size:size*1.5};}
function raster(polygons,d,n){return Array.from({length:n*n},(_,i)=>{const x=d.x+(i%n+.5)*d.size/n,y=d.y+(Math.floor(i/n)+.5)*d.size/n;return polygons.some(p=>inside(x,y,p));});}
function maskError(a,b){let union=0,xor=0;for(let i=0;i<a.length;i++){if(a[i]||b[i])union++;if(a[i]!==b[i])xor++;}return union?xor/union:0;}
function outside(polygons,d){let sum=0;for(const p of polygons)for(const [x,y] of p)sum+=Math.max(0,d.x-x,x-d.x-d.size,d.y-y,y-d.y-d.size)/d.size;return sum;}
function references(targets,times,d,n){return times.map(t=>{const m=raster([targetAt(targets,t)],d,n);if(m.filter(Boolean).length<4)throw new Error('Transition measurement unresolved: target occupies fewer than four raster cells.');return m;});}
function measure(scene,times,masks,d,n){return times.map((t,i)=>{const p=projectArticulated(scene,t);return {t,maskError:maskError(raster(p,d,n),masks[i]),outsidePenalty:outside(p,d)};});}
const mean=rows=>rows.length?rows.reduce((s,r)=>s+r.maskError,0)/rows.length:0;
function maximum(rows){let value=0;for(const r of rows)value=Math.max(value,r.maskError);return value;}
function motion(scene){let previous=null,maximumVertexStep=0,minimumLightClearance=Infinity;for(let i=0;i<=100;i++){const t=i/100,s=sampleArticulatedScene(scene,t);for(const p of s.occluders)minimumLightClearance=Math.min(minimumLightClearance,s.light.z-p.z);const polygons=projectArticulated(scene,t);if(previous)polygons.forEach((p,j)=>p.forEach((v,k)=>{maximumVertexStep=Math.max(maximumVertexStep,Math.hypot(v[0]-previous[j][k][0],v[1]-previous[j][k][1]));}));previous=polygons;}return {sampleCount:101,deltaT:.01,maximumVertexStep,minimumLightClearance,collisionAssessment:'Not performed; pieces may intersect.',interpretation:'Sampled displacement does not establish perceptual smoothness or collision clearance.'};}

export function refineTransitions(input,initialScene,{lockedIds=[],iterations=4,maxEvaluations=800,resolution=40,measurementResolution=120}={}){
  const targets=validateTargets(input),original=validateArticulatedScene(initialScene);
  if(targets.length<2)throw new Error('Transition refinement needs at least two authored moments.');
  if(!Number.isInteger(iterations)||iterations<1||iterations>12||!Number.isInteger(maxEvaluations)||maxEvaluations<1||maxEvaluations>20000||!Number.isInteger(resolution)||resolution<16||resolution>96||!Number.isInteger(measurementResolution)||measurementResolution<32||measurementResolution>256)throw new Error('Invalid transition refinement budget.');
  const ids=new Set(original.occluders.map(p=>p.id));
  if(!Array.isArray(lockedIds)||new Set(lockedIds).size!==lockedIds.length||lockedIds.some(id=>typeof id!=='string'||!ids.has(id)))throw new Error('Locked IDs must be distinct existing pieces.');
  const locked=new Set(lockedIds);
  for(const p of original.occluders){if(locked.has(p.id))continue;for(const k of targets)if(!p.keys.some(a=>a.t===k.t))throw new Error(`Piece ${p.id} lacks an authored-time physical anchor; existing motion was not changed.`);}
  const requestedTimes=[],heldOutTimes=[];
  for(let i=0;i<targets.length-1;i++){const a=targets[i].t,b=targets[i+1].t;for(const f of [1/3,2/3])requestedTimes.push(a+(b-a)*f);for(const f of [1/6,1/2,5/6])heldOutTimes.push(a+(b-a)*f);}
  const totalVertices=original.occluders.reduce((s,p)=>s+p.vertices.length,0);
  let targetVertexBound=64;for(const t of targets)targetVertexBound=Math.max(targetVertexBound,t.polygon.length);
  const assessmentTimes=requestedTimes.length+heldOutTimes.length,allTimeCount=targets.length+assessmentTimes;
  const assessmentEdgeChecks=measurementResolution**2*assessmentTimes*(3*totalVertices+targetVertexBound)+resolution**2*requestedTimes.length*(totalVertices+targetVertexBound);
  const windowVertices=4*allTimeCount*(totalVertices+targetVertexBound),motionVertices=202*totalVertices;
  const assessmentLimits={maximumEdgeChecks:150000000,maximumWindowVertices:100000,maximumMotionVertices:1000000};
  if(assessmentEdgeChecks>assessmentLimits.maximumEdgeChecks||windowVertices>assessmentLimits.maximumWindowVertices||motionVertices>assessmentLimits.maximumMotionVertices)throw new Error('Transition assessment budget exceeded; reduce geometry, moments or measurement resolution.');
  const scene=clone(original),inserted=[];
  for(let index=0;index<scene.occluders.length;index++){
    const p=scene.occluders[index];if(locked.has(p.id))continue;
    for(const t of requestedTimes)if(p.keys.some(k=>k.t!==t&&near(k.t,t)))throw new Error(`Piece ${p.id} has a near-insertion time collision; existing keys were not moved.`);
    const missing=requestedTimes.filter(t=>!p.keys.some(k=>k.t===t));
    if(p.keys.length+missing.length>128)throw new Error(`Piece ${p.id} would exceed the 128-key limit.`);
    for(const t of missing){const s=sampleArticulatedScene(original,t).occluders[index],key={t,x:s.x,y:s.y,z:s.z,angle:s.angle};p.keys.push(key);inserted.push({id:p.id,key});}
    p.keys.sort((a,b)=>a.t-b.t);
  }
  validateArticulatedScene(scene);
  const allTimes=[...targets.map(k=>k.t),...requestedTimes,...heldOutTimes];
  const domain=domainOf([...allTimes.map(t=>targetAt(targets,t)),...allTimes.flatMap(t=>projectArticulated(original,t))]);
  const trainingMasks=references(targets,requestedTimes,domain,resolution);
  const initializedScene=clone(scene);
  let minimumLight=Infinity;for(const k of scene.light.keys)minimumLight=Math.min(minimumLight,k.z);
  let candidateAttempts=0,candidateRasterEvaluations=0,initialObjectiveEvaluations=0;
  function objective(i){const p=projectArticulated(scene,requestedTimes[i]);return maskError(raster(p,domain,resolution),trainingMasks[i])+outside(p,domain);}
  const scores=requestedTimes.map((_,i)=>{initialObjectiveEvaluations++;return objective(i);}),initialObjective=scores.slice();
  outer:for(let iteration=0;iteration<iterations;iteration++){
    const fraction=.12*2**(-iteration);
    for(const {key} of inserted){
      const i=requestedTimes.findIndex(t=>t===key.t),light=sampleArticulatedScene(scene,key.t).light,m=light.z/(light.z-key.z),xyStep=domain.size*fraction/m,zStep=Math.min(.35,(light.z-key.z)*fraction*2);
      for(const [field,step] of [['x',xyStep],['y',xyStep],['z',zStep]]){
        const start=key[field];let selected=start,best=scores[i];
        for(const direction of [-1,1]){
          if(candidateAttempts>=maxEvaluations){key[field]=selected;scores[i]=best;break outer;}
          candidateAttempts++;const value=start+direction*step;
          if(!Number.isFinite(value)||Math.abs(value)>100||(field==='z'&&(value<.01||value>=minimumLight-.05)))continue;
          key[field]=value;candidateRasterEvaluations++;const score=objective(i);if(score<best-1e-12){selected=value;best=score;}
        }
        key[field]=selected;scores[i]=best;
      }
    }
  }
  validateArticulatedScene(scene);
  const assessmentDomain=domainOf([...allTimes.map(t=>targetAt(targets,t)),...allTimes.flatMap(t=>projectArticulated(original,t)),...allTimes.flatMap(t=>projectArticulated(initializedScene,t)),...allTimes.flatMap(t=>projectArticulated(scene,t))]);
  const evaluationMasks=references(targets,requestedTimes,assessmentDomain,measurementResolution),heldOutMasks=references(targets,heldOutTimes,assessmentDomain,measurementResolution);
  const assess=(candidate,times,masks)=>measure(candidate,times,masks,assessmentDomain,measurementResolution);
  const beforeTraining=assess(original,requestedTimes,evaluationMasks),initializedTraining=assess(initializedScene,requestedTimes,evaluationMasks),afterTraining=assess(scene,requestedTimes,evaluationMasks);
  const beforeHeldOut=assess(original,heldOutTimes,heldOutMasks),initializedHeldOut=assess(initializedScene,heldOutTimes,heldOutMasks),afterHeldOut=assess(scene,heldOutTimes,heldOutMasks);
  const improvement=mean(beforeHeldOut)-mean(afterHeldOut),baselineMean=mean(beforeHeldOut),relativeImprovement=baselineMean>0?improvement/baselineMean:0;
  const thresholds={absoluteMeanReduction:.02,relativeMeanReduction:.10,maximumPeakIncrease:.01,logic:'Positive mean improvement AND (absolute OR relative threshold) AND peak limit AND fully observed geometry.'};
  const numericallyImproved=improvement>1e-6,fullyObserved=[...beforeTraining,...initializedTraining,...afterTraining,...beforeHeldOut,...initializedHeldOut,...afterHeldOut].every(r=>r.outsidePenalty===0);
  const qualifiedImprovement=numericallyImproved&&(improvement>=thresholds.absoluteMeanReduction||relativeImprovement>=thresholds.relativeMeanReduction)&&maximum(afterHeldOut)<=maximum(beforeHeldOut)+thresholds.maximumPeakIncrease&&fullyObserved;
  return {scene,report:{
    specification:'targetAt boundary morph: an explicitly chosen transition specification, not observed intermediate ground truth.',
    insertedKeys:inserted.map(({id,key})=>({id,t:key.t})),lockedIds:[...lockedIds],
    preservation:{authoredPhysicalKeys:true,existingNonAuthoredKeys:true,targetData:true,fixedGeometry:true,pieceCountAndIds:true,lightTrack:true},
    training:{before:beforeTraining,initialized:initializedTraining,after:afterTraining,initialObjective,finalObjective:scores,beforeMean:mean(beforeTraining),afterMean:mean(afterTraining)},
    heldOut:{before:beforeHeldOut,initialized:initializedHeldOut,after:afterHeldOut,beforeMean:baselineMean,afterMean:mean(afterHeldOut),meanImprovement:improvement,beforeMaximum:maximum(beforeHeldOut),afterMaximum:maximum(afterHeldOut),relativeImprovement,numericallyImproved,qualifiedImprovement,generalizes:qualifiedImprovement,thresholds,conclusion:qualifiedImprovement?'Improvement meets the declared threshold at these held-out timestamps.':'Qualified held-out improvement is not established; retain all raw negative or insufficient-gain results.'},
    assessment:{commonWindow:assessmentDomain,optimizationWindow:domain,optimizationWindowEscape:allTimes.map(t=>({t,outsidePenalty:outside(projectArticulated(scene,t),domain)})),fullyObserved,reportedTimes:allTimes,interpretation:'Original, initialized and final scenes share one final assessment window. Target occupancy is rechecked after expansion.'},
    motion:{before:motion(original),after:motion(scene)},
    work:{iterations,resolution,measurementResolution,maxEvaluations,candidateAttempts,candidateRasterEvaluations,initialObjectiveEvaluations,targetRasterizations:requestedTimes.length*2+heldOutTimes.length,assessmentRasterizations:3*(requestedTimes.length+heldOutTimes.length),assessmentEdgeChecksUpperBound:assessmentEdgeChecks,windowVerticesUpperBound:windowVertices,motionVertices,assessmentLimits,motionSamples:202,budgetMeaning:'maxEvaluations caps candidate attempts only; initialization, reference masks, assessment and motion sampling are additional work.'},
    limitations:['Inserted smoothstep keys add zero-velocity moments and can make motion hesitant.','Optimization affects only inserted x/y/depth; rotation and light remain unchanged.','Existing non-authored keys may limit improvement.','No motion regularizer, collision clearance or fabricability evaluation.','No guarantee between measured timestamps or of seamless looping.']
  }};
}
