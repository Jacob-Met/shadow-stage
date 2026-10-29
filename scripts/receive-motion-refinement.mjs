import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {refineMotion} from '../src/motion-refinement.js';
const [transitionPath,motionPath,outputPath]=process.argv.slice(2);
if(!transitionPath||!motionPath||!outputPath)throw new Error('Usage: node scripts/receive-motion-refinement.mjs TRANSITION_RECEIPT MOTION_RECEIPT NEW_OUTPUT');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const transition=JSON.parse(fs.readFileSync(transitionPath,'utf8')),retained=JSON.parse(fs.readFileSync(motionPath,'utf8'));
const receipt={startedAt:new Date().toISOString(),source:{moduleSha256:sha(new URL('../src/motion-refinement.js',import.meta.url)),transitionReceiptSha256:sha(transitionPath),retainedMotionReceiptSha256:sha(motionPath)},cases:[],status:'passed'};
for(const fixture of transition.cases){const row={name:fixture.name,status:'unresolved'};try{
  const expected=retained.cases.find(item=>item.name===fixture.name);assert.ok(expected?.qualifiedImprovement,'Retained qualified result is required');assert.ok(Array.isArray(fixture.transitionReport.lockedIds),'Explicit retained locks are required');assert.equal(fixture.initialScene.duration,8);assert.equal(fixture.finalScene.duration,8);
  const before=JSON.stringify(fixture),result=refineMotion(fixture.targets,fixture.initialScene,fixture.finalScene,{lockedIds:fixture.transitionReport.lockedIds});
  row.result=result;row.exactSceneReproduced=JSON.stringify(result.scene)===JSON.stringify(expected.proposedScene);
  assert.equal(JSON.stringify(fixture),before);assert.deepEqual(result.originalCandidate,fixture.finalScene);assert.equal(result.report.qualifiedImprovement,true);assert.deepEqual(result.report.comparison.trainingTimes,[1/6,1/3,2/3,5/6]);assert.deepEqual(result.report.comparison.heldOutTimes,[1/12,.25,5/12,7/12,.75,11/12]);
  assert.deepEqual(result.scene,expected.proposedScene,'Reusable implementation did not exactly reproduce retained proposal');assert.ok(Math.abs(result.report.heldOut.proposal.mean-expected.heldOut.proposal.mean)<1e-12);assert.equal(result.report.work.candidateAttempts,64);for(const [name,limit]of Object.entries(result.report.work.limits))assert.ok(result.report.work.estimate[name]<=limit);row.status='passed';
}catch(error){row.error=String(error.stack||error);receipt.status='failed';}receipt.cases.push(row);}
receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.resolve(outputPath),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:receipt.status,receipt:path.resolve(outputPath),cases:receipt.cases.map(row=>({name:row.name,status:row.status,exactSceneReproduced:row.exactSceneReproduced,error:row.error?.split('\n')[0]}))}));if(receipt.status!=='passed')process.exitCode=1;
