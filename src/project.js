import {validateTargets, validateScene} from './core.js';
import {validateArticulatedScene} from './articulated.js';
export const PROJECT_FORMAT = 'shadow-stage/project-v1';
export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
const bytes = text => new TextEncoder().encode(text).length;
function sceneData(value) {
  if (value === null) return null;
  if(value?.format==='shadow-stage/articulated-v1') {
    const scene=validateArticulatedScene(value);
    return {format:scene.format,duration:scene.duration,light:{keys:scene.light.keys.map(({t,x,y,z})=>({t,x,y,z}))},occluders:scene.occluders.map(piece=>({id:piece.id,vertices:piece.vertices,keys:piece.keys.map(({t,x,y,z,angle})=>({t,x,y,z,angle}))}))};
  }
  const scene = validateScene(value);
  // Only editable geometry survives import; cached reports cannot certify this scene.
  return {format:scene.format,duration:scene.duration,light:{keys:scene.light.keys.map(({t,x,y,z})=>({t,x,y,z}))},occluder:{vertices:scene.occluder.vertices,keys:scene.occluder.keys.map(({t,x,y,z,angle})=>({t,x,y,z,angle}))}};
}
function content(p) {
  if (!p || typeof p !== 'object' || typeof p.title !== 'string' || p.title.length > 300) throw new Error('Project title must be at most 300 characters');
  if (typeof p.duration !== 'number' || !Number.isFinite(p.duration) || p.duration <= 0 || p.duration > 3600) throw new Error('Invalid project duration');
  const scene = sceneData(p.scene);
  if (scene && scene.duration !== p.duration) throw new Error('Project and scene durations differ');
  return {title:p.title,duration:p.duration,targets:validateTargets(p.targets),scene};
}
function evidenceData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid model evidence');
  const out={verification:'recorded-provider-response-not-independently-verified'};
  for(const key of ['provider','requestedModel','returnedModel','requestId','receivedAt']) {
    if(value[key] === null) {out[key]=null;continue;}
    if(value[key] !== undefined) {
      if(typeof value[key] !== 'string'||value[key].length>300)throw new Error('Invalid evidence '+key);
      out[key]=value[key];
    }
  }
  for(const key of ['inputSha256','responseSha256'])if(value[key]!==undefined){if(typeof value[key]!=='string'||!/^[a-f0-9]{64}$/.test(value[key]))throw new Error('Invalid evidence hash');out[key]=value[key];}
  if(value.elapsedMs!==undefined){if(typeof value.elapsedMs!=='number'||!Number.isFinite(value.elapsedMs)||value.elapsedMs<0||value.elapsedMs>86400000)throw new Error('Invalid elapsed time');out.elapsedMs=value.elapsedMs;}
  if(value.executed!==undefined){if(typeof value.executed!=='boolean')throw new Error('Invalid execution evidence');out.executed=value.executed;}
  if(value.usage!==undefined&&value.usage!==null){out.usage={};for(const key of ['prompt_tokens','completion_tokens','total_tokens'])if(value.usage[key]!==undefined){if(!Number.isSafeInteger(value.usage[key])||value.usage[key]<0)throw new Error('Invalid token usage');out.usage[key]=value.usage[key];}}
  return out;
}
function normalize(p) {
  if (p?.format !== PROJECT_FORMAT) throw new Error('Unsupported project format');
  const out = {format:PROJECT_FORMAT,...content(p)};
  if(p.construction!==undefined){
    if(!['single','pieces'].includes(p.construction?.mode)||!Number.isInteger(p.construction.maxPieces)||p.construction.maxPieces<1||p.construction.maxPieces>64)throw new Error('Invalid construction settings');
    out.construction={mode:p.construction.mode,maxPieces:p.construction.maxPieces};
  }
  if(p.lockedCutouts!==undefined){
    const ids=new Set(out.scene?.occluders?.map(piece=>piece.id)||[]);
    if(!Array.isArray(p.lockedCutouts)||p.lockedCutouts.length>64||new Set(p.lockedCutouts).size!==p.lockedCutouts.length||p.lockedCutouts.some(id=>typeof id!=='string'||!ids.has(id)))throw new Error('Locked cutouts must identify actual pieces');
    out.lockedCutouts=p.lockedCutouts.slice();
  }
  if (p.lightShare !== undefined) {
    if(typeof p.lightShare !== 'number'||!Number.isFinite(p.lightShare)||p.lightShare<0||p.lightShare>1) throw new Error('Invalid light share');
    out.lightShare=p.lightShare;
  }
  if (p.authoring !== undefined) {
    if (p.authoring?.status !== 'proposed') throw new Error('Invalid authoring status');
    out.authoring={status:'proposed',original:content(p.authoring.original)};
    if(p.authoring.evidence!==undefined)out.authoring.evidence=evidenceData(p.authoring.evidence);
  }
  return out;
}
export function serializeProject(project) {
  // Bound the input too, before canonicalizing away unknown certification fields.
  const input = JSON.stringify(project);
  if (typeof input !== 'string' || bytes(input)>MAX_PROJECT_BYTES) throw new Error('Project exceeds size limit');
  const text=JSON.stringify(normalize(project),null,2);
  if(bytes(text)>MAX_PROJECT_BYTES)throw new Error('Project exceeds size limit');
  return text;
}
export function parseProject(text) {
  if(typeof text!=='string'||bytes(text)>MAX_PROJECT_BYTES)throw new Error('Project exceeds size limit');
  return normalize(JSON.parse(text));
}
export function newProject(targets) {
  return normalize({format:PROJECT_FORMAT,title:'Untitled shadow performance',duration:8,targets,scene:null});
}
