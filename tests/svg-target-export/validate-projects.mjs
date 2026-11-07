// Receiving-only maintained parser roundtrips; no fitting, rendering or projection.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseProject,serializeProject} from '../../src/project.js';
try{
 const paths=process.argv.slice(2);if(paths.length!==7)throw Error('Expected six source fixtures and one received project.');
 const projects=paths.map(file=>{
  const raw=readFileSync(file),p=parseProject(raw.toString('utf8'));
  const encoded=serializeProject(p),again=serializeProject(parseProject(encoded));
  if(encoded!==again)throw Error('Project roundtrip changed: '+file);
  return {file,sha256:createHash('sha256').update(raw).digest('hex'),roundtrip:true,duration:p.duration,
   targets:p.targets.length,vertices:p.targets.map(t=>t.polygon.length),scenePresent:p.scene!==null};
 });
 console.log(JSON.stringify({count:projects.length,projects,fitInvoked:false}));
}catch(error){console.error(error.message);process.exitCode=1;}
