// Independent scalar oracle: no maintained projector or sampler is used to
// calculate expected values. This script exercises only the public refiner API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { refineMotion } from '../src/motion-refinement.js';

const output = process.argv[2];
const receipt = {
  schema: 'shadow-stage.independent-motion-receiving.v1',
  startedAt: new Date().toISOString(), node: process.version, cases: [],
  status: 'running',
  method: 'A fixed light at z=5 and planar cutout at z=2.5 gives projection scale 2. Translation x=0.1*smoothstep(t) therefore moves every projected vertex by 0.2*smoothstep(t). Scalar secants and adjacent-secant differences supply the expected sampled maxima.',
  limitations: [
    'This checks sampled numerical metrics, not continuous-time extrema or artistic quality.',
    'The one-piece fixture has no inserted adjustable keys and does not test optimizer efficacy.',
    'The same normalized samples are compared across duration changes; this does not establish physical actuator dynamics.',
    'Existing retained-scene reproduction, work-admission and locked-anchor receivers remain necessary and separate.',
    'No retained negative dense-grid or inserted-key-neighborhood evidence is replaced by this result.'
  ]
};
const smooth = t => 3*t*t - 2*t*t*t;
function oracle(duration, intervals) {
  const dt = duration / intervals;
  const displacement = Array.from({length:intervals+1},(_,i)=>0.2*smooth(i/intervals));
  const velocity = displacement.slice(1).map((x,i)=>(x-displacement[i])/dt);
  const change = velocity.slice(1).map((v,i)=>(v-velocity[i])/dt);
  return {
    step: Math.max(...displacement.slice(1).map((x,i)=>Math.abs(x-displacement[i]))),
    speed: Math.max(...velocity.map(Math.abs)),
    rate: Math.max(...change.map(Math.abs))
  };
}
function fixture(duration) {
  const scene = {format:'shadow-stage/articulated-v1',duration,
    light:{keys:[{t:0,x:0,y:0,z:5}]},
    occluders:[{id:'scalar-oracle-piece',vertices:[[-.1,-.1],[.1,-.1],[.1,.1],[-.1,.1]],
      keys:[{t:0,x:0,y:0,z:2.5,angle:0},{t:1,x:.1,y:0,z:2.5,angle:0}]}]};
  const square=x=>[[x-.2,-.2],[x+.2,-.2],[x+.2,.2],[x-.2,.2]];
  return {scene,targets:[{t:0,polygon:square(0)},{t:1,polygon:square(.2)}]};
}
function close(actual, expected, name) {
  assert.ok(Number.isFinite(actual), `${name}: nonfinite actual`);
  const tolerance = 1e-10 * Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual-expected)<=tolerance, `${name}: ${actual} != ${expected} (tolerance ${tolerance})`);
}
function measure(duration, intervals) {
  const input=fixture(duration), before=JSON.stringify(input);
  const result=refineMotion(input.targets,input.scene,input.scene,{lockedIds:[],maxEvaluations:1,
    trainingResolution:32,measurementResolution:32,motionIntervals:64,assessmentIntervals:intervals});
  assert.equal(JSON.stringify(input),before);
  const expected=oracle(duration,intervals);
  for(const name of ['original','candidate','proposal']) {
    const actual=result.report.motion[name];
    assert.equal(actual.durationSeconds,duration); assert.equal(actual.intervals,intervals);
    close(actual.actualIntervalSeconds,duration/intervals,`${name} dt`);
    close(actual.maximumVertexStepWorldUnits,expected.step,`${name} displacement`);
    close(actual.maximumVelocityWorldUnitsPerSecond,expected.speed,`${name} velocity`);
    close(actual.maximumVelocityChangeWorldUnitsPerSecondSquared,expected.rate,`${name} velocity-change rate`);
    close(actual.maximumReferencePixelVelocityPerSecond,260*expected.speed,`${name} reference velocity`);
    close(actual.maximumReferencePixelVelocityChangePerSecondSquared,260*expected.rate,`${name} reference velocity-change`);
    assert.equal(actual.perPieceMaximumVelocityWorldUnitsPerSecond.length,1);
    close(actual.perPieceMaximumVelocityWorldUnitsPerSecond[0],expected.speed,`${name} per-piece velocity`);
  }
  assert.equal(result.report.adjustableInsertedKeys,0);
  assert.equal(result.report.work.candidateAttempts,0);
  assert.equal(result.report.qualifiedImprovement,false);
  assert.equal(result.report.automaticAdoption,false);
  assert.deepEqual(result.scene,input.scene);
  return {duration,intervals,expected,actual:result.report.motion.proposal,shape:result.report.heldOut};
}
try {
  // Odd and even interval counts exercise maxima on different secant grids.
  for(const intervals of [63,200]) {
    const short=measure(8,intervals),long=measure(16,intervals);
    close(short.actual.maximumVelocityWorldUnitsPerSecond,2*long.actual.maximumVelocityWorldUnitsPerSecond,'duration-scaled velocity');
    close(short.actual.maximumVelocityChangeWorldUnitsPerSecondSquared,4*long.actual.maximumVelocityChangeWorldUnitsPerSecondSquared,'duration-scaled velocity-change');
    close(short.actual.maximumVertexStepWorldUnits,long.actual.maximumVertexStepWorldUnits,'duration-independent displacement');
    assert.deepEqual(short.shape,long.shape,'duration change must not change normalized-time silhouette evidence');
    receipt.cases.push({name:`scalar translation and 8-to-16-second scaling / ${intervals} intervals`,status:'passed',short,long});
  }
  receipt.status='passed';
} catch(error) {
  receipt.status='failed'; receipt.failure={name:error.name,message:error.message,stack:error.stack};
  process.exitCode=1;
}
receipt.finishedAt=new Date().toISOString();
if(output) fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(receipt,null,2));
