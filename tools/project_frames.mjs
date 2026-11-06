// Exact existing project admission and physical projection; no solver/provider calls.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {parseProject} from '../src/project.js';
import {projectPolygons} from '../src/runtime.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function emit(value){if(!process.stdout.write(JSON.stringify(value)+'\n'))await once(process.stdout,'drain');}
try{
 if(process.argv.length!==3)throw Error('Usage: node tools/project_frames.mjs saved-project.json');
 const raw=readFileSync(process.argv[2]);
 const project=parseProject(raw.toString('utf8'));
 if(!project.scene)throw Error('The saved project has no physical scene. Fit or adopt a scene before exporting.');
 if(project.scene.duration>120)throw Error('Offline video supports performances up to 120 seconds.');
 const scene=project.scene,frameCount=Math.max(2,Math.floor(scene.duration*24+.5));
 const sourceSha256={};for(const name of ['tools/project_frames.mjs','src/project.js','src/runtime.js','src/core.js','src/articulated.js'])sourceSha256[name]=sha(readFileSync(new URL('../'+name,import.meta.url)));
 await emit({type:'header',scene,sceneJson:JSON.stringify(scene),sceneSha256:sha(JSON.stringify(scene)),inputSha256:sha(raw),sourceSha256,frameCount,width:1000,height:714,fps:24,requestedDurationSeconds:scene.duration,actualDurationSeconds:frameCount/24,durationRoundingSeconds:frameCount/24-scene.duration});
 for(let frame=0;frame<frameCount;frame++)await emit({type:'frame',frame,physicalTime:frame/(frameCount-1),presentationTime:frame/24,polygons:projectPolygons(scene,frame/(frameCount-1))});
}catch(error){console.error(error.message);process.exitCode=1;}
