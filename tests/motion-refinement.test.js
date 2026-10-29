import test from 'node:test';
import assert from 'node:assert/strict';
import {refineMotion} from '../src/motion-refinement.js';
const clone=value=>structuredClone(value);
function fixture(count=2){
  const vertices=[[-.25,-.25],[.25,-.25],[.25,.25],[-.25,.25]];
  const original={format:'shadow-stage/articulated-v1',duration:8,light:{keys:[{t:0,x:0,y:0,z:5}]},occluders:Array.from({length:count},(_,i)=>({id:`piece-${i}`,vertices:clone(vertices),keys:[0,.5,1].map(t=>({t,x:0,y:0,z:2.5,angle:0}))}))};
  const candidate=clone(original);
  for(let i=1;i<count;i++)candidate.occluders[i].keys=[...candidate.occluders[i].keys,...[1/6,1/3,2/3,5/6].map((t,j)=>({t,x:j%2?.05:-.05,y:0,z:2.5,angle:0}))].sort((a,b)=>a.t-b.t);
  const square=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]],targets=[0,.5,1].map(t=>({t,polygon:clone(square)}));return {targets,original,candidate};
}
test('portable proposal preserves inputs, anchors, locks and explicit assessment split',()=>{
  const input=fixture(),before=JSON.stringify(input),result=refineMotion(input.targets,input.original,input.candidate,{lockedIds:['piece-0'],maxEvaluations:8});
  assert.equal(JSON.stringify(input),before);assert.deepEqual(result.originalCandidate,input.candidate);assert.deepEqual(result.scene.light,input.original.light);assert.deepEqual(result.scene.occluders[0],input.original.occluders[0]);assert.equal(result.scene.duration,8);
  input.original.occluders.forEach((piece,i)=>{assert.equal(result.scene.occluders[i].id,piece.id);assert.deepEqual(result.scene.occluders[i].vertices,piece.vertices);for(const anchor of piece.keys)assert.deepEqual(result.scene.occluders[i].keys.find(key=>key.t===anchor.t),anchor);});
  assert.deepEqual(result.report.comparison.trainingTimes,[1/6,1/3,2/3,5/6]);assert.deepEqual(result.report.comparison.heldOutTimes,[1/12,.25,5/12,7/12,.75,11/12]);assert.ok(result.report.work.candidateAttempts>0);assert.ok(result.report.work.candidateAttempts<=8);assert.equal(result.report.automaticAdoption,false);
  // The original already matches the reference; motion-only improvement cannot
  // be relabeled as preservation of a nonexistent prior silhouette gain.
  assert.equal(result.report.qualifiedImprovement,false);assert.equal(result.report.heldOut.maximumErrorDelta,result.report.heldOut.proposal.maximum-result.report.heldOut.candidate.maximum);
  assert.throws(()=>refineMotion(input.targets,input.original,input.candidate,{}),/lockedIds/);
});
test('combined-work admission and early rejection',()=>{
  const input=fixture(24),before=JSON.stringify(input),small=refineMotion(input.targets,input.original,input.candidate,{lockedIds:['piece-0'],maxEvaluations:1});
  assert.ok(small.report.work.estimate.shapeAndReferenceEdgeChecks<=small.report.work.limits.shapeAndReferenceEdgeChecks);
  assert.throws(()=>refineMotion(input.targets,input.original,input.candidate,{lockedIds:['piece-0'],maxEvaluations:256,trainingResolution:128,measurementResolution:192,motionIntervals:400,assessmentIntervals:800}),error=>{assert.equal(error.code,'MOTION_WORK_LIMIT');assert.ok(error.exceededWorkLimits.length>0);assert.equal(error.workAtRejection.referenceRasterCells,0);assert.equal(error.workAtRejection.shapePasses,0);assert.equal(error.workAtRejection.motionPasses,0);return true;});assert.equal(JSON.stringify(input),before);
});
