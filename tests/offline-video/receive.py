"""Independent finite whole-movie receiving; explicit post-freeze invocation only."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent
WIDTH,HEIGHT,FPS=1000,714,24

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path,value):path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')
def need(value,message):
    if not value:raise AssertionError(message)

def command(args,out,name,timeout=60,stdout_path=None):
    args=list(map(str,args));stream=stdout_path.open('xb') if stdout_path else None
    process=subprocess.Popen(args,stdout=stream if stream else subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    timed_out=False
    try:
        try:stdout,stderr=process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out=True
            try:os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            stdout,stderr=process.communicate()
    finally:
        if stream:stream.close()
    record=dict(command=args,exit=process.returncode,stdout=None if stream else stdout.decode(errors='replace'),stderr=stderr.decode(errors='replace'),timed_out=timed_out)
    write(out/(name+'.json'),record)
    need(not timed_out,'command timeout: '+name)
    return record

# Independently derive these authored scene trajectories. No runtime/projection import.
def polygons(case,t):
    u=t*t*(3-2*t)
    if case=='single':
        pieces=[(-.4+.8*u,-.08+.16*u,math.pi*.5*u)]
        lx=ly=0.
    else:
        pieces=[(-.24+.48*u,.08,0.),(.24-.48*u,-.08,0.)]
        lx=.2-.4*u;ly=.06-.12*u
    result=[]
    for ox,oy,angle in pieces:
        c,s=math.cos(angle),math.sin(angle)
        world=[(2*(ox+c*x-s*y)-lx,2*(oy+s*x+c*y)-ly) for x,y in [(-.12,-.12),(.12,-.12),(.12,.12),(-.12,.12)]]
        result.append([(500+260*x,350-260*y) for x,y in world])
    return result

def masks(polys):
    x=np.arange(WIDTH,dtype=np.float64)[None,:]+.5
    y=np.arange(HEIGHT,dtype=np.float64)[:,None]+.5
    combined=np.zeros((HEIGHT,WIDTH),bool);boundary=np.zeros_like(combined);pieces=[]
    for polygon in polys:
        inside=np.zeros_like(combined)
        for i,(ax,ay) in enumerate(polygon):
            bx,by=polygon[(i+1)%len(polygon)]
            if by!=ay:inside^=((ay>y)!=(by>y))&(x<(bx-ax)*(y-ay)/(by-ay)+ax)
            dx,dy=bx-ax,by-ay;length=dx*dx+dy*dy
            along=np.clip(((x-ax)*dx+(y-ay)*dy)/length,0,1)
            boundary|=(x-(ax+along*dx))**2+(y-(ay+along*dy))**2<=9
        combined|=inside;pieces.append(inside)
    return combined,boundary,pieces

def inspect_pixels(case,raw_path,count):
    need(raw_path.stat().st_size==count*WIDTH*HEIGHT*3,'decoded byte/frame count')
    rows=[]
    with raw_path.open('rb') as stream:
        for i in range(count):
            raw=stream.read(WIDTH*HEIGHT*3)
            image=np.frombuffer(raw,dtype=np.uint8).reshape(HEIGHT,WIDTH,3).astype(np.float64)
            foreground=np.array([40,62,50]);background=np.array([231,235,215])
            actual=((image-foreground)**2).sum(2)<((image-background)**2).sum(2)
            expected,boundary,pieces=masks(polygons(case,i/(count-1)))
            outside=~boundary;wrong=actual!=expected
            overlap=np.logical_and.reduce(pieces)&outside if len(pieces)>1 else np.zeros_like(outside)
            rows.append(dict(frame=i,physical_time=i/(count-1),decoded_rgb_sha256=hashlib.sha256(raw).hexdigest(),outside_band_pixels=int(outside.sum()),outside_band_wrong=int((wrong&outside).sum()),outside_band_accuracy=float(1-(wrong&outside).sum()/outside.sum()),whole_mask_wrong=int(wrong.sum()),whole_mask_accuracy=float(1-wrong.mean()),expected_foreground_pixels=int(expected.sum()),decoded_foreground_pixels=int(actual.sum()),union_mismatch_fraction=float(wrong.sum()/max(1,(actual|expected).sum())),overlap_interior_pixels=int(overlap.sum()),overlap_wrong=int((overlap&~actual).sum())))
    return rows

def decode_and_check(case,movie,out,count):
    probe=command(['ffprobe','-v','error','-select_streams','v:0','-show_streams','-show_format','-show_frames','-of','json',movie],out,case+'-ffprobe')
    need(probe['exit']==0,'ffprobe failed')
    metadata=json.loads(probe['stdout']);write(out/(case+'-metadata.json'),metadata)
    decoded=out/(case+'-decoded.rgb')
    decode=command(['ffmpeg','-v','error','-threads','1','-i',movie,'-map','0:v:0','-vsync','0','-pix_fmt','rgb24','-f','rawvideo',str(decoded)],out,case+'-decode')
    need(decode['exit']==0,'full decode failed')
    rows=inspect_pixels(case,decoded,count);write(out/(case+'-frame-metrics.json'),rows)
    streams=metadata['streams'];need(len(streams)==1,'one video stream')
    stream=streams[0];need(stream['codec_name']=='vp9' and stream['width']==WIDTH and stream['height']==HEIGHT,'codec/dimensions')
    num,den=map(int,stream['time_base'].split('/'));tick=num/den
    need(0<tick<=.001 and math.isfinite(tick),'finite time-base tick at most1ms')
    frames=metadata['frames'];need(len(frames)==count,'probe frame count')
    timestamps=[float(f['best_effort_timestamp_time']) for f in frames]
    need(all(math.isfinite(t) for t in timestamps) and all(b>a for a,b in zip(timestamps,timestamps[1:])),'strictly increasing finite frame timestamps')
    timing=[dict(frame=i,actual_seconds=t,expected_seconds=i/FPS,error_seconds=t-i/FPS) for i,t in enumerate(timestamps)]
    duration=float(metadata['format']['duration'])
    write(out/(case+'-timing.json'),dict(tick_seconds=tick,frames=timing,duration_seconds=duration,expected_duration_seconds=count/FPS))
    need(all(f['width']==WIDTH and f['height']==HEIGHT for f in frames),'per-frame dimensions')
    need(all(abs(r['error_seconds'])<=tick+1e-9 for r in timing),'fixed cadence/absolute PTS')
    need(abs(duration-count/FPS)<=tick+1e-9,'encoded duration')
    need(all(r['outside_band_accuracy']>=.995 for r in rows),'outside boundary classification')
    need(rows[0]['decoded_rgb_sha256']!=rows[-1]['decoded_rgb_sha256'],'distinct moving endpoints')
    if case=='crossing':
        need(max(r['overlap_interior_pixels'] for r in rows)>0,'fixture overlap actually exercised')
        need(all(r['overlap_wrong']==0 for r in rows),'overlap must stay foreground')
    return dict(case=case,frames=count,video_sha256=sha(movie),decoded_rgb_sha256=sha(decoded),minimum_outside_accuracy=min(r['outside_band_accuracy'] for r in rows),maximum_union_mismatch=max(r['union_mismatch_fraction'] for r in rows),time_base_tick=tick)

def file_inventory(directory):
    return {str(p.relative_to(directory)):dict(bytes=p.stat().st_size,sha256=sha(p)) for p in sorted(directory.rglob('*')) if p.is_file()}

def inspect_receipt(case,project,movie_dir,count,sources):
    receipt=json.loads((movie_dir/'receipt.json').read_text())
    need(receipt['status']=='complete' and receipt['sourceUnchanged'] is True and receipt['encoder']['exit']==0 and receipt['projectionExit']==0 and receipt['probe']['exit']==0,'producer completion receipts')
    need(receipt['width']==WIDTH and receipt['height']==HEIGHT and receipt['fps']==FPS and receipt['frameCount']==count,'receipt profile')
    need(receipt['inputSha256']==sha(project) and (movie_dir/'input-project.json').read_bytes()==project.read_bytes(),'input custody')
    scene=json.loads((movie_dir/'scene.json').read_text());original=json.loads(project.read_text())['scene']
    need(scene==original,'frozen scene preserved')
    need(receipt['requestedDurationSeconds']==scene['duration'] and receipt['durationRoundingSeconds']==count/FPS-scene['duration'],'requested duration and rounding')
    need(receipt['profile']==dict(supersampling=2,downsample='Pillow LANCZOS',background='#e7ebd7',foreground='#283e32',camera=[500,260,350,260],codec='libvpx-vp9',lossless=True,pixelFormat='yuv444p',threads=1,deadline='good',cpuUsed=4),'fixed encoder/raster profile')
    encoder_command=receipt['encoder']['command']
    for flag,value in [('-deadline','good'),('-cpu-used','4'),('-lossless','1'),('-pix_fmt','yuv444p'),('-threads','1')]:
        need(encoder_command.count(flag)==1 and encoder_command[encoder_command.index(flag)+1]==value,'encoder command '+flag)
    need(receipt['sceneSha256']==sha(movie_dir/'scene.json'),'exact scene bytes identity')
    need(receipt['videoSha256']==sha(movie_dir/'performance.webm'),'movie identity')
    need(abs(receipt['actualDurationSeconds']-count/FPS)<1e-12,'declared duration')
    for path,pin in receipt['sourceSha256'].items():need(path in sources and pin==sources[path],'source receipt binding '+path)
    need(bool(receipt['sourceSha256']),'source identity not empty')
    frames=receipt['frames'];need(len(frames)==count,'source frame count')
    for i,frame in enumerate(frames):
        need(frame['frame']==i and frame['physicalTime']==i/(count-1) and frame['presentationTime']==i/FPS,'source sample schedule')
        need(re.fullmatch('[0-9a-f]{64}',frame['rgbSha256']) is not None,'source RGB digest syntax')
    geometry=[json.loads(line) for line in (movie_dir/'projected-frames.jsonl').read_text().splitlines()]
    need(len(geometry)==count+1 and geometry[0]['type']=='header','projection record count')
    header=geometry[0]
    need(header['requestedDurationSeconds']==receipt['requestedDurationSeconds'] and header['durationRoundingSeconds']==receipt['durationRoundingSeconds'],'header duration metadata')
    need(header['sceneJson'].encode('utf-8')==(movie_dir/'scene.json').read_bytes(),'header exact scene serialization')
    need(header['scene']==scene and header['sceneSha256']==receipt['sceneSha256'] and header['inputSha256']==receipt['inputSha256'],'projection header identity')
    need(header['sourceSha256']=={k:v for k,v in receipt['sourceSha256'].items() if k!='tools/export_video.py'},'projection source pins')
    need(set(receipt['sourceSha256'])=={'tools/project_frames.mjs','tools/export_video.py','src/project.js','src/runtime.js','src/core.js','src/articulated.js'},'complete producer source set')
    for i,frame in enumerate(geometry[1:]):
        need(frame['type']=='frame' and frame['frame']==i and frame['physicalTime']==i/(count-1) and frame['presentationTime']==i/FPS,'projected frame schedule')
        expected=polygons(case,i/(count-1));actual=frame['polygons']
        need(len(actual)==len(expected),'projected piece count')
        for polygon,wanted in zip(actual,expected):
            need(len(polygon)==len(wanted),'projected vertex count')
            need(all(abs((500+260*x)-px)<=1e-10 and abs((350-260*y)-py)<=1e-10 for (x,y),(px,py) in zip(polygon,wanted)),'independent analytic projected vertices')
    for i in {0,count//2,count-1}:
        with Image.open(movie_dir/f'preview-{i:04d}.png') as image:
            need(image.mode=='RGB' and image.size==(WIDTH,HEIGHT),'preview profile')
            need(hashlib.sha256(image.tobytes()).hexdigest()==frames[i]['rgbSha256'],'retained original RGB preview hash')
    return receipt

def run(out):
    out.mkdir(parents=True,exist_ok=False)
    source_paths=['tools/export_video.py','tools/project_frames.mjs','src/runtime.js','src/core.js','src/articulated.js','src/project.js','tests/offline-video/receive.py','tests/offline-video/protocol.json','tests/offline-video/PROTOCOL.md','tests/offline-video/single.json','tests/offline-video/crossing.json','tests/offline-video/missing-scene.json']
    sources={name:sha(ROOT/name) for name in source_paths}
    write(out/'sources-before.json',sources)
    versions={}
    for executable in ('ffmpeg','ffprobe'):
        versions[executable]=command([executable,'-version'],out,executable+'-version')
        need(versions[executable]['exit']==0,'version observation')
    runtime=dict(python=sys.version,executable=sys.executable,executable_sha256=sha(sys.executable),numpy=np.__version__,affinity=sorted(os.sched_getaffinity(0)),threads={k:os.environ.get(k) for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS')})
    write(out/'runtime.json',runtime)
    summaries=[];receipts={}
    for case,count in [('single',24),('crossing',25)]:
        project=HERE/(case+'.json');destination=out/(case+'-movie')
        result=command([sys.executable,ROOT/'tools/export_video.py',project,destination],out,case+'-export')
        need(result['exit']==0,'producer export failed '+case)
        receipts[case]=inspect_receipt(case,project,destination,count,sources)
        summaries.append(decode_and_check(case,destination/'performance.webm',out,count))
        write(out/'movie-summaries.json',summaries)
    before=file_inventory(out/'single-movie');write(out/'existing-output-before.json',before)
    existing=command([sys.executable,ROOT/'tools/export_video.py',HERE/'single.json',out/'single-movie'],out,'refusal-existing-output')
    after=file_inventory(out/'single-movie');write(out/'existing-output-after.json',after)
    need(existing['exit']!=0 and 'Output already exists' in existing['stderr'] and before==after,'existing output refusal/preservation')
    missing=command([sys.executable,ROOT/'tools/export_video.py',HERE/'missing-scene.json',out/'missing-scene-movie'],out,'refusal-missing-scene')
    need(missing['exit']!=0 and not (out/'missing-scene-movie').exists(),'missing scene refusal')
    partials=list(out.glob('.missing-scene-movie.partial-*'));need(len(partials)==1,'missing-scene failure evidence')
    need('no physical scene' in (partials[0]/'projection.stderr').read_text(),'validator missing-scene reason')
    need(json.loads((partials[0]/'failure.json').read_text())['status']=='failed','failure receipt')
    after_sources={name:sha(ROOT/name) for name in source_paths};write(out/'sources-after.json',after_sources)
    need(sources==after_sources,'source/input bytes changed')
    result=dict(passed=True,movies=summaries,decoded_frames=49,successful_encodes=2,refusals=2,sources=sources,runtime=runtime,versions=versions,limits=['Independent analytic geometry on all49decodedframes; no producer projection imports.','Recorded source RGB hashes are provenance, not equality to decoded YUV-derived RGB.','No browser equivalence, artistic quality or general-project qualification.'])
    write(out/'result.json',result)
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    try:print(json.dumps(run(args.output),allow_nan=False))
    except BaseException as error:
        if args.output.exists():write(args.output/'receiving-failure.json',dict(type=type(error).__name__,error=str(error)))
        raise
