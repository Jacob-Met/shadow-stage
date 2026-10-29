import {validateTargets, targetAt} from './core.js';
import {validateArticulatedScene, sampleArticulatedScene, projectArticulated} from './articulated.js';

const clone=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const REFERENCE_SCALE=260;
function integer(value,min,max,name){if(!Number.isInteger(value)||value<min||value>max)throw new Error(`Invalid ${name}`);return value;}
function inside(x,y,polygon){let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function outside(points,window){return points.filter(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y)||x<window.lo||x>window.lo+window.side||y<window.lo||y>window.lo+window.side).length;}
// Weighted rational construction reproduces retained literal fractions without
// snapping or modifying any existing physical key time.
function referenceTimes(targets,numerators,denominator){return targets.slice(0,-1).flatMap((a,i)=>{const b=targets[i+1];return numerators.map(n=>(a.t*(denominator-n)+b.t*n)/denominator);});}
function checkStructure(original,candidate,lockedIds){
  if(original.duration!==candidate.duration)throw new Error('Scene durations must match');
  if(!same(original.light,candidate.light))throw new Error('Transition candidate changed the light');
  if(original.occluders.length!==candidate.occluders.length)throw new Error('Transition candidate changed piece count');
  original.occluders.forEach((piece,index)=>{
    const next=candidate.occluders[index];
    if(piece.id!==next.id||!same(piece.vertices,next.vertices))throw new Error('Transition candidate changed identity, ordering or mesh');
    if(lockedIds.includes(piece.id)&&!same(piece,next))throw new Error('Transition candidate changed a locked track');
    for(const anchor of piece.keys){const retained=next.keys.find(k=>Math.abs(k.t-anchor.t)<1e-10);if(!same(anchor,retained))throw new Error('Transition candidate changed an original anchor');}
  });
}

