import test from 'node:test';
import assert from 'node:assert/strict';
import {fitArticulated,refineArticulated,projectArticulated,sampleArticulatedScene,validateArticulatedScene} from '../src/articulated.js';
const changing=[{t:0,polygon:[[-.7,-.7],[.7,-.7],[.7,.7],[-.7,.7]]},{t:.5,polygon:[[-.7,-.7],[.7,-.7],[0,.7]]},{t:1,polygon:[[-.7,-.7],[.7,-.7],[.7,-.2],[-.2,-.2],[-.2,.7],[-.7,.7]]}];
test('multiple persistent physical pieces reproduce changing-shape keys',()=>{
  const original=JSON.stringify(changing),{scene,report}=fitArticulated(changing,{maxPieces:24});
  assert.equal(JSON.stringify(changing),original);
  assert.ok(scene.occluders.length>1);
  assert.ok(report.authoredMaskError<.13,JSON.stringify(report.authoredKeys));
  assert.ok(report.authoredMaskError<report.noSolveBaselineMaskError*.5);
  assert.ok(report.geometricallyValid&&report.persistentGeometry);
  for(const t of [0,.137,.5,.733,1]){
    const sample=sampleArticulatedScene(scene,t),actual=projectArticulated(scene,t);
    sample.occluders.forEach((o,i)=>{
      assert.deepEqual(o.vertices,scene.occluders[i].vertices);
      assert.ok(o.z>0&&o.z<sample.light.z);
      const l=sample.light,c=Math.cos(o.angle),s=Math.sin(o.angle);
      o.vertices.forEach(([x,y],j)=>{const k=l.z/(l.z-o.z),px=l.x+k*(o.x+c*x-s*y-l.x),py=l.y+k*(o.y+s*x+c*y-l.y);assert.ok(Math.abs(actual[i][j][0]-px)<1e-9&&Math.abs(actual[i][j][1]-py)<1e-9);});
    });
  }
});
test('insufficient geometry reports a worse fit rather than hiding missing shape',()=>{
  const low=fitArticulated(changing,{maxPieces:1}),high=fitArticulated(changing,{maxPieces:24});
  assert.ok(low.report.authoredMaskError>high.report.authoredMaskError+.1);
  assert.equal(low.report.complexity.occluders,1);
  assert.ok(low.report.optimization.keyCoverage.some(k=>k.uncoveredFraction>.1));
});
test('physical changes persist through JSON and tracks remain continuous at keys',()=>{
  const {scene}=fitArticulated(changing,{maxPieces:12});
  const restored=validateArticulatedScene(JSON.parse(JSON.stringify(scene)));
  assert.deepEqual(projectArticulated(restored,.37),projectArticulated(scene,.37));
  const a=projectArticulated(scene,.5-1e-7),b=projectArticulated(scene,.5+1e-7);
  a.forEach((p,i)=>p.forEach((v,j)=>v.forEach((x,k)=>assert.ok(Math.abs(x-b[i][j][k])<1e-7))));
  const modified=structuredClone(scene);modified.light.keys[0].x=.2;
  assert.notDeepEqual(projectArticulated(modified,.37),projectArticulated(scene,.37));
});
test('bounded prototype rejects invalid geometry and optimizer limits',()=>{
  assert.throws(()=>fitArticulated(changing,{maxPieces:0}));
  assert.throws(()=>fitArticulated(changing,{resolution:1000}));
  const {scene}=fitArticulated(changing,{maxPieces:2});scene.occluders[0].keys[0].z=5;
  assert.throws(()=>validateArticulatedScene(scene));
});
test('bounded refinement uses supplied scene, preserves targets and improves a displaced construction',()=>{
  const targets=[changing[0]],seed=fitArticulated(targets,{maxPieces:1}).scene;
  seed.occluders[0].keys[0].x+=.2;
  const original=JSON.stringify(seed),authored=JSON.stringify(targets);
  const result=refineArticulated(targets,seed,{iterations:4,maxEvaluations:32});
  assert.equal(JSON.stringify(seed),original);assert.equal(JSON.stringify(targets),authored);
  assert.deepEqual(result.scene.occluders[0].vertices,seed.occluders[0].vertices);
  assert.equal(result.scene.occluders.length,1);
  assert.equal(result.report.optimization.evaluations,32);
  assert.ok(result.report.optimization.finalObjective[0]<result.report.optimization.initialObjective[0]);
  const another=structuredClone(seed);another.occluders[0].keys[0].x-=.5;
  assert.notDeepEqual(refineArticulated(targets,another,{iterations:1,maxEvaluations:1}).scene,refineArticulated(targets,seed,{iterations:1,maxEvaluations:1}).scene,'Input construction must influence actual refined scene');
});
