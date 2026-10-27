import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProposal,applyProposal,proposeRequest} from '../src/proposals.js';
import {newProject,serializeProject,parseProject} from '../src/project.js';
import {DEFAULT_TARGETS,fitScene} from '../src/core.js';
const proposal=()=>({format:'shadow-stage/proposal-v1',summary:'Let the silhouette rise and settle gently.',lightShare:.8,duration:12,adjustments:[{targetIndex:1,translate:[.1,.2],rotate:.3,scale:1.2}]});
test('proposal creates detached candidate and retains exact source',()=>{
 const p=newProject(DEFAULT_TARGETS);p.scene=fitScene(p.targets).scene;const before=structuredClone(p);
 const candidate=applyProposal(p,proposal());assert.deepEqual(p,before);assert.equal(candidate.scene,null);assert.equal(candidate.authoring.status,'proposed');
 assert.deepEqual(candidate.authoring.original,{title:p.title,duration:p.duration,targets:p.targets,scene:p.scene});
 assert.notDeepEqual(candidate.targets[1],p.targets[1]);assert.deepEqual(candidate.targets[0],p.targets[0]);
 assert.deepEqual(parseProject(serializeProject(candidate)),candidate);
 const next=applyProposal(candidate,proposal());assert.equal(next.authoring.original.authoring,undefined);
});
test('strict proposal refuses unexpected fields, duplicate indices, missing targets and ranges',()=>{
 for(const patch of [{success:true},{lightShare:NaN},{duration:Infinity},{duration:0},{lightShare:2},{summary:'https://example.com'},{adjustments:[{targetIndex:0,translate:[0,0],rotate:0,scale:0}]}])assert.throws(()=>validateProposal({...proposal(),...patch}));
 const p=proposal();p.adjustments.push({...p.adjustments[0]});assert.throws(()=>validateProposal(p));
 const q=proposal();q.adjustments[0].targetIndex=63;assert.throws(()=>applyProposal(newProject(DEFAULT_TARGETS),q));
 assert.throws(()=>validateProposal(' '.repeat(32769)));assert.throws(()=>validateProposal('{'));
});
test('request is actual model input, never fabricated inference',()=>{
 const request=proposeRequest('A patient ascent then a sigh.',newProject(DEFAULT_TARGETS));assert.equal(request.messages.length,2);assert.equal(request.messages[1].role,'user');assert.ok(request.messages[0].content.includes('renderer'));
 assert.equal(request.proposal,undefined);assert.throws(()=>proposeRequest('',newProject(DEFAULT_TARGETS)));assert.throws(()=>proposeRequest('x'.repeat(4001),newProject(DEFAULT_TARGETS)));
});
test('identity adjustment leaves authored coordinates unchanged within rounding precision',()=>{
 const p=newProject(DEFAULT_TARGETS),q=proposal();q.adjustments=[{targetIndex:0,translate:[0,0],rotate:0,scale:1}];
 const candidate=applyProposal(p,q);candidate.targets[0].polygon.forEach((v,i)=>v.forEach((x,j)=>assert.ok(Math.abs(x-p.targets[0].polygon[i][j])<1e-14)));
});
test('actual provider receipt can be retained without certifying imported claims',()=>{
 const evidence={provider:'Nebius Token Factory',requestedModel:'example-model',returnedModel:'example-model',requestId:'fixture-only',elapsedMs:100,executed:true,inputSha256:'a'.repeat(64),responseSha256:'b'.repeat(64),usage:{prompt_tokens:20,completion_tokens:30,total_tokens:50},receivedAt:'2026-10-27T00:00:00Z'};
 const candidate=applyProposal(newProject(DEFAULT_TARGETS),proposal(),evidence);
 const reopened=parseProject(serializeProject(candidate));assert.deepEqual(reopened.authoring.evidence,candidate.authoring.evidence);
 assert.match(reopened.authoring.evidence.verification,/not-independently-verified/);assert.equal(reopened.authoring.evidence.responseSha256,evidence.responseSha256);
 assert.throws(()=>applyProposal(newProject(DEFAULT_TARGETS),proposal(),{...evidence,inputSha256:'bad'}));
});