export function refineMotion(inputTargets,inputOriginal,inputCandidate,{lockedIds,maxEvaluations=64,trainingResolution=64,measurementResolution=120,motionIntervals=100,assessmentIntervals=200,window={lo:-1.2,side:2.4}}={}){
  const untouched={targets:JSON.stringify(inputTargets),original:JSON.stringify(inputOriginal),candidate:JSON.stringify(inputCandidate)};
  const targets=validateTargets(inputTargets),original=validateArticulatedScene(inputOriginal),candidate=validateArticulatedScene(inputCandidate);
  if(targets.length<2)throw new Error('Motion refinement needs two authored moments');
  if(!Array.isArray(lockedIds)||lockedIds.some(id=>typeof id!=='string')||new Set(lockedIds).size!==lockedIds.length)throw new Error('Explicit unique lockedIds are required');
  lockedIds=[...lockedIds];for(const id of lockedIds)if(!candidate.occluders.some(piece=>piece.id===id))throw new Error(`Unknown locked piece: ${id}`);
  integer(maxEvaluations,1,256,'candidate attempt budget');integer(trainingResolution,16,128,'training resolution');integer(measurementResolution,32,192,'assessment resolution');integer(motionIntervals,32,400,'selection motion intervals');integer(assessmentIntervals,32,800,'assessment motion intervals');
  if(!Number.isFinite(window.lo)||!Number.isFinite(window.side)||window.side<=0||window.side>200||!Number.isFinite(window.lo+window.side))throw new Error('Invalid fixed observation window');
  window={lo:window.lo,side:window.side};
  if(!(candidate.duration/motionIntervals>0)||!(candidate.duration/assessmentIntervals>0))throw new Error('Duration is too small for motion assessment');
  for(const key of targets)if(outside(key.polygon,window))throw new Error('Authored target exceeds the fixed observation window');
  const originalBefore=JSON.stringify(original),candidateBefore=JSON.stringify(candidate);
  const trainingTimes=referenceTimes(targets,[1,2],3),heldOutTimes=referenceTimes(targets,[1,3,5],6);
  const work={candidateAttempts:0,invalidCandidates:0,motionPasses:0,projectedMotionFrames:0,shapePasses:0,projectedShapeFrames:0,shapeRasterCells:0,referenceRasterCells:0};

  // Combined admission guard: no raster or motion evaluation precedes this.
  const workLimits=Object.freeze({shapeAndReferenceEdgeChecks:200_000_000,motionProjectedVertices:2_000_000,samplerAndValidationUnits:20_000_000});
  const sceneVertices=Math.max(...[original,candidate].map(scene=>scene.occluders.reduce((sum,piece)=>sum+piece.vertices.length,0)));
  const samplerStateUnits=scene=>(scene.occluders.length+1)*scene.light.keys.length+scene.occluders.reduce((sum,piece)=>sum+piece.keys.length+piece.vertices.length,0)+scene.occluders[0].keys.length+scene.occluders[0].vertices.length;
  const originalStateUnits=samplerStateUnits(original),candidateStateUnits=samplerStateUnits(candidate);
  const adjustableKeyUpperBound=candidate.occluders.reduce((sum,piece)=>sum+(lockedIds.includes(piece.id)?0:piece.keys.length),0);
  const anchorComparisonUnits=original.occluders.reduce((sum,piece,index)=>sum+piece.keys.length*(candidate.occluders[index]?.keys.length||0),0);
  // Polygon validation checks nonadjacent edge pairs, so repeated candidate
  // validation needs a quadratic allowance as well as track sampling.
  const polygonPairUnits=[original,candidate].reduce((sum,scene)=>sum+scene.occluders.reduce((subtotal,piece)=>subtotal+piece.vertices.length*(piece.vertices.length-1)/2,0),0);
  const referenceVertexBound=Math.max(64,...targets.map(key=>key.polygon.length));
  const trainingFrames=trainingTimes.length,heldOutFrames=heldOutTimes.length;
  const maximumTrainingShapeFrames=(maxEvaluations+1)*trainingFrames,maximumHeldOutShapeFrames=3*heldOutFrames;
  const maximumMotionFrames=(maxEvaluations+1)*(motionIntervals+1)+3*(assessmentIntervals+1);
  const shapeEdgeChecks=maximumTrainingShapeFrames*trainingResolution**2*sceneVertices+maximumHeldOutShapeFrames*measurementResolution**2*sceneVertices;
  const referenceEdgeChecks=(trainingFrames*trainingResolution**2+heldOutFrames*measurementResolution**2)*referenceVertexBound;
  const referenceAlignmentUnits=2*(trainingFrames+heldOutFrames)*referenceVertexBound**2;
  const workEstimate={sceneVertices,originalStateUnits,candidateStateUnits,adjustableKeyUpperBound,anchorComparisonUnits,polygonPairUnits,trainingFrames,heldOutFrames,referenceVertexBound,shapeEdgeChecks,referenceEdgeChecks,shapeAndReferenceEdgeChecks:shapeEdgeChecks+referenceEdgeChecks,motionProjectedVertices:maximumMotionFrames*sceneVertices,samplerAndValidationUnits:(maximumMotionFrames+maximumTrainingShapeFrames+maximumHeldOutShapeFrames)*Math.max(originalStateUnits,candidateStateUnits)+(maxEvaluations+4)*(originalStateUnits+candidateStateUnits+anchorComparisonUnits+polygonPairUnits)+4*adjustableKeyUpperBound*originalStateUnits+referenceAlignmentUnits,meaning:'Conservative combined admission estimates; not exact CPU instructions or a wall-clock prediction.'};
  const exceededWorkLimits=Object.entries(workLimits).filter(([name,limit])=>!Number.isFinite(workEstimate[name])||workEstimate[name]>limit).map(([name,limit])=>({name,estimated:workEstimate[name],limit}));
  if(exceededWorkLimits.length){const error=new Error('Motion refinement exceeds the combined work limit. Reduce the candidate budget, raster resolution, sampling intervals, number of authored moments, or scene geometry.');error.code='MOTION_WORK_LIMIT';error.workEstimate=workEstimate;error.workLimits=workLimits;error.exceededWorkLimits=exceededWorkLimits;error.workAtRejection={...work};throw error;}
  checkStructure(original,candidate,lockedIds);

  function prepare(times,n){return times.map(t=>{const polygon=targetAt(targets,t);if(outside(polygon,window))throw new Error(`Reference target at ${t} exceeds observation window`);const desired=[];let occupied=0;for(let y=0;y<n;y++)for(let x=0;x<n;x++){const hit=inside(window.lo+(x+.5)*window.side/n,window.lo+(y+.5)*window.side/n,polygon);desired.push(hit);if(hit)occupied++;}work.referenceRasterCells+=n*n;if(occupied<4)throw new Error('Reference silhouette is unresolved');return {t,n,desired};});}
  function shape(scene,references){
    work.shapePasses++;
    const rows=references.map(({t,n,desired})=>{const polygons=projectArticulated(scene,t);work.projectedShapeFrames++;const outsideVertices=outside(polygons.flat(),window);let union=0,xor=0;for(let y=0;y<n;y++)for(let x=0;x<n;x++){const X=window.lo+(x+.5)*window.side/n,Y=window.lo+(y+.5)*window.side/n,actual=polygons.some(p=>inside(X,Y,p)),expected=desired[y*n+x];if(actual||expected)union++;if(actual!==expected)xor++;}work.shapeRasterCells+=n*n;return {t,error:union?xor/union:1,outsideVertices};});
    return {rows,mean:rows.reduce((sum,row)=>sum+row.error,0)/rows.length,maximum:Math.max(...rows.map(row=>row.error)),qualified:rows.every(row=>row.outsideVertices===0)};
  }
  function motion(scene,intervals){
    work.motionPasses++;const dt=scene.duration/intervals;let previous=null,previousVelocity=null,maximumStep=0,maximumVelocity=0,maximumChange=0,velocityPeak=null,velocityChangePeak=null;const perPiece=scene.occluders.map(()=>0);
    for(let i=0;i<=intervals;i++){
      const polygons=projectArticulated(scene,i/intervals);work.projectedMotionFrames++;
      if(previous){const velocities=polygons.map((polygon,j)=>polygon.map((p,k)=>{
        const dx=p[0]-previous[j][k][0],dy=p[1]-previous[j][k][1],velocity=[dx/dt,dy/dt],speed=Math.hypot(...velocity);if(!Number.isFinite(speed))throw new Error('Nonfinite projected velocity');
        maximumStep=Math.max(maximumStep,Math.hypot(dx,dy));perPiece[j]=Math.max(perPiece[j],speed);
        if(speed>maximumVelocity){maximumVelocity=speed;velocityPeak={pieceId:scene.occluders[j].id,vertexIndex:k,intervalStartSeconds:(i-1)*dt,intervalEndSeconds:i*dt,velocityWorldUnitsPerSecond:velocity,speedWorldUnitsPerSecond:speed};}
        if(previousVelocity){const prior=previousVelocity[j][k],rate=Math.hypot(velocity[0]-prior[0],velocity[1]-prior[1])/dt;if(!Number.isFinite(rate))throw new Error('Nonfinite projected velocity-change rate');if(rate>maximumChange){maximumChange=rate;velocityChangePeak={pieceId:scene.occluders[j].id,vertexIndex:k,previousIntervalStartSeconds:(i-2)*dt,sharedBoundarySeconds:(i-1)*dt,currentIntervalEndSeconds:i*dt,previousVelocityWorldUnitsPerSecond:prior,currentVelocityWorldUnitsPerSecond:velocity,velocityChangeRateWorldUnitsPerSecondSquared:rate};}}
        return velocity;
      }));previousVelocity=velocities;}previous=polygons;
    }
    return {durationSeconds:scene.duration,intervals,actualIntervalSeconds:dt,normalizedTimeInterval:1/intervals,maximumVertexStepWorldUnits:maximumStep,maximumVelocityWorldUnitsPerSecond:maximumVelocity,maximumVelocityChangeWorldUnitsPerSecondSquared:maximumChange,maximumReferencePixelVelocityPerSecond:maximumVelocity*REFERENCE_SCALE,maximumReferencePixelVelocityChangePerSecondSquared:maximumChange*REFERENCE_SCALE,referencePixelsPerWorldUnit:REFERENCE_SCALE,coordinateMeaning:'Projected shadow vertices on stage plane; reference pixels are not a measured browser canvas',perPieceMaximumVelocityWorldUnitsPerSecond:perPiece,velocityPeak,velocityChangePeak};
  }
  function invariant(proposal){
    validateArticulatedScene(proposal);checkStructure(original,proposal,lockedIds);if(!same(proposal.light,candidate.light)||proposal.duration!==candidate.duration)throw new Error('Proposal changed light or duration');
    proposal.occluders.forEach((piece,index)=>{const before=candidate.occluders[index];if(piece.id!==before.id||!same(piece.vertices,before.vertices)||piece.keys.length!==before.keys.length)throw new Error('Proposal changed fixed structure');if(lockedIds.includes(piece.id)&&!same(piece,before))throw new Error('Proposal changed locked track');piece.keys.forEach((key,k)=>{if(key.t!==before.keys[k].t||key.angle!==before.keys[k].angle)throw new Error('Proposal changed key time or angle');});});
  }
  const training=prepare(trainingTimes,trainingResolution),baselineShape=shape(candidate,training);if(!baselineShape.qualified)throw new Error('Candidate exceeds observation window at training times');
  const baselineMotion=motion(candidate,motionIntervals),V='maximumVelocityWorldUnitsPerSecond',A='maximumVelocityChangeWorldUnitsPerSecondSquared';
  const velocityScale=Math.max(baselineMotion[V],1e-9),changeScale=Math.max(baselineMotion[A],1e-9),objective=m=>m[V]/velocityScale+.35*m[A]/changeScale;
  let best=clone(candidate),bestMotion=baselineMotion,bestShape=baselineShape,bestScore=objective(baselineMotion);const accepted=[],adjustable=[];
  candidate.occluders.forEach((piece,pieceIndex)=>{if(lockedIds.includes(piece.id))return;const anchors=original.occluders[pieceIndex].keys;piece.keys.forEach((key,keyIndex)=>{if(!anchors.some(anchor=>Math.abs(anchor.t-key.t)<1e-10))adjustable.push({pieceIndex,keyIndex,t:key.t});});});
  function consider(proposal,label){
    if(work.candidateAttempts>=maxEvaluations)return;work.candidateAttempts++;try{invariant(proposal);}catch{work.invalidCandidates++;return;}
    const measuredMotion=motion(proposal,motionIntervals);if(measuredMotion[V]>baselineMotion[V]*1.001||measuredMotion[A]>baselineMotion[A]*1.001||objective(measuredMotion)>=bestScore-1e-8)return;
    const measuredShape=shape(proposal,training);if(!measuredShape.qualified||measuredShape.mean>baselineShape.mean+.01)return;
    best=proposal;bestMotion=measuredMotion;bestShape=measuredShape;bestScore=objective(measuredMotion);accepted.push({label,attempt:work.candidateAttempts,trainingMean:bestShape.mean,velocity:bestMotion[V],velocityChange:bestMotion[A]});
  }
  if(adjustable.length){
    for(const retainedFraction of [.75,.5,.25,0]){if(work.candidateAttempts>=maxEvaluations)break;const proposal=clone(candidate);for(const {pieceIndex,keyIndex,t} of adjustable){const reference=sampleArticulatedScene(original,t).occluders[pieceIndex],key=proposal.occluders[pieceIndex].keys[keyIndex];for(const field of ['x','y','z'])key[field]=reference[field]+retainedFraction*(key[field]-reference[field]);}consider(proposal,`joint-original-pose-pull-${retainedFraction}`);}
    search:for(const scale of [1,.5]){const ranked=bestMotion.perPieceMaximumVelocityWorldUnitsPerSecond.map((speed,index)=>({speed,index})).sort((a,b)=>b.speed-a.speed).slice(0,2).map(row=>row.index);for(const variable of adjustable.filter(a=>ranked.includes(a.pieceIndex)))for(const [field,step]of [['x',.015],['y',.015],['z',.05]])for(const direction of [-1,1]){if(work.candidateAttempts>=maxEvaluations)break search;const proposal=clone(best);proposal.occluders[variable.pieceIndex].keys[variable.keyIndex][field]+=direction*step*scale;consider(proposal,`local-${variable.pieceIndex}-${variable.keyIndex}-${field}-${direction}-${scale}`);}}
  }
  invariant(best);
  // Selection has ended. No held-out assessment below can influence the search.
  const heldReferences=prepare(heldOutTimes,measurementResolution),heldOriginal=shape(original,heldReferences),heldCandidate=shape(candidate,heldReferences),heldProposal=shape(best,heldReferences);
  const motionOriginal=motion(original,assessmentIntervals),motionCandidate=motion(candidate,assessmentIntervals),motionProposal=motion(best,assessmentIntervals);
  const existingGain=heldOriginal.mean-heldCandidate.mean,allowedGainLoss=Math.max(0,Math.min(.005,existingGain*.10));
  const preservesShapeGain=existingGain>0&&heldOriginal.qualified&&heldCandidate.qualified&&heldProposal.qualified&&heldProposal.mean<=heldCandidate.mean+allowedGainLoss&&heldProposal.mean<heldOriginal.mean;
  const improvesMotion=motionProposal[V]<motionCandidate[V]*.99&&motionProposal[A]<=motionCandidate[A]*1.001;
  if(JSON.stringify(original)!==originalBefore||JSON.stringify(candidate)!==candidateBefore||JSON.stringify(inputTargets)!==untouched.targets||JSON.stringify(inputOriginal)!==untouched.original||JSON.stringify(inputCandidate)!==untouched.candidate)throw new Error('Motion refinement mutated an input');
  return {scene:best,originalCandidate:clone(candidate),report:{algorithm:'bounded-motion-refinement-v1',qualifiedImprovement:preservesShapeGain&&improvesMotion,automaticAdoption:false,lockedIds,preservation:{inputs:true,light:true,geometry:true,identityAndOrdering:true,originalAnchors:true,lockedTracks:true,keyTimes:true,angles:true},comparison:{durationSeconds:candidate.duration,window,trainingTimes,heldOutTimes,trainingResolution,measurementResolution,motionIntervals,assessmentIntervals,sameAssessmentTimesAndWindow:true},training:{candidate:baselineShape,proposal:bestShape},heldOut:{original:heldOriginal,candidate:heldCandidate,proposal:heldProposal,existingGain,allowedGainLoss,preservesShapeGain,maximumErrorDelta:heldProposal.maximum-heldCandidate.maximum,maximumErrorDidNotIncrease:heldProposal.maximum<=heldCandidate.maximum,qualificationScope:'Bounded mean-error gain retention; maximum held-out error is reported separately and is not constrained by this qualification.'},motion:{original:motionOriginal,candidate:motionCandidate,proposal:motionProposal,improvesMotion},work:{...work,maxEvaluations,budgetMeaning:'Candidate attempts; actual measured passes and raster cells are separate.',estimate:workEstimate,limits:workLimits},adjustableInsertedKeys:adjustable.length,acceptedSteps:accepted,limitations:['Smoothstep still forces zero velocity at every key.','Motion metrics concern projected shadow vertices, including vertices hidden by overlap.','Lower sampled projected-shadow motion peaks do not establish a visible or artistic improvement.','Raster equality does not establish identical pixels or exact silhouette preservation.','Qualification permits explicitly reported bounded held-out mean-error degradation.','Worst held-out moment error can increase despite qualification.','Final motion assessment uses a common denser grid and may reject a selection-grid improvement.','Held-out samples are assessed only after selection; repeated tuning on them invalidates that distinction.','No collision, fabrication, seamless-loop or analytic motion-bound guarantee.']}};
}
