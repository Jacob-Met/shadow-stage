/** Export authored targets only; never fits or projects the saved physical scene. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseProject, MAX_PROJECT_BYTES} from '../src/project.js';
import {validateTargets} from '../src/core.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SOURCES=['tools/export_svg_targets.mjs','src/project.js','src/core.js','src/articulated.js'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const need=(ok,message)=>{if(!ok)throw new Error(message);};
async function identities(){return Object.fromEntries(await Promise.all(SOURCES.map(async name=>[name,hash(await fs.readFile(path.join(ROOT,name)))])) );}
async function exists(name){try{await fs.lstat(name);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function save(name,value){await fs.writeFile(name,json(value));}
// Node's rename may replace an existing empty directory. Use the same Linux
// RENAME_NOREPLACE primitive as the maintained importer, without importing it.
const PUBLISH=`import ctypes,os,sys
libc=ctypes.CDLL(None,use_errno=True)
f=getattr(libc,'renameat2',None)
if f is None: raise RuntimeError('Linux renameat2 is required')
f.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
f.restype=ctypes.c_int
if f(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),1):
 e=ctypes.get_errno();raise OSError(e,os.strerror(e),sys.argv[2])
`;

async function run(input,destination,suppliedShare){
 input=path.resolve(input);destination=path.resolve(destination);
 need(!await exists(destination),'Output already exists; choose a new directory.');
 need((await fs.stat(path.dirname(destination))).isDirectory(),'Output parent directory must exist.');
 const stage=await fs.mkdtemp(path.join(path.dirname(destination),'.'+path.basename(destination)+'.partial-'));
 const receipt={schema:'shadow-stage.svg-target-export-receipt-v1',status:'preparing',inputPath:input,
  outputPath:destination,fitInvoked:false,sceneExported:false,outputs:[],
  mapping:{viewBox:[0,0,400,300],stageWidth:3.2,svgX:'200+125*x',svgY:'150-125*y'},
  limitations:['Targets only; physical scene, cutout IDs, locks and authoring evidence are not reconstructed by reimport.',
   'Reimport invokes a new fit. No exact physical scene or floating-point byte roundtrip is promised.',
   'Numerical-boundary polygons that fail maintained target validation after SVG serialization and inverse mapping are refused without perturbation.',
   'Construction is a separate importer option; pieces mode requires lightShare=0 and budget at most 24.',
   'Atomic no-overwrite publication requires Python3 and Linux renameat2. No power-loss durability guarantee.']};
 try{
  receipt.sourceSha256=await identities();
  const handle=await fs.open(input,'r');let raw;
  try{const buffer=Buffer.alloc(MAX_PROJECT_BYTES+1);let used=0;
   while(used<buffer.length){const {bytesRead}=await handle.read(buffer,used,buffer.length-used,null);if(!bytesRead)break;used+=bytesRead;}
   raw=buffer.subarray(0,used);
  }finally{await handle.close();}
  receipt.inputSha256=hash(raw);receipt.inputBytes=raw.length;
  receipt.inputHashScope='consumed bytes, bounded read of at most MAX_PROJECT_BYTES+1';
  receipt.inputComplete=raw.length<=MAX_PROJECT_BYTES;
  need(raw.length<=MAX_PROJECT_BYTES,'Project exceeds size limit.');
  const project=parseProject(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  need(project.duration<=120,'SVG sequence duration must not exceed 120 seconds.');
  need(project.targets.length>=2&&project.targets.length<=16,'SVG sequence needs 2–16 authored targets.');
  need(project.targets[0].t===0&&project.targets.at(-1).t===1,'SVG sequence targets must include endpoints 0 and 1.');
  let share=project.lightShare;
  if(share!==undefined){need(suppliedShare===undefined,'Saved lightShare cannot be overridden; omit --light-share.');receipt.lightShareSource='project';}
  else{need(suppliedShare!==undefined,'Project lacks lightShare; supply --light-share explicitly.');share=suppliedShare;receipt.lightShareSource='explicit-option';}
  const sequence={format:'shadow-stage/svg-sequence-v1',title:project.title,duration:project.duration,
   stageWidth:3.2,lightShare:share,moments:[]};
  let total=0;const inverseTargets=[];
  for(const [i,target] of project.targets.entries()){
   need(target.polygon.length<=128,'SVG target exceeds 128 vertices.');
   need(target.polygon.every(([x,y])=>x>=-1.6&&x<=1.6&&y>=-1.2&&y<=1.2),'Target lies outside fixed stage window x[-1.6,1.6], y[-1.2,1.2].');
   const points=target.polygon.map(([x,y])=>`${200+125*x},${150-125*y}`).join(' ');
   // Reparse the actual emitted decimal tokens, then preserve the importer's
   // multiplication/division order rather than simplifying the inverse scale.
   inverseTargets.push({t:target.t,polygon:points.split(' ').map(pair=>{
    const [svgX,svgY]=pair.split(',').map(Number);
    return [(svgX-200)*3.2/400,(150-svgY)*3.2/400];
   })});
   const bytes=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><polygon points="${points}" fill="black"/></svg>\n`);
   total+=bytes.length;need(bytes.length<=256*1024&&total<=2*1024*1024,'SVG serialized byte limit exceeded.');
   const file=`moment-${String(i).padStart(2,'0')}.svg`;
   await fs.writeFile(path.join(stage,file),bytes,{flag:'wx'});
   receipt.outputs.push({file,bytes:bytes.length,sha256:hash(bytes)});sequence.moments.push({t:target.t,file});
  }
  try{validateTargets(inverseTargets);}catch(error){
   receipt.roundtripGeometry={valid:false,validator:'src/core.js validateTargets',error:error.message};
   throw new Error('SVG roundtrip geometry refused: '+error.message);
  }
  receipt.roundtripGeometry={valid:true,validator:'src/core.js validateTargets',
   scope:'Emitted numeric SVG points inverse-mapped using unchanged importer arithmetic; no fit or cross-runtime execution.',
   targetCount:inverseTargets.length};
  const sequenceBytes=Buffer.from(json(sequence));need(sequenceBytes.length<=65536,'Sequence exceeds 64 KiB.');
  await fs.writeFile(path.join(stage,'sequence.json'),sequenceBytes,{flag:'wx'});
  receipt.outputs.push({file:'sequence.json',bytes:sequenceBytes.length,sha256:hash(sequenceBytes)});
  receipt.targetCount=project.targets.length;receipt.lightShare=share;
  receipt.sourceAfterSha256=await identities();
  receipt.sourceUnchanged=JSON.stringify(receipt.sourceSha256)===JSON.stringify(receipt.sourceAfterSha256);
  need(receipt.sourceUnchanged,'Source changed during export.');
  receipt.status='complete';receipt.publication={method:'Linux renameat2 RENAME_NOREPLACE via python3',timeoutMs:10000};
  await save(path.join(stage,'receipt.json'),receipt);
  const pub=spawnSync('python3',['-B','-c',PUBLISH,stage,destination],{encoding:'utf-8',timeout:10000,maxBuffer:65536});
  if(pub.error||pub.status!==0){
   // If the directory moved before a timeout/reporting failure, do not rewrite it.
   if(!await exists(stage))throw new Error('Publication outcome uncertain; inspect destination and do not retry.');
   await fs.rename(path.join(stage,'receipt.json'),path.join(stage,'prepublication-receipt.json'));
   receipt.publication.result={status:pub.status,signal:pub.signal,error:pub.error?.message,stdout:pub.stdout,stderr:pub.stderr};
   throw new Error('Atomic no-overwrite publication failed; partial evidence retained.');
  }
  return {output:destination,receiptSha256:hash(Buffer.from(json(receipt))),...receipt};
 }catch(error){
  if(await exists(stage)){
   receipt.status='failed';receipt.error={name:error.name,message:error.message};
   console.error('Retained partial directory: '+stage);
   await save(path.join(stage,'receipt.json'),receipt);await save(path.join(stage,'failure.json'),receipt.error);
  }
  throw error;
 }
}

async function main(){
 const args=process.argv.slice(2);
 need(args.length===2||(args.length===4&&args[2]==='--light-share'),'Usage: node tools/export_svg_targets.mjs PROJECT.json NEW_OUTPUT_DIRECTORY [--light-share NUMBER]');
 let share;
 if(args.length===4){need(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(args[3]),'--light-share must be a decimal number in [0,1].');share=Number(args[3]);need(Number.isFinite(share)&&share>=0&&share<=1,'Invalid light share.');}
 console.log(JSON.stringify(await run(args[0],args[1],share)));
}
main().catch(error=>{console.error(error.message);process.exitCode=2;});
