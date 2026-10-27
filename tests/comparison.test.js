import test from 'node:test';
import assert from 'node:assert/strict';
import {compareConstructions} from '../src/comparison.js';

function fixture() {
  return {format:'shadow-stage/articulated-v1',duration:8,
    light:{keys:[{t:0,x:0,y:0,z:5},{t:1,x:0,y:0,z:5}]},
    occluders:[{id:'piece-1',vertices:[[-.2,-.2],[.2,-.2],[.2,.2],[-.2,.2]],
      keys:[{t:0,x:0,y:0,z:2,angle:0},{t:1,x:0,y:0,z:2,angle:0}]}]};
}
const targets=[0,1].map(t=>({t,polygon:[[-.34,-.34],[.34,-.34],[.34,.34],[-.34,.34]]}));
const options={iterations:1,resolution:16,maxEvaluations:12,observationResolution:32,samples:3};

test('identical constructions compare equally without mutating inputs',()=>{
  const baseline=fixture(),proposed=fixture(),before=structuredClone({targets,baseline,proposed});
  const result=compareConstructions(targets,baseline,proposed,options);
  assert.deepEqual({targets,baseline,proposed},before);
  assert.equal(result.differences.finalAuthoredMeanIoU,0);
  assert.deepEqual(result.geometry,{pieces:1,vertices:4});
  assert.equal(result.fidelity.baselineInitial.authoredKeys.sampleCount,2);
  assert.equal(result.fidelity.baselineInitial.authorSelectedIntermediateMorph.sampleCount,1);
  for(const name of ['baseline','proposed']){
    const w=result.work[name];
    assert.equal(w.configuredMaxEvaluations,12);assert.equal(w.configuredIterations,1);assert.equal(w.configuredResolution,16);
    assert.ok(w.actualCandidateAttempts>0&&w.actualCandidateAttempts<=12);
    assert.ok(w.candidateRasterEvaluations>0&&w.candidateRasterEvaluations<=w.actualCandidateAttempts);
    assert.ok(w.initialObjectiveEvaluations>0);assert.notEqual(w.finalMeasurement,undefined);
    assert.equal(w.optimizerEvaluationsAlias,w.actualCandidateAttempts);
    assert.match(w.optimizerEvaluationsAliasMeaning,/not raster evaluations/);
  }
  assert.equal(result.executed,undefined);assert.equal(result.modelGain,undefined);
});
test('unequal actual geometry and duration reject before comparison',()=>{
  const extra=fixture();extra.occluders.push({...structuredClone(extra.occluders[0]),id:'piece-2'});
  assert.throws(()=>compareConstructions(targets,fixture(),extra,options),/equal actual piece and total vertex counts/);
  const triangle=fixture();triangle.occluders[0].vertices=[[-.2,-.2],[.2,-.2],[0,.2]];
  assert.throws(()=>compareConstructions(targets,fixture(),triangle,options),/equal actual piece and total vertex counts/);
  const longer=fixture();longer.duration=9;
  assert.throws(()=>compareConstructions(targets,fixture(),longer,options),/equal performance durations/);
});
test('all four states share the same complete sampled observation window',()=>{
  const proposed=fixture();for(const key of proposed.occluders[0].keys)key.x=.45;
  const result=compareConstructions(targets,fixture(),proposed,options);
  assert.ok(result.observation.window.maxX>1);
  assert.deepEqual(result.observation.times,[0,.5,1]);
  assert.equal(result.observation.rasterCellsPerCase,3*32*32);
  assert.equal(result.observation.targetCellTests,3*32*32);
  assert.equal(result.observation.shadowUnionCellTests,4*3*32*32);
  for(const row of result.observations){
    assert.ok(row.targetCells>=4);
    assert.deepEqual(Object.keys(row.cases).sort(),['baselineFinal','baselineInitial','proposedFinal','proposedInitial']);
  }
  assert.ok(result.fidelity.baselineInitial.authoredKeys.meanIoU>result.fidelity.proposedInitial.authoredKeys.meanIoU);
});
test('unresolved tiny targets cannot earn empty-mask agreement',()=>{
  const tiny=targets.map(k=>({t:k.t,polygon:k.polygon.map(p=>p.map(v=>v*.001))}));
  assert.throws(()=>compareConstructions(tiny,fixture(),fixture(),options),/unresolved/i);
});
test('invalid producer and observation budgets reject',()=>{
  for(const patch of [{iterations:0},{iterations:17},{resolution:15},{resolution:97},
    {maxEvaluations:0},{maxEvaluations:20001},{maxEvaluations:Infinity},{samples:102},{observationResolution:257}]){
    assert.throws(()=>compareConstructions(targets,fixture(),fixture(),{...options,...patch}),/must be an integer/);
  }
});
test('unsupported or malformed lock constraints cannot silently disappear',()=>{
  for(const patch of [{baselineLockedCutouts:['piece-1']},{currentLockedCutouts:['piece-1']}]){
    assert.throws(()=>compareConstructions(targets,fixture(),fixture(),{...options,...patch}),/locked cutouts are not supported/);
  }
  for(const patch of [{baselineLockedCutouts:null},{baselineLockedCutouts:'piece-1'},
    {currentLockedCutouts:{}},{currentLockedCutouts:false}]){
    assert.throws(()=>compareConstructions(targets,fixture(),fixture(),{...options,...patch}),/must be an array/);
  }
  const baseline=fixture();baseline.lockedCutouts=['piece-1'];
  assert.throws(()=>compareConstructions(targets,baseline,fixture(),options),/baseline scene lockedCutouts.*not supported/);
  const current=fixture();current.lockedCutouts=['piece-1'];
  assert.throws(()=>compareConstructions(targets,fixture(),current,options),/current scene lockedCutouts.*not supported/);
});
test('refinement retains each exact fixed light and piece construction',()=>{
  const baseline=fixture(),current=fixture();for(const key of current.occluders[0].keys)key.x=.15;
  const result=compareConstructions(targets,baseline,current,{...options,baselineLockedCutouts:[],currentLockedCutouts:[]});
  const fixed=scene=>({light:scene.light,pieces:scene.occluders.map(p=>({id:p.id,vertices:p.vertices}))});
  assert.deepEqual(fixed(result.scenes.baselineFinal),fixed(baseline));
  assert.deepEqual(fixed(result.scenes.proposedFinal),fixed(current));
  assert.equal(result.optimizationDomain.sharedBetweenConstructions,true);
  assert.equal(result.optimizationDomain.resolution,options.resolution);
});
test('a valid large assessment is bounded before expensive raster work',()=>{
  const a=fixture(),piece=a.occluders[0];
  a.occluders=Array.from({length:64},(_,i)=>({...structuredClone(piece),id:'piece-'+i}));
  assert.throws(()=>compareConstructions(targets,a,a,{...options,samples:101,observationResolution:256}),/assessment budget exceeded/);
});
