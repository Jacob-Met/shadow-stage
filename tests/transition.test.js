import test from 'node:test';
import assert from 'node:assert/strict';
import {fitScene} from '../src/core.js';
import {projectArticulated,validateArticulatedScene} from '../src/articulated.js';
import {refineTransitions} from '../src/transition.js';

const square=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
const transform=(scale,x)=>square.map(([a,b])=>[a*scale+x,b*scale]);
const targets=[{t:0,polygon:transform(1,-.35)},{t:1,polygon:transform(.5,.35)}];
function seed(){const single=fitScene(targets,{lightShare:.65,duration:4}).scene;return validateArticulatedScene({format:'shadow-stage/articulated-v1',duration:single.duration,light:single.light,occluders:[{id:'piece-1',...single.occluder}]});}
function inside(x,y,p){let result=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;}
function independentError(scene,t){
  const u=t*t*(3-2*t);
  const desired=targets[0].polygon.map((p,i)=>p.map((value,j)=>value+u*(targets[1].polygon[i][j]-value)));
  const actual=projectArticulated(scene,t);
  for(const polygon of actual)for(const [x,y] of polygon)assert.ok(x>=-1.2&&x<=1.2&&y>=-1.2&&y<=1.2,'Independent observation window must contain the full shadow');
  let union=0,xor=0,targetCells=0;
  for(let y=0;y<151;y++)for(let x=0;x<151;x++){
    const X=-1.2+(x+.5)*2.4/151,Y=-1.2+(y+.5)*2.4/151;
    const a=actual.some(p=>inside(X,Y,p)),b=inside(X,Y,desired);
    if(b)targetCells++;if(a||b)union++;if(a!==b)xor++;
  }
  assert.ok(targetCells>=4);return union?xor/union:0;
}
test('only inserted keys change; authored geometry and inputs survive',()=>{
  const original=seed(),before=JSON.stringify(original),authored=JSON.stringify(targets);
  const result=refineTransitions(targets,original,{iterations:4,maxEvaluations:48});
  assert.equal(JSON.stringify(original),before);assert.equal(JSON.stringify(targets),authored);
  assert.deepEqual(result.scene.light,original.light);assert.equal(result.scene.occluders.length,original.occluders.length);
  for(const piece of original.occluders){const output=result.scene.occluders.find(p=>p.id===piece.id);assert.deepEqual(output.vertices,piece.vertices);for(const key of piece.keys)assert.deepEqual(output.keys.find(k=>k.t===key.t),key);}
  for(const target of targets)assert.deepEqual(projectArticulated(result.scene,target.t),projectArticulated(original,target.t));
  assert.equal(result.report.insertedKeys.length,2);assert.ok(result.report.work.candidateAttempts<=48);assert.ok(result.report.work.candidateRasterEvaluations<=result.report.work.candidateAttempts);
});
test('independent held-out scale/translation fixture requires practical gain',()=>{
  const original=seed(),result=refineTransitions(targets,original,{iterations:6,maxEvaluations:72,resolution:64,measurementResolution:160});
  const heldOut=[1/6,.5,5/6],before=heldOut.map(t=>independentError(original,t)),after=heldOut.map(t=>independentError(result.scene,t));
  const sum=values=>values.reduce((a,b)=>a+b,0),meanBefore=sum(before)/before.length,meanAfter=sum(after)/after.length,improvement=meanBefore-meanAfter;
  const evidence=JSON.stringify({before,after,improvement,report:result.report.heldOut});
  assert.ok(sum(after)<sum(before),evidence);
  assert.ok(improvement>=.02||(meanBefore>0&&improvement/meanBefore>=.10),'Independent held-out improvement misses the declared threshold: '+evidence);
  assert.ok(Math.max(...after)<=Math.max(...before)+.02,'Mean gain must not conceal a worse independent peak: '+evidence);
  assert.ok(result.report.heldOut.meanImprovement>0,evidence);assert.equal(result.report.heldOut.numericallyImproved,true,evidence);assert.equal(result.report.heldOut.qualifiedImprovement,true,evidence);
});
test('locked pieces and existing non-authored keys survive exactly',()=>{
  const original=seed();original.occluders.push({...structuredClone(original.occluders[0]),id:'locked-piece'});
  original.occluders[0].keys.splice(1,0,{t:.2,x:0,y:0,z:2,angle:0});
  const oldKey=structuredClone(original.occluders[0].keys[1]),locked=structuredClone(original.occluders[1]);
  const result=refineTransitions(targets,original,{lockedIds:['locked-piece'],maxEvaluations:12});
  assert.deepEqual(result.scene.occluders[1],locked);assert.deepEqual(result.scene.occluders[0].keys.find(k=>k.t===.2),oldKey);assert.ok(result.report.insertedKeys.every(k=>k.id==='piece-1'));
});
test('all-locked control does no optimization and retains the negative result',()=>{
  const original=seed(),result=refineTransitions(targets,original,{lockedIds:['piece-1']});
  assert.deepEqual(result.scene,original);assert.equal(result.report.insertedKeys.length,0);assert.equal(result.report.work.candidateAttempts,0);assert.equal(result.report.heldOut.meanImprovement,0);assert.equal(result.report.heldOut.numericallyImproved,false);assert.equal(result.report.heldOut.qualifiedImprovement,false);assert.equal(result.report.heldOut.generalizes,false);assert.deepEqual(result.report.heldOut.before,result.report.heldOut.after);assert.match(result.report.heldOut.conclusion,/not established/);
});
test('missing authored anchors and exhausted track capacity reject safely',()=>{
  const original=seed();original.occluders[0].keys[1].t=.9;assert.throws(()=>refineTransitions(targets,original),/authored-time physical anchor/);
  const crowded=seed(),a=crowded.occluders[0].keys[0];crowded.occluders[0].keys=Array.from({length:128},(_,i)=>({...a,t:i/127}));
  assert.throws(()=>refineTransitions(targets,crowded),/128-key limit/);assert.throws(()=>refineTransitions(targets,seed(),{lockedIds:['missing']}),/Locked IDs/);
});
test('near authored anchors are not accepted as exact preservation',()=>{
  const original=seed();original.occluders[0].keys[1].t=1-5e-11;const before=JSON.stringify(original);assert.throws(()=>refineTransitions(targets,original),/authored-time physical anchor/);assert.equal(JSON.stringify(original),before);
});
test('near insertion collision rejects without moving existing keys',()=>{
  const original=seed();original.occluders[0].keys.splice(1,0,{t:1/3+5e-11,x:0,y:0,z:2,angle:0});const before=JSON.stringify(original);assert.throws(()=>refineTransitions(targets,original),/near-insertion time collision/);assert.equal(JSON.stringify(original),before);
});
test('an exact existing insertion key remains unchanged',()=>{
  const original=seed(),anchor={t:1/3,x:0,y:0,z:2,angle:0};original.occluders[0].keys.splice(1,0,anchor);const result=refineTransitions(targets,original,{maxEvaluations:6});assert.deepEqual(result.scene.occluders[0].keys.find(k=>k.t===1/3),anchor);assert.equal(result.report.insertedKeys.length,1);
});
test('common final window contains all reported original and final geometry',()=>{
  const original=seed(),result=refineTransitions(targets,original,{iterations:4,maxEvaluations:48}),d=result.report.assessment.commonWindow;
  for(const candidate of [original,result.scene])for(const t of result.report.assessment.reportedTimes)for(const polygon of projectArticulated(candidate,t))for(const [x,y] of polygon){assert.ok(x>=d.x&&x<=d.x+d.size);assert.ok(y>=d.y&&y<=d.y+d.size);}
  assert.equal(result.report.assessment.fullyObserved,true);
  const rows=[...result.report.training.before,...result.report.training.initialized,...result.report.training.after,...result.report.heldOut.before,...result.report.heldOut.initialized,...result.report.heldOut.after];assert.ok(rows.every(r=>r.outsidePenalty===0));assert.ok(rows.every(r=>Number.isFinite(r.maskError)));
});
test('far valid geometry cannot conceal an unresolved small reference',()=>{
  const original=seed();original.occluders.push({id:'far-piece',vertices:[[-.01,-.01],[.01,-.01],[.01,.01],[-.01,.01]],keys:[{t:0,x:90,y:90,z:1,angle:0},{t:1,x:90,y:90,z:1,angle:0}]});assert.throws(()=>refineTransitions(targets,original,{lockedIds:['far-piece']}),/unresolved/);
});
test('assessment cost is bounded even with all pieces locked',()=>{
  const original=seed(),template=original.occluders[0];original.occluders=Array.from({length:64},(_,i)=>({...structuredClone(template),id:`piece-${i}`}));const manyTargets=Array.from({length:12},(_,i)=>({t:i/11,polygon:structuredClone(targets[0].polygon)}));assert.throws(()=>refineTransitions(manyTargets,original,{lockedIds:original.occluders.map(p=>p.id),measurementResolution:256}),/assessment budget exceeded/);
});
