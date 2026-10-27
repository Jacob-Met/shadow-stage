import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,parseProject,serializeProject,MAX_PROJECT_BYTES} from '../src/project.js';
import {DEFAULT_TARGETS,fitScene} from '../src/core.js';
test('project reopens exact editable geometry and Unicode title',()=>{
 const p=newProject(DEFAULT_TARGETS);p.title='影の舞台 🌒 — João';p.scene=fitScene(p.targets,{duration:p.duration}).scene;
 const reopened=parseProject(serializeProject(p));assert.deepEqual(reopened,p);
 reopened.targets[0].polygon[0][0]+=1;assert.notDeepEqual(reopened.targets,p.targets);
});
test('import discards certification and scene report',()=>{
 const p=newProject(DEFAULT_TARGETS);p.scene=fitScene(p.targets).scene;p.report={success:true};p.scene.report={rms:0};p.certified=true;
 const result=parseProject(JSON.stringify(p));assert.equal(result.report,undefined);assert.equal(result.certified,undefined);assert.equal(result.scene.report,undefined);
});
test('malformed, oversized, nonfinite and invalid geometry reject',()=>{
 assert.throws(()=>parseProject('x'.repeat(MAX_PROJECT_BYTES+1)));
 assert.throws(()=>parseProject('{'));
 for(const duration of [0,-1,Infinity,NaN,3601]){const p=newProject(DEFAULT_TARGETS);p.duration=duration;assert.throws(()=>serializeProject(p));}
 const p=newProject(DEFAULT_TARGETS);p.targets[0].polygon[0][0]=Infinity;assert.throws(()=>serializeProject(p));
 assert.throws(()=>newProject([{t:0,polygon:[[0,0],[1,1],[2,2]]}]));
});
test('duration mismatch cannot silently reopen a different performance',()=>{
 const p=newProject(DEFAULT_TARGETS);p.scene=fitScene(p.targets).scene;p.duration=12;assert.throws(()=>serializeProject(p));
});
