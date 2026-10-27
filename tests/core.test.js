import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTargets,validateScene,fitScene,sampleScene,projectShadow,targetAt,measureFit,DEFAULT_TARGETS} from '../src/core.js';

const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} differs from ${b}`);
test('ray projection has physically derived magnification and lamp offset',()=>{
  const scene={format:'shadow-stage/scene-v1',duration:8,light:{keys:[{t:0,x:1,y:-2,z:5}]},occluder:{vertices:[[0,0],[1,0],[0,1]],keys:[{t:0,x:0,y:0,z:2.5,angle:0}]}};
  assert.deepEqual(projectShadow(scene,0),[[-1,2],[1,2],[-1,4]]);
});
test('similar target keyframes solved by a single immutable cutout',()=>{
  const original=JSON.stringify(DEFAULT_TARGETS),{scene,report}=fitScene(DEFAULT_TARGETS);
  assert.ok(report.authoredKeyRms<1e-7);
  assert.ok(report.noSolveBaselineRms>.1);
  assert.equal(JSON.stringify(DEFAULT_TARGETS),original);
  for(let i=0;i<=100;i++) {
    const state=sampleScene(scene,i/100);
    assert.ok(state.occluder.z>0&&state.occluder.z<state.light.z);
    assert.deepEqual(state.occluder.vertices,scene.occluder.vertices);
    assert.ok(projectShadow(scene,i/100).flat().every(Number.isFinite));
  }
});
test('authored shape mismatch remains visible, not replaced by per-key meshes',()=>{
  const targets=[{t:0,polygon:[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]},{t:1,polygon:[[-.6,-.5],[.6,-.5],[0,.6]]}];
  const {scene,report}=fitScene(targets);
  assert.equal(scene.occluder.vertices.length,4);
  assert.ok(report.authoredKeys[1].rms>.03);
  assert.match(report.limitations,/incompatible/);
});
test('changed target geometry changes actual scene and projected output',()=>{
  const a=fitScene(DEFAULT_TARGETS),edited=structuredClone(DEFAULT_TARGETS);
  edited[1].polygon=edited[1].polygon.map(([x,y])=>[x+.4,y-.2]);
  const b=fitScene(edited);
  assert.notDeepEqual(a.scene,b.scene);
  const pa=projectShadow(a.scene,.5),pb=projectShadow(b.scene,.5);
  pa.forEach((p,i)=>{close(pb[i][0]-p[0],.4);close(pb[i][1]-p[1],-.2);});
});
test('motion share changes mechanism while preserving authored output',()=>{
  const a=fitScene(DEFAULT_TARGETS,{lightShare:0}),b=fitScene(DEFAULT_TARGETS,{lightShare:1});
  assert.notDeepEqual(a.scene.light,b.scene.light);
  DEFAULT_TARGETS.forEach(k=>projectShadow(a.scene,k.t).forEach((p,i)=>p.forEach((x,j)=>close(x,projectShadow(b.scene,k.t)[i][j]))));
});
test('similarity fit is invariant to polygon start vertex and winding',()=>{
  const targets=structuredClone(DEFAULT_TARGETS);
  targets[1].polygon.push(targets[1].polygon.shift());
  targets[2].polygon.reverse();
  assert.ok(fitScene(targets).report.authoredKeyRms<1e-7);
});
test('scene interpolation is bounded C1 and uses shortest rotation',()=>{
  const {scene}=fitScene(DEFAULT_TARGETS);
  scene.occluder.keys=[{t:0,x:0,y:0,z:1,angle:Math.PI-.1},{t:1,x:1,y:-1,z:2,angle:-Math.PI+.1}];
  const mid=sampleScene(scene,.5).occluder;
  close(mid.angle,Math.PI);close(mid.x,.5);close(mid.z,1.5);
  const epsilon=1e-5;
  assert.ok(Math.abs(sampleScene(scene,epsilon).occluder.x/epsilon)<.0001);
  close(sampleScene(scene,-2).occluder.x,0);close(sampleScene(scene,2).occluder.x,1);
  scene.occluder.keys.splice(1,0,{t:.5,x:.5,y:-.5,z:1.5,angle:-Math.PI+.1});
  close(sampleScene(scene,.5-1e-7).occluder.angle,sampleScene(scene,.5+1e-7).occluder.angle,1e-7);
});
test('validators reject malformed targets and unsafe physical scene',()=>{
  for(const bad of [[],[{t:0,polygon:[[0,0],[1,0],[2,0]]}],[{t:2,polygon:DEFAULT_TARGETS[0].polygon}], [{t:0,polygon:[[0,0],[1,0],[NaN,1]]}]])assert.throws(()=>validateTargets(bad));
  assert.throws(()=>validateTargets([DEFAULT_TARGETS[0],DEFAULT_TARGETS[0]]));
  assert.throws(()=>validateTargets([{t:0,polygon:[[0,0],[2,2],[0,2],[2,0],[3,1]]}]));
  assert.throws(()=>validateTargets([{t:0,polygon:[[0,0],[1,0],[1,0],[0,1]]}]));
  const scene=fitScene(DEFAULT_TARGETS).scene;scene.occluder.keys[0].z=5;
  assert.throws(()=>validateScene(scene));
  assert.throws(()=>fitScene(DEFAULT_TARGETS,{lightShare:1.1}));
  assert.throws(()=>targetAt(DEFAULT_TARGETS,NaN));
});
test('validation and sampling never expose writable persistent references',()=>{
  const targets=validateTargets(DEFAULT_TARGETS);targets[0].polygon[0][0]=99;assert.notEqual(DEFAULT_TARGETS[0].polygon[0][0],99);
  const scene=fitScene(DEFAULT_TARGETS).scene,validated=validateScene(scene),sample=sampleScene(scene,0);
  validated.occluder.vertices[0][0]=99;sample.occluder.vertices[0][0]=88;
  assert.notEqual(scene.occluder.vertices[0][0],99);assert.notEqual(scene.occluder.vertices[0][0],88);
  assert.deepEqual(measureFit(scene,DEFAULT_TARGETS),measureFit(JSON.parse(JSON.stringify(scene)),DEFAULT_TARGETS));
});
test('authored positional keys are exact before and after insertion',()=>{
  const lightEnd={t:1,x:.1,y:.2,z:5},cutoutEnd={t:1,x:.1,y:.2,z:1.1,angle:0};
  const scene={format:'shadow-stage/scene-v1',duration:4,light:{keys:[{t:0,x:-10,y:-10,z:6},lightEnd]},occluder:{vertices:[[-.1,-.1],[.1,-.1],[.1,.1],[-.1,.1]],keys:[{t:0,x:-10,y:-10,z:2,angle:0},cutoutEnd]}};
  function exact(candidate,t,light,cutout){const sampled=sampleScene(candidate,t);for(const field of ['x','y','z']){assert.equal(sampled.light[field],light[field],'light '+field);assert.equal(sampled.occluder[field],cutout[field],'cutout '+field);}}
  exact(scene,1,lightEnd,cutoutEnd);const inserted=structuredClone(scene);inserted.light.keys.splice(1,0,{t:.6,x:-.3,y:.7,z:5.4});inserted.occluder.keys.splice(1,0,{t:.6,x:-.3,y:.7,z:1.4,angle:0});exact(inserted,1,lightEnd,cutoutEnd);exact(inserted,.6,inserted.light.keys[1],inserted.occluder.keys[1]);exact(inserted,2,lightEnd,cutoutEnd);
});
