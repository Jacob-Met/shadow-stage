import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {validateTargets} from '../src/core.js';
import {fitArticulated,projectArticulated} from '../src/articulated.js';
import {refineTransitions} from '../src/transition.js';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex'),fileHash=f=>hash(fs.readFileSync(f));
const paper=[[-.56,-.04],[-.13,.10],[-.40,.50],[.05,.29],[.32,.47],[.24,.12],[.55,-.01],[.17,-.08],[.02,-.43],[-.16,-.20],[-.50,-.32],[-.27,-.07]];
const center=p=>p.reduce((s,v)=>[s[0]+v[0]/p.length,s[1]+v[1]/p.length],[0,0]);
const scaleAtCenter=(p,s)=>{const c=center(p);return p.map(([x,y])=>[c[0]+s*(x-c[0]),c[1]+s*(y-c[1])]);};
const star=Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,r=i%2?.30:.72;return[r*Math.cos(a),r*Math.sin(a)];});
const sequences={
original_shape_change:[{t:0,polygon:scaleAtCenter(paper,.7)},{t:.5,polygon:[[-.5,-.4],[.5,-.4],[0,.5]]},{t:1,polygon:[[-.42,-.42],[.42,-.42],[.42,.42],[-.42,.42]]}],
unfamiliar_star_arrow_diamond:[{t:0,polygon:star},{t:.5,polygon:[[-.7,-.25],[.1,-.25],[.1,-.6],[.75,0],[.1,.6],[.1,.25],[-.7,.25]]},{t:1,polygon:[[0,-.7],[.55,0],[0,.7],[-.55,0]]}]
};
const fitting={maxPieces:24,resolution:32,coverageTolerance:.01,duration:8},transition={iterations:4,maxEvaluations:2304,resolution:40,measurementResolution:120,lockedIds:[]};
const receipt={experiment:'estate95a-transition-v9-quality-v1',startedAt:new Date().toISOString(),node:process.version,cwd:process.cwd(),source:Object.fromEntries(['src/core.js','src/articulated.js','src/transition.js','tests/transition.test.js'].map(f=>[f,fileHash(f)])),options:{fitting,transition},interpretation:['Unchanged authored targets feed both stages.','Transition assessment uses chosen boundary morph, not observed intermediate ground truth.','Original, initialized and final transition rows share one final observation window.','Initial fitter report has a different evaluator configuration; do not subtract it from transition errors.','.25 remains held out from optimization.','Single-run timings include measurement overhead.','No perceptual, collision or fabrication claim.'],cases:[]};
for(const [name,input]of Object.entries(sequences)){
 const targets=validateTargets(input),targetBytes=JSON.stringify(targets),row={name,targets,targetSha256:hash(targetBytes),requestedPieceBudget:24},begin=performance.now();
 try{
 const fitStart=performance.now(),initial=fitArticulated(targets,fitting);row.fitAndInitialMeasurementMs=performance.now()-fitStart;row.actualPieces=initial.scene.occluders.length;row.initialScene=initial.scene;row.initialSceneSha256=hash(JSON.stringify(initial.scene));row.initialFitReport=initial.report;const before=JSON.stringify(initial.scene),start=performance.now(),refined=refineTransitions(targets,initial.scene,transition);
 row.transitionAndAssessmentMs=performance.now()-start;row.finalScene=refined.scene;row.finalSceneSha256=hash(JSON.stringify(refined.scene));row.transitionReport=refined.report;
 row.inputPreservation={targets:JSON.stringify(targets)===targetBytes,originalScene:JSON.stringify(initial.scene)===before,light:JSON.stringify(refined.scene.light)===JSON.stringify(initial.scene.light),pieceIds:JSON.stringify(refined.scene.occluders.map(p=>p.id))===JSON.stringify(initial.scene.occluders.map(p=>p.id)),fixedGeometry:refined.scene.occluders.every((p,i)=>JSON.stringify(p.vertices)===JSON.stringify(initial.scene.occluders[i].vertices)),existingKeys:initial.scene.occluders.every((p,i)=>p.keys.every(k=>JSON.stringify(refined.scene.occluders[i].keys.find(q=>q.t===k.t))===JSON.stringify(k))),authoredProjectedGeometry:targets.every(k=>JSON.stringify(projectArticulated(initial.scene,k.t))===JSON.stringify(projectArticulated(refined.scene,k.t)))};
 if(!Object.values(row.inputPreservation).every(Boolean))throw Error('Required preservation failed');
 const at=(rows,t)=>rows.find(r=>Math.abs(r.t-t)<1e-12)??null;
 row.quarterTime={optimized:refined.report.insertedKeys.some(k=>Math.abs(k.t-.25)<1e-12),original:at(refined.report.heldOut.before,.25),initialized:at(refined.report.heldOut.initialized,.25),final:at(refined.report.heldOut.after,.25)};
 if(row.quarterTime.optimized||!row.quarterTime.original||!row.quarterTime.initialized||!row.quarterTime.final)throw Error('Quarter-time held-out contract failed');
 const h=refined.report.heldOut,m=refined.report.motion,w=refined.report.work;
 row.summary={originalHeldOutMean:h.beforeMean,initializedHeldOutMean:h.initialized.reduce((s,r)=>s+r.maskError,0)/h.initialized.length,finalHeldOutMean:h.afterMean,originalHeldOutMaximum:h.beforeMaximum,finalHeldOutMaximum:h.afterMaximum,numericallyImproved:h.numericallyImproved,qualifiedImprovement:h.qualifiedImprovement,meanImprovement:h.meanImprovement,relativeImprovement:h.relativeImprovement,originalQuarterError:row.quarterTime.original.maskError,initializedQuarterError:row.quarterTime.initialized.maskError,finalQuarterError:row.quarterTime.final.maskError,originalMaximumVertexStep:m.before.maximumVertexStep,finalMaximumVertexStep:m.after.maximumVertexStep,finalMinimumLightClearance:m.after.minimumLightClearance,candidateAttempts:w.candidateAttempts,candidateRasterEvaluations:w.candidateRasterEvaluations};
 row.status=h.qualifiedImprovement?'measured-qualified-under-declared-criterion':'measured-not-qualified';
 }catch(error){row.status='unresolved-or-failed';row.error={name:error.name,message:error.message,stack:error.stack};}
 row.totalCaseMs=performance.now()-begin;receipt.cases.push(row);console.log(JSON.stringify({name:row.name,status:row.status,actualPieces:row.actualPieces,summary:row.summary,error:row.error,fitAndInitialMeasurementMs:row.fitAndInitialMeasurementMs,transitionAndAssessmentMs:row.transitionAndAssessmentMs}));
}
receipt.finishedAt=new Date().toISOString();const destination=path.resolve('..','estate95a-transition-v9-quality-v1.json');fs.writeFileSync(destination,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({receipt:destination,sha256:fileHash(destination),cases:receipt.cases.length}));
