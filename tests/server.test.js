import test from 'node:test';
import assert from 'node:assert/strict';
import {readProviderJSON} from '../server.mjs';
function response(chunks,onCancel=()=>{}) {
  return {body:new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(new TextEncoder().encode(chunk));controller.close();},cancel:onCancel})};
}
test('provider JSON is decoded across byte chunks and cannot masquerade malformed content as success',async()=>{
 const actual={choices:[{message:{content:'{"summary":"影"}'}}]};
 const text=JSON.stringify(actual);assert.deepEqual(await readProviderJSON(response([text.slice(0,20),text.slice(20)])),actual);
 await assert.rejects(()=>readProviderJSON(response(['<html>failure</html>'])),/invalid JSON/);
 await assert.rejects(()=>readProviderJSON({body:null}),/empty response/);
});
test('oversized provider stream is cancelled before parsing',async()=>{
 let cancelled=false;
 const upstream={body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array(256*1024+1));},cancel(){cancelled=true;}})};
 await assert.rejects(()=>readProviderJSON(upstream),/exceeds 256 KiB/);assert.equal(cancelled,true);
});
test('provider stream interruption rejects without returning a partial result',async()=>{
 const upstream={body:new ReadableStream({start(controller){controller.error(new Error('connection interrupted'));}})};
 await assert.rejects(()=>readProviderJSON(upstream),/connection interrupted/);
});
