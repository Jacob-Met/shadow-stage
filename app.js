import {targetAt,validateTargets} from './src/core.js';
import {isArticulated,validatePhysicalScene,projectPolygons,samplePhysicalScene,measurePhysicalScene,physicalPieces} from './src/runtime.js';
import {standalonePlayer} from './src/player.js';
import {mountComparison} from './src/comparison-ui.js';
import {recordPerformance,videoCapability} from './src/video.js';
import {applySceneProposal} from './src/scene-proposals.js';
import {newProject, serializeProject, parseProject} from './src/project.js';
import {applyProposal} from './src/proposals.js';

const $=id=>document.getElementById(id), copy=value=>structuredClone(value);
const canvas=$('stageCanvas'), ctx=canvas.getContext('2d'), rig=$('rigCanvas'), rigCtx=rig.getContext('2d');
const paper=[[-.56,-.04],[-.13,.10],[-.40,.50],[.05,.29],[.32,.47],[.24,.12],[.55,-.01],[.17,-.08],[.02,-.43],[-.16,-.20],[-.50,-.32],[-.27,-.07]];
const kite=[[-.35,0],[0,.52],[.30,0],[0,-.48]];
const centroid=p=>p.reduce((s,v)=>[s[0]+v[0]/p.length,s[1]+v[1]/p.length],[0,0]);
function transformed(p,{x=0,y=0,angle=0,scale=1}={}){const c=centroid(p),a=angle*Math.PI/180,co=Math.cos(a),si=Math.sin(a);return p.map(v=>[c[0]+x+scale*((v[0]-c[0])*co-(v[1]-c[1])*si),c[1]+y+scale*((v[0]-c[0])*si+(v[1]-c[1])*co)]);}
function preset(name){
  if(name==='orbit')return [{t:0,polygon:transformed(kite,{x:-.4,y:-.15,angle:-20,scale:.65})},{t:.33,polygon:transformed(kite,{x:.26,y:.3,angle:32,scale:.8})},{t:.67,polygon:transformed(kite,{x:.4,y:-.2,angle:65,scale:.65})},{t:1,polygon:transformed(kite,{x:-.4,y:-.15,angle:-20,scale:.65})}];
  if(name==='shape-change')return [{t:0,polygon:transformed(paper,{scale:.7})},{t:.5,polygon:[[-.5,-.4],[.5,-.4],[0,.5]]},{t:1,polygon:[[-.42,-.42],[.42,-.42],[.42,.42],[-.42,.42]]}];
  return [{t:0,polygon:transformed(paper,{x:-.28,y:-.17,angle:-12,scale:.8})},{t:.5,polygon:transformed(paper,{x:.24,y:.18,angle:24,scale:.92})},{t:1,polygon:transformed(paper,{x:-.08,y:-.06,angle:-8,scale:1.02})}];
}
let project=newProject(preset('flight')), time=0, active=0, playing=false, lastFrame=0, dirty=false, manual=false, report=null, fittedScene=null, editBase=copy(project.targets[0].polygon), mode='move', drag=null, drawn=[], pendingProposal=null, importGeneration=0;
project.title='Paper flight';project.duration=8;
let view={width:0,height:0,scale:1,cx:0,cy:0}, solveSequence=0, loadEpoch=0, modelAvailable=false, solverWorker=null, selectedCutout='cutout-1';
let comparisonController=null,videoController=null,lastVideoReceipt=null;
function announce(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function setPlaying(value){if(value&&time>=1)setTime(0);playing=value;lastFrame=0;$('playButton').textContent=value?'Ⅱ':'▶';$('playButton').setAttribute('aria-label',value?'Pause performance':'Play performance');}
function setTime(t){time=Math.max(0,Math.min(1,Number(t)||0));$('timeline').value=time;syncPhysical();render();}
function world(p){return [view.cx+p[0]*view.scale,view.cy-p[1]*view.scale];}
function inverse(e){const r=canvas.getBoundingClientRect();return [(e.clientX-r.left-view.cx)/view.scale,-(e.clientY-r.top-view.cy)/view.scale];}
function pathOn(c,p,fn){c.beginPath();p.forEach((v,i)=>{const q=fn(v);i?c.lineTo(...q):c.moveTo(...q);});c.closePath();}
function resizeCanvas(el,c){const rect=el.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);const w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);if(el.width!==w||el.height!==h){el.width=w;el.height=h;}c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);c.setTransform(dpr,0,0,dpr,0,0);return {w:rect.width,h:rect.height};}
function drawStage(){
  const {w,h}=resizeCanvas(canvas,ctx);view={width:w,height:h,scale:Math.min(w,h)*.365,cx:w/2,cy:h*.47};
  const light=project.scene?samplePhysicalScene(project.scene,time).light:{x:0,y:0};
  const glow=ctx.createRadialGradient(w*.48+light.x*15,h*.4-light.y*15,15,w*.5,h*.5,w*.75);glow.addColorStop(0,'#f2f0d6');glow.addColorStop(.5,'#e5e9d2');glow.addColorStop(1,'#c4d2b6');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
  ctx.save();ctx.strokeStyle='rgba(113,137,96,.15)';ctx.lineWidth=.6;
  for(let n=-1;n<=1.001;n+=.25){let a=world([n,-1]),b=world([n,1]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();a=world([-1,n]);b=world([1,n]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
  ctx.strokeStyle='rgba(99,121,84,.25)';ctx.lineWidth=1;ctx.setLineDash([2,5]);pathOn(ctx,[[-1,-1],[1,-1],[1,1],[-1,1]],world);ctx.stroke();ctx.restore();
  if($('showTrail').checked&&project.scene){for(let n=0;n<9;n++){ctx.fillStyle=`rgba(50,77,53,${.018+n*.004})`;for(const polygon of projectPolygons(project.scene,n/8)){pathOn(ctx,polygon,world);ctx.fill();}}}
  if(project.scene){ctx.fillStyle='#283e32';for(const polygon of projectPolygons(project.scene,time)){pathOn(ctx,polygon,world);ctx.fill();}}
  const target=$('showTarget').checked?targetAt(project.targets,time):null;
  if(target){ctx.save();ctx.strokeStyle=dirty?'#b07c40':'#a1814d';ctx.lineWidth=1.25;ctx.setLineDash([5,5]);pathOn(ctx,target,world);ctx.stroke();ctx.restore();}
  if(!playing&&Math.abs(time-project.targets[active].t)<.002&&$('showTarget').checked&&mode==='move'){
    ctx.fillStyle='#f5f1dc';ctx.strokeStyle='#936c3c';ctx.lineWidth=1;
    for(const p of project.targets[active].polygon){const q=world(p);ctx.beginPath();ctx.arc(...q,3.5,0,Math.PI*2);ctx.fill();ctx.stroke();}
  }
  if(drawn.length){ctx.save();ctx.strokeStyle='#9b6b33';ctx.lineWidth=2;ctx.fillStyle='rgba(189,143,67,.15)';pathOn(ctx,drawn,world);ctx.fill();ctx.stroke();ctx.restore();}
  ctx.fillStyle='rgba(77,104,66,.6)';ctx.font='8px system-ui';for(const [x,y,label] of [[-1,1,'+'],[1,1,'+'],[-1,-1,'+'],[1,-1,'+']]){const q=world([x,y]);ctx.fillText(label,q[0]-3,q[1]+3);}
  $('frameNumber').textContent=String(Math.round(time*project.duration*24)+1).padStart(3,'0');
  $('stageCaption').textContent=dirty?'Target edited · solve to find its new motion':manual?'The rig is yours to move.':playing?'A continuous performance of persistent cutouts.':'A silhouette, held in light.';
  $('timeDisplay').textContent=`${(time*project.duration).toFixed(2).padStart(5,'0')} / ${project.duration.toFixed(2).padStart(5,'0')}`;
}
function drawRig(){
 const {w,h}=resizeCanvas(rig,rigCtx);if(!project.scene)return;
 const {light:l,occluders}=samplePhysicalScene(project.scene,time),scale=Math.min(w/4,h/5.7),project3=([x,y,z])=>[w*.50+(x*.92+y*.42)*scale,h*.84+(y*.27-x*.15-z*.70)*scale];
 pathOn(rigCtx,[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],project3);rigCtx.fillStyle='#d7e0c9';rigCtx.fill();rigCtx.strokeStyle='#b6c4a6';rigCtx.lineWidth=1;rigCtx.stroke();
 const shadows=projectPolygons(project.scene,time);rigCtx.fillStyle='#91a27d';for(const polygon of shadows){pathOn(rigCtx,polygon,p=>project3([...p,0]));rigCtx.fill();}
 const lamp=project3([l.x,l.y,l.z]);
 occluders.forEach((o,index)=>{const c=Math.cos(o.angle),sn=Math.sin(o.angle),mesh=o.vertices.map(([x,y])=>[o.x+c*x-sn*y,o.y+sn*x+c*y,o.z]);
  if(o.id===selectedCutout)for(let i=0;i<mesh.length;i+=Math.max(1,Math.floor(mesh.length/4))){rigCtx.beginPath();rigCtx.moveTo(...lamp);rigCtx.lineTo(...project3([...shadows[index][i],0]));rigCtx.strokeStyle='rgba(187,144,66,.45)';rigCtx.lineWidth=.65;rigCtx.stroke();}
  pathOn(rigCtx,mesh,project3);rigCtx.fillStyle=o.id===selectedCutout?'#a58242':'#42624d';rigCtx.fill();rigCtx.strokeStyle='#314b39';rigCtx.stroke();
 });
 const halo=rigCtx.createRadialGradient(...lamp,1,...lamp,14);halo.addColorStop(0,'rgba(212,164,77,.4)');halo.addColorStop(1,'rgba(212,164,77,0)');rigCtx.fillStyle=halo;rigCtx.beginPath();rigCtx.arc(...lamp,14,0,Math.PI*2);rigCtx.fill();rigCtx.fillStyle='#c09549';rigCtx.beginPath();rigCtx.arc(...lamp,4,0,Math.PI*2);rigCtx.fill();rigCtx.font='8px system-ui';rigCtx.fillStyle='#8b855e';rigCtx.fillText('POINT LIGHT',Math.max(7,Math.min(w-65,lamp[0]+10)),Math.max(12,lamp[1]-4));
}
function render(){drawStage();drawRig();$('timeline').value=time;$('stageMode').textContent=$('showTarget').checked?'PERFORMANCE + TARGET':'PERFORMANCE ONLY';}
function syncConstruction(){const pieces=$('constructionMode').value==='pieces';$('pieceBudgetField').hidden=!pieces;$('lightShareField').hidden=pieces;$('constructionHint').textContent=pieces?'Persistent square cutouts combine into changing silhouettes. More pieces allow finer boundaries; depth and motion remain editable.':'One enduring cutout, one point light. Shapes that cannot share the cutout retain a visible mismatch.';}
function syncPhysical(){
 for(const id of ['lightX','lightY','occluderDepth','cutoutX','cutoutY','cutoutAngle','cutoutSelect','resetRig','exportSVG','exportPlayer'])$(id).disabled=!project.scene;
 $('refineButton').disabled=!isArticulated(project.scene)||!!solverWorker;$('lockCutout').disabled=!isArticulated(project.scene);
 if(!project.scene){$('cutoutSelect').replaceChildren();comparisonController?.refresh();syncVideo();return;}
 const sampled=samplePhysicalScene(project.scene,time),pieces=sampled.occluders;
 if(!pieces.some(p=>p.id===selectedCutout))selectedCutout=pieces[0].id;
 if([...$('cutoutSelect').options].map(o=>o.value).join('|')!==pieces.map(p=>p.id).join('|')){$('cutoutSelect').replaceChildren();pieces.forEach((p,i)=>$('cutoutSelect').add(new Option('Cutout '+String(i+1).padStart(2,'0'),p.id)));}
 $('cutoutSelect').value=selectedCutout;const o=pieces.find(p=>p.id===selectedCutout),locked=(project.lockedCutouts||[]).includes(selectedCutout);$('lockCutout').checked=locked;
 for(const [id,value,out] of [['lightX',sampled.light.x,'lightXValue'],['lightY',sampled.light.y,'lightYValue'],['cutoutX',o.x,'cutoutXValue'],['cutoutY',o.y,'cutoutYValue']]){$(id).min=Math.min(-2,value-1);$(id).max=Math.max(2,value+1);$(id).value=value;$(out).textContent=value.toFixed(2);}
 $('occluderDepth').max=Math.min(...project.scene.light.keys.map(k=>k.z))-.051;$('occluderDepth').value=o.z;$('depthValue').textContent=o.z.toFixed(2);
 const angle=Math.atan2(Math.sin(o.angle),Math.cos(o.angle))*180/Math.PI;$('cutoutAngle').value=angle;$('cutoutAngleValue').textContent=angle.toFixed(0)+'°';
 for(const id of ['occluderDepth','cutoutX','cutoutY','cutoutAngle'])$(id).disabled=locked;
 comparisonController?.refresh();syncVideo();
}
function filmstrip(){
  $('targetSelect').replaceChildren();$('filmstrip').replaceChildren();
  project.targets.forEach((k,i)=>{
    const option=new Option(`Moment ${String(i+1).padStart(2,'0')} · ${(k.t*project.duration).toFixed(1)}s`,i);$('targetSelect').add(option);
    const b=document.createElement('button');b.className='moment-card'+(i===active?' selected':'');b.setAttribute('aria-label',`Edit moment ${i+1} at ${(k.t*project.duration).toFixed(1)} seconds`);b.setAttribute('aria-pressed',String(i===active));
    const c=document.createElement('canvas');c.width=240;c.height=110;const cx=c.getContext('2d');cx.fillStyle='#e6ebd7';cx.fillRect(0,0,240,110);pathOn(cx,k.polygon,([x,y])=>[120+x*48,54-y*48]);cx.fillStyle='#557050';cx.fill();
    const label=document.createElement('span');label.append(document.createTextNode(String(i+1).padStart(2,'0')));const stamp=document.createElement('i');stamp.textContent=(k.t*project.duration).toFixed(1)+'s';label.append(stamp);b.append(c,label);b.addEventListener('click',()=>selectMoment(i));$('filmstrip').append(b);
  });$('targetSelect').value=active;$('removeMoment').disabled=project.targets.length<=2;
}
function resetTransform(){editBase=copy(project.targets[active].polygon);for(const [id,v] of [['targetX',0],['targetY',0],['targetScale',1],['targetAngle',0]])$(id).value=v;showTransform();}
function showTransform(){for(const id of ['targetX','targetY'])$(id+'Value').textContent=(+$(id).value>=0?'+':'')+(+$(id).value).toFixed(2);$('targetScaleValue').textContent=(+$('targetScale').value).toFixed(2)+'×';$('targetAngleValue').textContent=$('targetAngle').value+'°';}
function selectMoment(i){active=Math.max(0,Math.min(project.targets.length-1,Number(i)));setPlaying(false);resetTransform();filmstrip();setTime(project.targets[active].t);}
function targetChanged(){showPreset();cancelSolve();dirty=true;manual=false;setPlaying(false);time=project.targets[active].t;filmstrip();showReport();render();announce('Target changed. The last physical performance is retained; find its new motion when ready.');}
function showReport(){
 if(report?.unresolved){$('fitStatus').textContent='Fit could not be resolved';for(const id of ['keyError','betweenError','baselineError'])$(id).textContent='—';$('fitDescription').textContent=report.reason;return;}
 if(!report){$('fitStatus').textContent='Ready to find a performance';for(const id of ['keyError','betweenError','baselineError'])$(id).textContent='—';$('fitDescription').textContent='Find a physical performance for your authored moments. Its measured mismatch will appear here.';return;}
 const pieces=isArticulated(project.scene),error=pieces?report.authoredMaskError:report.authoredKeyRms,pct=x=>(x*(pieces?100:50)).toFixed(2)+'%';
 $('keyError').textContent=pct(error);$('betweenError').textContent=pct(pieces?report.interpolatedMaskError:report.interpolatedTargetRms);$('baselineError').textContent=pct(pieces?report.noSolveBaselineMaskError:report.noSolveBaselineRms);
 $('fitStatus').textContent=dirty?'Your moments have changed':manual?'A hand-tuned performance':pieces?'A construction of '+project.scene.occluders.length+' cutouts':error<.015?'Your shadows have a shared performance':'An approximate performance';
 $('fitDescription').textContent=dirty?'The numbers describe the last solve. Solve again to measure your changed targets.':pieces?'Each fixed piece keeps its geometry. Their moving shadows overlap to form the performance; remaining mismatch stays visible.':error<.015?'The authored silhouettes share one persistent cutout. Scrub between them and explore the rig.':'One fixed cutout cannot closely match all these shapes. The residual is kept visible; refine the targets or explore the approximation.';
 $('metricNote').textContent=(pieces?'Area of the shadow/target disagreement divided by their union, sampled on a grid. ':'RMS boundary distance as a percentage of the stage width. ')+'Between-moment comparison uses an authored boundary morph. It is not observed ground truth.';
}
function cancelSolve(){comparisonController?.invalidate();solveSequence++;if(solverWorker)solverWorker.terminate();solverWorker=null;$('solveButton').disabled=false;$('solveButton').textContent='✦ Find the performance';$('refineButton').disabled=!isArticulated(project.scene);}
function solve(action='fit'){
 if(typeof action!=='string')action='fit';
 if(action!=='refine'&&isArticulated(project.scene)&&project.lockedCutouts?.length)action='refine';
 if(action==='refine'&&!isArticulated(project.scene))return;
 cancelSolve();const source=project,snapshot=serializeProject(project),sequence=solveSequence,mode=action==='refine'?'refine':$('constructionMode').value;
 const configuration={lightShare:+$('lightShare').value,maxPieces:+$('pieceBudget').value};
 const options=mode==='refine'?{lockedIds:project.lockedCutouts||[],iterations:4,resolution:48,maxEvaluations:2000}:mode==='pieces'?{maxPieces:configuration.maxPieces,resolution:32,duration:project.duration}:{lightShare:configuration.lightShare,duration:project.duration};
 setPlaying(false);$('solveButton').disabled=true;$('refineButton').disabled=true;$('solveButton').textContent=mode==='refine'?'Refining the construction…':'Finding the motion…';
 const worker=new Worker(new URL('./src/solver-worker.js',import.meta.url),{type:'module'});solverWorker=worker;
 const finish=()=>{worker.terminate();if(solverWorker===worker){solverWorker=null;$('solveButton').disabled=false;$('solveButton').textContent='✦ Find the performance';syncPhysical();}};
 worker.onmessage=({data})=>{try{
  if(sequence!==solveSequence||project!==source||serializeProject(project)!==snapshot)return;if(data.error)throw new Error(data.error);
  const result=data.result;comparisonController?.invalidate('A new solved scene replaced the compared construction.');source.scene=validatePhysicalScene(result.scene);if(mode!=='refine'){source.lightShare=configuration.lightShare;source.construction={mode:isArticulated(source.scene)?'pieces':'single',maxPieces:configuration.maxPieces};source.lockedCutouts=[];}
  fittedScene=copy(result.scene);report=result.report;dirty=false;manual=false;syncPhysical();showReport();render();announce(mode==='refine'?'Construction refined. Locked cutout tracks are preserved.':'Performance fitted. Select a cutout or move the light to explore the physical scene.');
 }catch(e){announce('Could not fit this sequence: '+e.message,true);}finally{finish();}};
 worker.onerror=error=>{if(sequence===solveSequence)announce('Could not run the construction: '+error.message,true);finish();};
 worker.postMessage({id:sequence,mode,targets:copy(project.targets),scene:copy(project.scene),options});
}
function setKey(keys,t,patch){const near=keys.find(k=>Math.abs(k.t-t)<1e-6);if(near){Object.assign(near,patch);return;}if(keys.length>=128)throw new Error('This track already has 128 points. Edit an existing moment.');keys.push({t,...patch});keys.sort((a,b)=>a.t-b.t);}
function editPhysical(kind,value){
 if(!project.scene)return;cancelSolve();setPlaying(false);const next=copy(project.scene),sample=samplePhysicalScene(next,time),index=sample.occluders.findIndex(p=>p.id===selectedCutout);
 try{if(kind==='x'||kind==='y')setKey(next.light.keys,time,{...sample.light,[kind]:value});
 else{if(project.lockedCutouts?.includes(selectedCutout))throw new Error('Unlock this cutout before editing its motion.');const pose={...sample.occluders[index]};delete pose.vertices;delete pose.id;const field={depth:'z',cutoutX:'x',cutoutY:'y',cutoutAngle:'angle'}[kind];pose[field]=kind==='cutoutAngle'?value*Math.PI/180:value;setKey(physicalPieces(next)[index].keys,time,pose);}
 project.scene=validatePhysicalScene(next);manual=true;syncPhysical();render();$('fitStatus').textContent='Motion adjusted';$('fitDescription').textContent='The shadow is rendered from your changed physical scene.';announce('Physical scene edited at '+(time*project.duration).toFixed(2)+'s. Target silhouettes are unchanged.');
 }catch(e){announce(e.message,true);syncPhysical();}
}
function remeasure(){if(project.scene){report=safelyMeasure(project.scene,project.targets);showReport();}}
function download(name,type,data){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function filename(){return (project.title||'shadow-stage').normalize('NFKD').replace(/[^a-z0-9-]+/gi,'-').replace(/^-|-$/g,'').slice(0,60)||'shadow-stage';}
function exportSVG(){const polygons=projectPolygons(project.scene,time).map(p=>'<polygon points="'+p.map(([x,y])=>(500+x*400)+','+(500-y*400)).join(' ')+'" fill="#283e32"/>').join('');download(filename()+'-shadow.svg','image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><title>Shadow Stage projected scene</title><rect width="1000" height="1000" fill="#e7ebd7"/>'+polygons+'</svg>');announce('SVG download prepared from the projected physical scene.');}
function exportPlayer(){download(filename()+'-player.html','text/html',standalonePlayer(project.scene));announce('Standalone player prepared. It reconstructs every cutout shadow from the exported scene offline.');}
function safelyMeasure(scene,targets){try{return measurePhysicalScene(scene,targets);}catch(error){return {unresolved:true,reason:error.message};}}
function showPreset(name='current'){
 const picker=$('presetSelect');
 if(![...picker.options].some(option=>option.value==='current')){
  const option=new Option('Current project','current');option.disabled=true;picker.add(option,0);
 }
 picker.value=name;
}
function loadProject(next,{preserveComparisonBaseline=false}={}){
 showPreset();
 cancelSolve();if(!preserveComparisonBaseline)comparisonController?.resetProject();loadEpoch++;project=next;selectedCutout='cutout-1';active=0;time=0;dirty=false;manual=false;pendingProposal=null;fittedScene=next.scene?copy(next.scene):null;report=next.scene?safelyMeasure(next.scene,next.targets):null;setPlaying(false);
 $('duration').value=project.duration;$('constructionMode').value=project.construction?.mode||(isArticulated(project.scene)?'pieces':'single');const budget=project.construction?.maxPieces||12;if(![...$('pieceBudget').options].some(o=>+o.value===budget))$('pieceBudget').add(new Option(String(budget),String(budget)));$('pieceBudget').value=budget;syncConstruction();
 $('lightShare').value=project.lightShare??.65;$('lightShareValue').textContent=Math.round(+$('lightShare').value*100)+'%';resetTransform();filmstrip();syncPhysical();showReport();$('proposalPanel').hidden=true;render();
}
function reset(name='flight'){const p=newProject(preset(name));p.title=name==='orbit'?'A quiet orbit':name==='shape-change'?'A change of shape':'Paper flight';p.duration=8;if(name==='shape-change')p.construction={mode:'pieces',maxPieces:12};loadProject(p);showPreset(name);solve();}

$('solveButton').addEventListener('click',solve);$('playButton').addEventListener('click',()=>setPlaying(!playing));$('timeline').addEventListener('input',()=>{setPlaying(false);setTime($('timeline').value);});
$('targetSelect').addEventListener('change',()=>selectMoment($('targetSelect').value));
for(const id of ['targetX','targetY','targetScale','targetAngle'])$(id).addEventListener('input',()=>{const p=transformed(editBase,{x:+$('targetX').value,y:+$('targetY').value,scale:+$('targetScale').value,angle:+$('targetAngle').value});try{const targets=copy(project.targets);targets[active].polygon=p;project.targets=validateTargets(targets);showTransform();targetChanged();}catch(e){announce(e.message,true);}});
$('lightShare').addEventListener('input',()=>{cancelSolve();$('lightShareValue').textContent=Math.round(+$('lightShare').value*100)+'%';announce('Motion balance changed. Find the performance to apply it.');});
for(const [id,kind] of [['lightX','x'],['lightY','y'],['occluderDepth','depth']]){$(id).addEventListener('input',()=>editPhysical(kind,+$(id).value));$(id).addEventListener('change',remeasure);}
$('resetRig').addEventListener('click',()=>{if(fittedScene){cancelSolve();project.scene=copy(fittedScene);manual=false;remeasure();syncPhysical();render();announce('Restored the last fitted motion.');}});
$('duration').addEventListener('change',()=>{const d=+$('duration').value;if(!Number.isFinite(d)||d<1||d>3600){$('duration').value=project.duration;return;}cancelSolve();project.duration=d;if(project.scene)project.scene.duration=d;if(fittedScene)fittedScene.duration=d;filmstrip();render();});
for(const id of ['showTarget','showTrail'])$(id).addEventListener('change',render);
$('newProject').addEventListener('click',()=>{$('presetSelect').value='flight';reset('flight');announce('New Paper flight scene. Previous exported projects are unchanged.');});
$('presetSelect').addEventListener('change',()=>reset($('presetSelect').value));
$('saveProject').addEventListener('click',()=>{try{download(filename()+'.json','application/json',serializeProject(project));announce('Editable project download prepared. Open it in this studio to resume.');}catch(e){announce(e.message,true);}});
$('importProject').addEventListener('change',async e=>{const f=e.target.files?.[0],generation=++importGeneration,epoch=loadEpoch;if(!f)return;try{if(f.size>2*1024*1024)throw new Error('Project exceeds 2 MiB.');const p=parseProject(await f.text());if(generation!==importGeneration||epoch!==loadEpoch)return;loadProject(p);announce('Opened '+f.name+' with its editable targets and physical scene.');}catch(error){if(generation===importGeneration&&epoch===loadEpoch)announce('Project was not opened: '+error.message,true);}finally{if(generation===importGeneration)e.target.value='';}});
$('exportSVG').addEventListener('click',exportSVG);$('exportPlayer').addEventListener('click',exportPlayer);
$('addMoment').addEventListener('click',()=>{if(project.targets.length>=12){announce('The studio supports up to 12 authored moments.',true);return;}if(project.targets.length===1){const t=project.targets[0].t<.5?1:0;project.targets.push({t,polygon:copy(project.targets[0].polygon)});project.targets.sort((a,b)=>a.t-b.t);active=project.targets.findIndex(k=>k.t===t);}else{let index=0,gap=-1;for(let i=0;i<project.targets.length-1;i++){const g=project.targets[i+1].t-project.targets[i].t;if(g>gap){gap=g;index=i;}}const t=(project.targets[index].t+project.targets[index+1].t)/2;const p=targetAt(project.targets,t);project.targets.splice(index+1,0,{t,polygon:p});active=index+1;}resetTransform();targetChanged();});
$('removeMoment').addEventListener('click',()=>{if(project.targets.length<=2)return;project.targets.splice(active,1);active=Math.min(active,project.targets.length-1);resetTransform();targetChanged();});
function setMode(value){mode=value;$('moveMode').classList.toggle('active',value==='move');$('drawMode').classList.toggle('active',value==='draw');$('moveMode').setAttribute('aria-pressed',value==='move');$('drawMode').setAttribute('aria-pressed',value==='draw');$('editHint').textContent=value==='draw'?'Draw one simple closed silhouette on the stage. A self-crossing outline is kept out of the physical scene.':'Drag a point or the outline on the stage. Editing a target preserves the last performance until you solve again.';render();}
$('moveMode').addEventListener('click',()=>setMode('move'));$('drawMode').addEventListener('click',()=>setMode('draw'));
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;setPlaying(false);setTime(project.targets[active].t);const p=inverse(e);canvas.setPointerCapture(e.pointerId);if(mode==='draw'){drawn=[p];drag={type:'draw'};$('drawingMessage').hidden=false;}else{const polygon=project.targets[active].polygon;let point=-1,dist=14/view.scale;polygon.forEach((v,i)=>{const d=Math.hypot(v[0]-p[0],v[1]-p[1]);if(d<dist){point=i;dist=d;}});drag={type:point>=0?'point':'move',point,start:p,base:copy(polygon)};}});
canvas.addEventListener('pointermove',e=>{if(!drag)return;const p=inverse(e);if(drag.type==='draw'){const last=drawn.at(-1);if(drawn.length<180&&Math.hypot(p[0]-last[0],p[1]-last[1])>.035)drawn.push(p);render();return;}let polygon=copy(drag.base);if(drag.type==='point')polygon[drag.point]=p;else polygon=polygon.map(v=>[v[0]+p[0]-drag.start[0],v[1]+p[1]-drag.start[1]]);try{const targets=copy(project.targets);targets[active].polygon=polygon;comparisonController?.invalidate('Targets changed. Compare again.');project.targets=validateTargets(targets);dirty=true;render();}catch{/* Keep the last valid polygon while the pointer crosses an invalid boundary. */}});
function finishPointer(e){if(!drag)return;if(drag.type==='draw'){try{const targets=copy(project.targets);targets[active].polygon=drawn;project.targets=validateTargets(targets);targetChanged();}catch(error){announce('That outline was not kept: '+error.message,true);}drawn=[];$('drawingMessage').hidden=true;}else targetChanged();drag=null;resetTransform();render();}
canvas.addEventListener('pointerup',finishPointer);canvas.addEventListener('pointercancel',()=>{if(drag&&drag.type!=='draw'){resetTransform();targetChanged();}drag=null;drawn=[];$('drawingMessage').hidden=true;render();});

async function modelStatus(){try{const r=await fetch('/api/status');const s=await r.json();modelAvailable=!!s.configured;$('proposeButton').disabled=!modelAvailable;$('modelStatus').textContent=modelAvailable?`Configured: ${s.model} on Nebius. A proposal is editable and needs your adoption.`:'Local studio ready. No Nebius credential is configured on this host; no model call has been made.';}catch{modelAvailable=false;$('proposeButton').disabled=true;$('modelStatus').textContent='Local studio ready. Model connection is unavailable.';}}
async function requestSuggestion(){
 const original=serializeProject(project),kind=$('proposalKind').value;
 if(kind==='physical'&&!isArticulated(project.scene)){announce('Build a construction of pieces first, so a suggested rig can be compared with it.',true);return;}
 if(kind==='physical'&&project.scene.occluders.length>16){announce('Physical suggestions support up to 16 cutouts. Choose a smaller piece budget for this comparison.',true);return;}
 $('proposeButton').disabled=true;$('modelStatus').textContent='Asking for an editable '+(kind==='physical'?'physical construction':'choreography proposal')+'…';
 try{
  const input={brief:$('brief').value,project};if(kind==='physical')input.exactPieceCount=project.scene.occluders.length;
  const r=await fetch(kind==='physical'?'/api/scene-propose':'/api/propose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),data=await r.json();
  if(data.configured===false)modelAvailable=false;if(!r.ok)throw new Error(data.error||'No proposal returned.');
  if(serializeProject(project)!==original)throw new Error('The project changed while the proposal was being made. Request a fresh proposal.');
  pendingProposal={...data,source:original,kind};$('proposalSummary').textContent=data.proposal.summary;$('proposalPanel').hidden=false;$('modelStatus').textContent='Received from '+(data.evidence.returnedModel||data.evidence.requestedModel)+' on Nebius. The geometry still needs evaluation.';
 }catch(e){$('modelStatus').textContent=e.message;}finally{$('proposeButton').disabled=!modelAvailable;}
}
function adoptSuggestion(){
 if(!pendingProposal)return;
 try{
  if(serializeProject(project)!==pendingProposal.source)throw new Error('The project changed after this proposal arrived. Request a fresh proposal.');
  let candidate;
  if(pendingProposal.kind==='physical'){
   const proposed=applySceneProposal(project,pendingProposal.proposal);
   candidate=parseProject(serializeProject({...project,scene:proposed.scene,construction:{mode:'pieces',maxPieces:proposed.scene.occluders.length},lockedCutouts:[],authoring:{status:'proposed',original:{title:project.title,duration:project.duration,targets:project.targets,scene:project.scene},evidence:pendingProposal.evidence}}));
  }else{candidate=applyProposal(project,pendingProposal.proposal,pendingProposal.evidence);if(project.construction)candidate.construction=copy(project.construction);}
  const physical=pendingProposal.kind==='physical';loadProject(candidate,{preserveComparisonBaseline:physical});dirty=!physical;showReport();announce(physical?'Proposed physical construction adopted. Targets are unchanged; inspect the rendered result and refine the rig.':'Proposed moments adopted. The previous scene is retained in project history; solve to see the new performance.');
 }catch(e){announce(e.message,true);}
}
$('proposeButton').addEventListener('click',requestSuggestion);
$('adoptProposal').addEventListener('click',adoptSuggestion);

$('dismissProposal').addEventListener('click',()=>{pendingProposal=null;$('proposalPanel').hidden=true;announce('Your current moments are preserved.');});

window.shadowStage={getProject:()=>copy(project),getState:()=>({time,active,playing,dirty,manual,report:copy(report)}),getComparisonState:()=>comparisonController?.getState(),getVideoState:()=>({pending:!!videoController,receipt:copy(lastVideoReceipt)}),setTime,selectMoment,projectShadow:t=>project.scene?projectPolygons(project.scene,t)[0]:null,projectShadows:t=>project.scene?projectPolygons(project.scene,t):[]};
function frame(now){if(playing&&project.scene){if(lastFrame)time=Math.min(1,time+(now-lastFrame)/1000/project.duration);lastFrame=now;if(time>=1)setPlaying(false);render();}requestAnimationFrame(frame);}
new ResizeObserver(render).observe(canvas.parentElement);new ResizeObserver(drawRig).observe(rig.parentElement);
function bindConstruction(){
 $('refineButton').addEventListener('click',()=>solve('refine'));
 $('constructionMode').addEventListener('change',()=>{cancelSolve();project.construction={mode:$('constructionMode').value,maxPieces:+$('pieceBudget').value};syncConstruction();announce('Construction choice changed. Find the performance to apply it.');});
 $('pieceBudget').addEventListener('change',()=>{cancelSolve();project.construction={mode:$('constructionMode').value,maxPieces:+$('pieceBudget').value};announce('Piece budget changed. Find the performance to build the new construction.');});
 $('cutoutSelect').addEventListener('change',()=>{selectedCutout=$('cutoutSelect').value;syncPhysical();drawRig();});
 $('lockCutout').addEventListener('change',()=>{cancelSolve();const locks=new Set(project.lockedCutouts||[]);$('lockCutout').checked?locks.add(selectedCutout):locks.delete(selectedCutout);project.lockedCutouts=[...locks];syncPhysical();announce($('lockCutout').checked?'This cutout’s motion will be preserved while refining.':'This cutout’s motion is editable again.');});
 for(const id of ['cutoutX','cutoutY','cutoutAngle']){$(id).addEventListener('input',()=>editPhysical(id,+$(id).value));$(id).addEventListener('change',remeasure);}
}
comparisonController=mountComparison({root:$('comparisonPanel'),getProject:()=>project,isBusy:()=>!!solverWorker,notify:text=>announce(text),onAdopt(scene){
 const validated=validatePhysicalScene(copy(scene)),measured=safelyMeasure(validated,project.targets);
 cancelSolve();project.scene=validated;fittedScene=copy(validated);report=measured;dirty=false;manual=false;pendingProposal=null;$('proposalPanel').hidden=true;setPlaying(false);project.lockedCutouts=[];syncPhysical();showReport();render();
}});
function syncVideo(){const capability=videoCapability();$('exportVideo').disabled=!project.scene||!!videoController||!capability.available;$('cancelVideo').hidden=!videoController;if(!videoController&&!lastVideoReceipt)$('videoStatus').textContent=capability.available?'A WebM of your physical performance. Export runs in real time; keep this tab active. Up to 120 seconds.':capability.reason;}
async function exportVideo(){
 if(!project.scene||videoController)return;const controller=new AbortController();videoController=controller;lastVideoReceipt=null;const name=filename();syncVideo();
 try{const {blob,receipt}=await recordPerformance(project.scene,{signal:controller.signal,onProgress:progress=>{$('videoStatus').textContent='Recording performance · '+Math.round(progress.physicalTime*100)+'%';}});if(controller.signal.aborted)throw new DOMException('Video export cancelled.','AbortError');lastVideoReceipt=receipt;download(name+'-performance.webm',blob.type,blob);$('videoStatus').textContent='WebM prepared from the frozen performance. '+(blob.size/1024).toFixed(0)+' KiB. Browser encoding determines actual frame timing.';announce('Finished performance video download prepared.');
 }catch(error){lastVideoReceipt=error.receipt||null;$('videoStatus').textContent=error.name==='AbortError'?'Video export cancelled. No completed video was downloaded.':'Video export failed: '+error.message;announce($('videoStatus').textContent,error.name!=='AbortError');}
 finally{if(videoController===controller)videoController=null;syncVideo();}
}
$('exportVideo').addEventListener('click',exportVideo);$('cancelVideo').addEventListener('click',()=>videoController?.abort());
bindConstruction();syncConstruction();resetTransform();filmstrip();syncPhysical();render();solve();modelStatus();requestAnimationFrame(frame);
