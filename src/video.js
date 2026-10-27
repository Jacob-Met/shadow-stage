import {validatePhysicalScene,projectPolygons} from './runtime.js';

const WIDTH=1000,HEIGHT=714,FPS=24,MAX_SECONDS=120,MAX_BYTES=64*1024*1024;
const abortError=()=>new DOMException('Video export cancelled.','AbortError');
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

export function videoCapability(){
  if(typeof MediaRecorder==='undefined'||typeof HTMLCanvasElement.prototype.captureStream!=='function'||typeof CanvasCaptureMediaStreamTrack==='undefined'||typeof CanvasCaptureMediaStreamTrack.prototype.requestFrame!=='function')return {available:false,reason:'This browser cannot record the performance as WebM. The standalone player is available.'};
  const mimeType=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
  return mimeType?{available:true,mimeType,maximumSeconds:MAX_SECONDS}:{available:false,reason:'This browser has no supported WebM encoder. The standalone player is available.'};
}

// One frozen physical scene, rendered independently from all studio canvases.
// Requests are nominally 24 fps; the encoder chooses actual frame timestamps.
export async function recordPerformance(input,{signal,onProgress=()=>{}}={}){
  const scene=validatePhysicalScene(structuredClone(input));
  if(scene.duration>MAX_SECONDS)throw new Error('Video export supports performances up to 120 seconds. Shorten the duration or export the standalone player.');
  if(signal?.aborted)throw abortError();
  const capability=videoCapability();if(!capability.available)throw new Error(capability.reason);
  const receipt={format:'shadow-stage/video-export-v1',status:'recording',scene:structuredClone(scene),sceneSha256:await digest(new TextEncoder().encode(JSON.stringify(scene))),dimensions:[WIDTH,HEIGHT],nominalFramesPerSecond:FPS,requestedDurationSeconds:scene.duration,requestedMimeType:capability.mimeType,requests:[],events:[],limitations:['Browser capture uses real-time scheduling; encoded frame cadence and duration can differ from requests.','The scene snapshot is fixed at export start.','This export does not certify collision clearance, fabrication or artistic transition quality.']};
  if(signal?.aborted)throw abortError();
  const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;canvas.className='video-export-canvas';canvas.setAttribute('aria-hidden','true');document.body.append(canvas);
  let stream,recorder,watchdog,abortListener,failedReason,bytes=0;
  const chunks=[];
  let fail;const failure=new Promise((_,reject)=>{fail=error=>{if(!failedReason){failedReason=error;reject(error);}};});failure.catch(()=>{});
  const wait=promise=>Promise.race([promise,failure]);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function draw(t){const ctx=canvas.getContext('2d');ctx.fillStyle='#e7ebd7';ctx.fillRect(0,0,WIDTH,HEIGHT);ctx.fillStyle='#283e32';for(const polygon of projectPolygons(scene,t)){ctx.beginPath();polygon.forEach(([x,y],i)=>{if(i)ctx.lineTo(500+260*x,350-260*y);else ctx.moveTo(500+260*x,350-260*y);});ctx.closePath();ctx.fill();}}
  try{
    stream=canvas.captureStream(0);const track=stream.getVideoTracks()[0];if(!track||typeof track.requestFrame!=='function')throw new Error('Manual frame capture is unavailable.');
    recorder=new MediaRecorder(stream,{mimeType:capability.mimeType,videoBitsPerSecond:4000000});
    const event=name=>new Promise(resolve=>recorder.addEventListener(name,()=>{receipt.events.push({type:name,at:performance.now()});resolve();},{once:true}));
    const started=event('start'),stopped=event('stop');
    recorder.addEventListener('dataavailable',event=>{receipt.events.push({type:'dataavailable',bytes:event.data.size,at:performance.now()});if(event.data.size){bytes+=event.data.size;if(bytes>MAX_BYTES)fail(new Error('Video exceeded the 64 MiB export limit. Shorten the performance.'));else chunks.push(event.data);}});
    recorder.addEventListener('error',event=>fail(new Error(event.error?.message||'The browser could not encode this video.')));
    abortListener=()=>fail(abortError());signal?.addEventListener('abort',abortListener,{once:true});
    if(signal?.aborted)throw abortError();
    watchdog=setTimeout(()=>fail(new Error('The browser did not finish recording in time. Keep this tab active and try again.')),(scene.duration+10)*1000);
    draw(0);receipt.recorderStartCalledAt=performance.now();recorder.start(1000);await wait(started);
    const origin=performance.now(),count=Math.max(2,Math.round(scene.duration*FPS));receipt.scheduleOrigin=origin;receipt.plannedRequests=count;receipt.plannedCaptureDurationSeconds=count/FPS;
    for(let i=0;i<count;i++){
      const scheduledMs=i*1000/FPS,remaining=origin+scheduledMs-performance.now();if(remaining>0)await wait(sleep(remaining));if(failedReason)throw failedReason;
      const physicalTime=i/(count-1);draw(physicalTime);const beforeMs=performance.now()-origin;track.requestFrame();const actualMs=performance.now()-origin;
      receipt.requests.push({frame:i,physicalTime,scheduledMs,beforeMs,actualMs});onProgress({completed:i+1,total:count,physicalTime,elapsedMs:actualMs});
    }
    const remaining=origin+count*1000/FPS-performance.now();if(remaining>0)await wait(sleep(remaining));if(failedReason)throw failedReason;
    receipt.stopCalledAt=performance.now();recorder.stop();await wait(stopped);if(failedReason)throw failedReason;clearTimeout(watchdog);
    const blob=new Blob(chunks,{type:recorder.mimeType||capability.mimeType});if(!blob.size)throw new Error('The browser produced an empty video.');
    receipt.recorderMimeType=recorder.mimeType;receipt.blobType=blob.type;receipt.bytes=blob.size;receipt.sha256=await digest(await blob.arrayBuffer());
    if(failedReason)throw failedReason;if(signal?.aborted)throw abortError();
    receipt.status='complete';return {blob,receipt};
  }catch(error){receipt.status=error.name==='AbortError'?'cancelled':'failed';receipt.error=error.message;error.receipt=receipt;throw error;}
  finally{
    clearTimeout(watchdog);if(abortListener)signal?.removeEventListener('abort',abortListener);
    if(recorder&&recorder.state!=='inactive'){try{recorder.stop();}catch{/* The encoder may already have ended after an error. */}}
    if(stream)stream.getTracks().forEach(track=>track.stop());
    receipt.cleanup={trackStates:stream?stream.getTracks().map(track=>track.readyState):[],canvasRemoved:true};canvas.remove();
  }
}
