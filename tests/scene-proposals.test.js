import test from 'node:test';
import assert from 'node:assert/strict';
import {physicalSceneRequest,validateSceneProposal,applySceneProposal} from '../src/scene-proposals.js';
import {newProject} from '../src/project.js';
import {DEFAULT_TARGETS} from '../src/core.js';
const fixture=()=>({format:'shadow-stage/scene-proposal-v1',summary:'Fixture only: one persistent square initialization.',scene:{format:'shadow-stage/articulated-v1',duration:8,light:{keys:[{t:0,x:0,y:0,z:5},{t:1,x:0,y:0,z:5}]},occluders:[{id:'piece-1',vertices:[[-.1,-.1],[.1,-.1],[.1,.1],[-.1,.1]],keys:[{t:0,x:0,y:0,z:2,angle:0},{t:1,x:.2,y:0,z:2,angle:.2}]}]}});
test('physical proposal initializes geometry without changing target requirements',()=>{
 const project=newProject(DEFAULT_TARGETS),before=structuredClone(project);const candidate=applySceneProposal(project,fixture());
 assert.deepEqual(project,before);assert.deepEqual(candidate.targets,project.targets);assert.deepEqual(candidate.authoring.original.targets,project.targets);assert.equal(candidate.authoring.status,'proposed');assert.equal(candidate.report,undefined);
 candidate.targets[0].polygon[0][0]+=1;assert.deepEqual(project,before);
});
test('physical proposal rejects certificates, target edits and malformed physical pieces',()=>{
 for(const patch of [{success:true},{targets:DEFAULT_TARGETS},{report:{rms:0}}])assert.throws(()=>validateSceneProposal({...fixture(),...patch}));
 const nonfinite=fixture();nonfinite.scene.occluders[0].keys[0].z=Infinity;assert.throws(()=>validateSceneProposal(nonfinite));
 const rectangle=fixture();rectangle.scene.occluders[0].vertices[0][0]=-.2;assert.throws(()=>validateSceneProposal(rectangle));
 const collision=fixture();collision.scene.occluders[0].keys[0].z=5;assert.throws(()=>validateSceneProposal(collision));
 const duplicate=fixture();duplicate.scene.occluders.push(structuredClone(duplicate.scene.occluders[0]));assert.throws(()=>validateSceneProposal(duplicate));
 assert.throws(()=>validateSceneProposal(' '.repeat(32769)));
 const retimed=fixture();retimed.scene.duration=9;assert.throws(()=>applySceneProposal(newProject(DEFAULT_TARGETS),retimed));
});
test('physical request carries exact target geometry and never claims model execution',()=>{
 const request=physicalSceneRequest('An expanding bird silhouette.',DEFAULT_TARGETS);assert.deepEqual(JSON.parse(request.messages[1].content).targets,DEFAULT_TARGETS);assert.ok(request.messages[0].content.includes('immutable'));assert.equal(request.executed,undefined);assert.throws(()=>physicalSceneRequest('',DEFAULT_TARGETS));
});


test('controlled physical proposal preserves requested exact piece count',()=>{
 const request=physicalSceneRequest('Preserve the silhouette.',DEFAULT_TARGETS,{duration:8,exactPieceCount:1});assert.equal(JSON.parse(request.messages[1].content).exactPieceCount,1);
 assert.equal(validateSceneProposal(fixture(),{exactPieceCount:1}).scene.occluders.length,1);assert.throws(()=>validateSceneProposal(fixture(),{exactPieceCount:2}));
 for(const count of [0,17,1.5,Infinity,'1'])assert.throws(()=>physicalSceneRequest('Preserve shape.',DEFAULT_TARGETS,{exactPieceCount:count}));
});
