import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { proposeRequest, validateProposal } from './src/proposals.js';
import { physicalSceneRequest, validateSceneProposal } from './src/scene-proposals.js';
import { parseProject } from './src/project.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4318);
const MODEL = process.env.SHADOW_STAGE_MODEL || 'nvidia/Nemotron-3_5-Lightning';
const KEY = process.env.NEBIUS_API_KEY || process.env.NEBIUS_TOKEN_FACTORY_API_KEY || process.env.NEBIUS_TOKEN_FACTORY_KEY;
const ENDPOINT = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){let bytes=0,parts=[];for await(const p of req){bytes+=p.length;if(bytes>2*1024*1024+64*1024)throw new Error('Request exceeds project size plus 64 KiB overhead.');parts.push(p);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
function sameOrigin(req){const o=req.headers.origin;return !o||o===`http://${req.headers.host}`;}
// Nemotron is a reasoning model: reasoning tokens count against max_tokens and content stays null
// if the budget runs out, so the budget is set well above the proposal size.
export const MAX_TOKENS={proposal:8000,physical:12000};
export function providerPayload(model,request,physical){
  return {model,...request,temperature:0.2,max_tokens:physical?MAX_TOKENS.physical:MAX_TOKENS.proposal};
}
export function providerContent(result){
  const content=result?.choices?.[0]?.message?.content;
  if(typeof content!=='string'||!content.trim())throw new Error('Provider returned no message content (reasoning budget may be exhausted).');
  return content;
}
export async function readProviderJSON(response) {
  const limit=256*1024;
  if(!response.body)throw new Error('Provider returned an empty response.');
  const reader=response.body.getReader();let bytes=0;const parts=[];
  try {
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit){await reader.cancel();throw new Error('Provider response exceeds 256 KiB.');}parts.push(Buffer.from(value));}
  }finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new Error('Provider returned invalid JSON.');}
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/api/status')return json(res,200,{configured:!!KEY,provider:'Nebius Token Factory',model:MODEL,executed:false});
  if(req.method==='POST'&&['/api/propose','/api/scene-propose'].includes(url.pathname)){
    if(!sameOrigin(req))return json(res,403,{error:'Use the studio on this host to request a proposal.'});
    if(!KEY)return json(res,503,{error:'This studio has no configured Nebius credential. Local authoring, fitting and export are available.',configured:false});
    try{
      const input=await body(req);const project=parseProject(JSON.stringify(input.project));
      const physical=url.pathname==='/api/scene-propose';
      const request=physical?physicalSceneRequest(input.brief,project.targets,{duration:project.duration,exactPieceCount:input.exactPieceCount}):proposeRequest(input.brief,project);
      const submitted=providerPayload(MODEL,request,physical);
      const begin=Date.now();
      const upstream=await fetch(ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify(submitted),signal:AbortSignal.timeout(45000)});
      if(!upstream.ok)return json(res,502,{error:`Nebius returned HTTP ${upstream.status}. No proposal was adopted.`});
      const result=await readProviderJSON(upstream);const raw=providerContent(result);
      const proposal=physical?validateSceneProposal(raw,{exactPieceCount:input.exactPieceCount}):validateProposal(raw);
      if(physical&&proposal.scene.duration!==project.duration)throw new Error('Provider changed required duration');
      return json(res,200,{proposal,evidence:{provider:'Nebius Token Factory',requestedModel:MODEL,returnedModel:result.model||null,requestId:result.id||null,elapsedMs:Date.now()-begin,usage:result.usage||null,inputSha256:createHash('sha256').update(JSON.stringify(submitted)).digest('hex'),responseSha256:createHash('sha256').update(JSON.stringify(result)).digest('hex'),executed:true,receivedAt:new Date().toISOString()}});
    }catch(e){return json(res,422,{error:`Proposal unavailable: ${e.name==='TimeoutError'?'provider timed out':e.message}. The current scene is preserved.`});}
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not supported.'});
  try{
    const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    if(!/^\/(?:index\.html|styles\.css|app\.js|src\/[a-z-]+\.js)$/.test(relative))return json(res,404,{error:'Not found.'});
    const file=path.join(ROOT,relative);const info=await stat(file);if(!info.isFile())throw new Error('Not a file');
    const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:data);
  }catch{return json(res,404,{error:'Not found.'});}
});
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
server.listen(PORT,HOST,()=>console.log(JSON.stringify({product:'SHADOW STAGE',url:`http://${HOST}:${server.address().port}`,modelConfigured:!!KEY})));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));

}
