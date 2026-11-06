// Deterministic simulated DOM/recorder lifecycle checks, not browser or WebM receiving.
import test from 'node:test';
import assert from 'node:assert/strict';
import {recordPerformance} from '../src/video.js';

const fixture=()=>({format:'shadow-stage/articulated-v1',duration:3,light:{keys:[{t:0,x:0,y:0,z:5}]},occluders:[{id:'visibility-fixture',vertices:[[-.125,-.125],[.125,-.125],[.125,.125],[-.125,.125]],keys:[{t:0,x:0,y:0,z:2.5,angle:0}]}]});

test('visibility failure is latched through digest/capture and fresh attempts recover (simulated)',async()=>{
 const names=['document','HTMLCanvasElement','CanvasCaptureMediaStreamTrack','MediaRecorder','crypto','performance'];
 const original=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 let clock=0,digestCount=0,digestHook=()=>{},created=0;
 const tracks=[],recorders=[],canvases=[],listeners=new Set();
 class Track{constructor(){this.readyState='live';tracks.push(this);}requestFrame(){}stop(){this.readyState='ended';}}
 class Canvas{constructor(){created++;canvases.push(this);}setAttribute(){}getContext(){return {fillRect(){},beginPath(){},lineTo(){},moveTo(){},closePath(){},fill(){}};}captureStream(){const track=new Track();return {getVideoTracks:()=>[track],getTracks:()=>[track]};}remove(){this.removed=true;}}
 class Recorder extends EventTarget{
  static isTypeSupported(){return true;}
  constructor(stream,{mimeType}){super();this.state='inactive';this.mimeType=mimeType;recorders.push(this);}
  start(){this.state='recording';queueMicrotask(()=>this.dispatchEvent(new Event('start')));}
  stop(){this.state='inactive';queueMicrotask(()=>{const event=new Event('dataavailable');event.data=new Blob(['simulated bytes']);this.dispatchEvent(event);this.dispatchEvent(new Event('stop'));});}
 }
 const document={hidden:false,body:{append(){}},createElement:()=>new Canvas(),addEventListener(type,fn){assert.equal(type,'visibilitychange');listeners.add(fn);},removeEventListener(type,fn){listeners.delete(fn);}};
 function visibility(hidden){document.hidden=hidden;for(const fn of listeners)fn();}
 const globals={document,HTMLCanvasElement:Canvas,CanvasCaptureMediaStreamTrack:Track,MediaRecorder:Recorder,crypto:{subtle:{digest(){digestCount++;return digestHook(digestCount)??Promise.resolve(new Uint8Array(32).buffer);}}},performance:{now:()=>clock+=1000}};
 for(const [name,value]of Object.entries(globals))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 const scene=fixture(),before=structuredClone(scene);
 function clean(){assert.equal(listeners.size,0);assert.ok(tracks.every(t=>t.readyState==='ended'));assert.ok(recorders.every(r=>r.state==='inactive'));assert.ok(canvases.every(c=>c.removed));assert.deepEqual(scene,before);}
 async function refused(promise){await assert.rejects(promise,error=>{assert.match(error.message,/tab was hidden/);assert.equal(error.receipt.status,'failed');assert.equal(error.receipt.cleanup.canvasRemoved,true);assert.ok(error.receipt.cleanup.trackStates.every(s=>s==='ended'));return true;});clean();}
 try{
  visibility(true);await refused(recordPerformance(scene));assert.equal(created,0);assert.equal(digestCount,0);visibility(false);
  // Hide then restore while the first digest is pending: the failure must remain latched.
  let release;digestHook=()=>new Promise(resolve=>{release=resolve;});
  const first=recordPerformance(scene);visibility(true);visibility(false);await refused(first);assert.equal(created,0);release(new Uint8Array(32).buffer);
  digestHook=()=>{};
  let lost=false;await refused(recordPerformance(scene,{onProgress(){if(!lost){lost=true;visibility(true);visibility(false);}}}));assert.ok(created>0);
  // Final digest can remain unresolved; rejection and cleanup must not wait for it.
  let finalReached;const reached=new Promise(resolve=>{finalReached=resolve;});digestCount=0;
  digestHook=n=>n===2?new Promise(resolve=>{release=resolve;finalReached();}):undefined;
  const final=recordPerformance(scene);await reached;visibility(true);visibility(false);await refused(final);release(new Uint8Array(32).buffer);
  digestHook=()=>{};
  const recovered=await recordPerformance(scene);assert.equal(recovered.receipt.status,'complete');assert.ok(recovered.blob.size>0);clean();
  // Existing cancellation remains effective during the newly covered first-digest phase.
  const controller=new AbortController();digestHook=()=>new Promise(resolve=>{release=resolve;});
  const cancelled=recordPerformance(scene,{signal:controller.signal});controller.abort();
  await assert.rejects(cancelled,error=>error.name==='AbortError'&&error.receipt.status==='cancelled');clean();release(new Uint8Array(32).buffer);
 }finally{for(const [name,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
});
