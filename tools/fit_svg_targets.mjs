// One selected existing fitter call on already mapped authored targets.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateTargets,fitScene} from '../src/core.js';
import {fitArticulated} from '../src/articulated.js';
import {serializeProject,parseProject} from '../src/project.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 if(process.argv.length!==4)throw Error('Usage: fit_svg_targets.mjs admitted.json output-directory');
 const input=JSON.parse(readFileSync(process.argv[2],'utf8')),out=process.argv[3];
 // Omission is the legacy single-cutout route. Explicit construction is opt-in.
 let construction={mode:'single',maxPieces:1};
 if(Object.hasOwn(input,'construction')){
  const value=input.construction;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||
     !Object.hasOwn(value,'mode')||!Object.hasOwn(value,'maxPieces')||
     value.mode!=='pieces'||!Number.isInteger(value.maxPieces)||value.maxPieces<1||value.maxPieces>24)
   throw Error("Construction must be exactly {mode:'pieces',maxPieces:integer 1..24}.");
  if(input.lightShare!==0)throw Error('Pieces construction requires lightShare exactly 0.');
  construction={mode:'pieces',maxPieces:value.maxPieces};
 }
 const targets=validateTargets(input.targets);
 const fitEngine=construction.mode==='pieces'?'fitArticulated':'fitScene';
 const fitOptions=construction.mode==='pieces'
  ?{maxPieces:construction.maxPieces,resolution:32,duration:input.duration,coverageTolerance:.01}
  :{duration:input.duration,lightShare:input.lightShare};
 const {scene,report}=construction.mode==='pieces'
  ?fitArticulated(targets,fitOptions):fitScene(targets,fitOptions);
 const project={format:'shadow-stage/project-v1',title:input.title,duration:input.duration,lightShare:input.lightShare,construction,targets,scene};
 const serialized=serializeProject(project),roundtrip=parseProject(serialized);
 if(serializeProject(roundtrip)!==serialized)throw Error('Project roundtrip changed serialized content.');
 writeFileSync(out+'/project.json',serialized);writeFileSync(out+'/fit-report.json',JSON.stringify(report,null,2)+'\n');
 const sourceSha256={};for(const name of ['tools/fit_svg_targets.mjs','src/core.js','src/project.js','src/articulated.js'])sourceSha256[name]=sha(readFileSync(new URL('../'+name,import.meta.url)));
 console.log(JSON.stringify({fitEngine,fitOptions,construction,fitCalls:1,fitCountSemantics:'Fixed helper control flow; not external dynamic tracing.',projectSha256:sha(serialized),sceneSha256:sha(JSON.stringify(scene)),roundtrip:true,sourceSha256}));
}catch(error){console.error(error.message);process.exitCode=1;}
