"""Finite SVG import receiving. Explicit invocation after root source freeze only."""
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
import threading
from PIL import Image,ImageDraw,ImageFont

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path,value):path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')
def need(ok,message):
    if not ok:raise AssertionError(message)
def inventory(directory):return {str(p.relative_to(directory)):sha(p) for p in sorted(directory.rglob('*')) if p.is_file()}

def command(args,out,name,timeout=60):
    args=list(map(str,args));p=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    timed_out=False
    try:stdout,stderr=p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out=True
        try:os.killpg(p.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        stdout,stderr=p.communicate()
    (out/(name+'.stdout')).write_bytes(stdout);(out/(name+'.stderr')).write_bytes(stderr)
    result=dict(command=args,exit=p.returncode,timed_out=timed_out,stdout_sha256=hashlib.sha256(stdout).hexdigest(),stderr_sha256=hashlib.sha256(stderr).hexdigest())
    write(out/(name+'-exec.json'),result);need(not timed_out,'timeout '+name)
    return result

# Independent direct projection only at authored keys; no imported fitting/runtime code.
def authored_projection(scene,t):
    light=next(k for k in scene['light']['keys'] if k['t']==t)
    piece=scene['occluder'];pose=next(k for k in piece['keys'] if k['t']==t)
    scale=light['z']/(light['z']-pose['z']);c=math.cos(pose['angle']);s=math.sin(pose['angle'])
    return [[scale*(pose['x']+c*x-s*y)+(1-scale)*light['x'],scale*(pose['y']+s*x+c*y)+(1-scale)*light['y']] for x,y in piece['vertices']]

def boundary_distance(a,b):
    def point_segment(p,u,v):
        dx=v[0]-u[0];dy=v[1]-u[1]
        t=max(0,min(1,((p[0]-u[0])*dx+(p[1]-u[1])*dy)/(dx*dx+dy*dy)))
        return math.hypot(p[0]-u[0]-t*dx,p[1]-u[1]-t*dy)
    def directed(polygon,other):return max(min(point_segment(p,other[i],other[(i+1)%len(other)]) for i in range(len(other))) for p in polygon)
    return max(directed(a,b),directed(b,a))

def target_equal(actual,expected):
    need(len(actual)==len(expected),'target count')
    for a,b in zip(actual,expected):
        need(a['t']==b['t'] and len(a['polygon'])==len(b['polygon']),'target coordinate count/time')
        need(all(abs(x-y)<=1e-12 for av,bv in zip(a['polygon'],b['polygon']) for x,y in zip(av,bv)),'independent normalized coordinates')

def receive_movie(movie_dir,out):
    receipt=json.loads((movie_dir/'receipt.json').read_text());movie=movie_dir/'performance.webm'
    need(receipt['status']=='complete' and receipt['frameCount']==96 and receipt['actualDurationSeconds']==4,'movie completion')
    need(receipt['videoSha256']==sha(movie) and receipt['sceneSha256']==sha(movie_dir/'scene.json'),'movie/scene identity')
    need(all(f['frame']==i and f['physicalTime']==i/95 and f['presentationTime']==i/24 for i,f in enumerate(receipt['frames'])) and len(receipt['frames'])==96,'movie source schedule')
    probe=command(['ffprobe','-v','error','-show_streams','-show_format','-of','json',movie],out,'movie-probe');need(probe['exit']==0,'movie probe')
    metadata=json.loads((out/'movie-probe.stdout').read_text());need(len(metadata['streams'])==1,'one movie stream');stream=metadata['streams'][0]
    need(stream['codec_name']=='vp9' and stream['width']==1000 and stream['height']==714,'codec/dimensions')
    a,b=map(int,stream['time_base'].split('/'));tick=a/b;need(0<tick<=.001,'time base');need(abs(float(metadata['format']['duration'])-4)<=tick+1e-9,'movie duration')
    args=['ffmpeg','-hide_banner','-nostdin','-loglevel','info','-threads','1','-filter_threads','1','-copyts','-i',str(movie),'-map','0:v:0','-vf','showinfo','-vsync','0','-pix_fmt','rgb24','-threads','1','-f','rawvideo','pipe:1']
    rows=[];selected={0,47,48,95};frame_bytes=1000*714*3
    write(out/'decode-command.json',dict(command=args,stdout='streamed RGB; every frame hash retained; four selected PNGs only'))
    with (out/'decode.stderr').open('wb') as stderr:
        p=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=stderr,start_new_session=True)
        expired=threading.Event()
        def expire():
            expired.set()
            try:os.killpg(p.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        timer=threading.Timer(60,expire);timer.daemon=True;timer.start()
        try:
            while True:
                remaining=frame_bytes;chunks=[]
                while remaining:
                    raw=p.stdout.read(remaining)
                    if not raw:break
                    chunks.append(raw);remaining-=len(raw)
                if not chunks:break
                need(remaining==0,'truncated RGB frame');pixels=b''.join(chunks);i=len(rows);need(i<96,'extra decoded frame')
                row=dict(frame=i,rgb_sha256=hashlib.sha256(pixels).hexdigest())
                if i in selected:
                    path=out/f'frame-{i:04d}.png';Image.frombytes('RGB',(1000,714),pixels).save(path);row.update(png=path.name,png_sha256=sha(path))
                rows.append(row)
            p.stdout.close();code=p.wait(timeout=30)
        finally:
            timer.cancel()
            if p.poll() is None:os.killpg(p.pid,signal.SIGKILL);p.wait()
            write(out/'decode-exec.json',dict(command=args,exit=p.returncode,timed_out=expired.is_set(),decoded_frames=len(rows),stdout_bytes=len(rows)*frame_bytes))
            write(out/'decoded-frames.json',rows)
    need(code==0 and len(rows)==96,'one complete96frame decode')
    timing=[]
    for line in (out/'decode.stderr').read_text().splitlines():
        m=re.search(r'\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:([^\s]+)',line)
        if m:timing.append(dict(frame=int(m[1]),pts=int(m[2]),seconds=float(m[3]),error_seconds=float(m[3])-int(m[1])/24))
    write(out/'decoded-timing.json',dict(tick_seconds=tick,frames=timing))
    need(len(timing)==96 and [r['frame'] for r in timing]==list(range(96)),'PTS coverage')
    need(all(math.isfinite(r['seconds']) and abs(r['error_seconds'])<=tick+1e-9 for r in timing) and all(b['seconds']>a['seconds'] for a,b in zip(timing,timing[1:])),'PTS cadence')
    sheet=Image.new('RGB',(1020,806),'#f5f3e8');draw=ImageDraw.Draw(sheet);font=ImageFont.load_default(size=18)
    for j,i in enumerate(sorted(selected)):
        x=10+(j%2)*510;y=10+(j//2)*398
        with Image.open(out/f'frame-{i:04d}.png') as image:sheet.paste(image.resize((500,357),Image.Resampling.LANCZOS),(x,y+30))
        draw.text((x+5,y+3),f'Frame {i} | PTS {timing[i]["seconds"]:.3f}s',fill='#283e32',font=font)
    sheet.save(out/'selected-frames.png')
    return dict(movie_sha256=sha(movie),decoded_frames=96,decode_processes=1,tick_seconds=tick,max_pts_error=max(abs(r['error_seconds']) for r in timing),selected_frames=sorted(selected),visual_inspection='pending')

def check_import(case,sequence,destination,expected,out,sources):
    receipt=json.loads((destination/'receipt.json').read_text());helper=json.loads((destination/'fitter.stdout').read_text())
    data=json.loads(sequence.read_text());project=json.loads((destination/'project.json').read_text());targets=json.loads((destination/'targets.json').read_text());report=json.loads((destination/'fit-report.json').read_text())
    need(receipt['status']=='complete' and receipt['fitInvoked'] is True and receipt['fitCalls']==1 and receipt['fitterExit']==0 and receipt['roundtrip'] is True and receipt['sourceUnchanged'] is True,'successful one-fit import/roundtrip')
    need(helper['roundtrip'] is True and helper['projectSha256']==sha(destination/'project.json')==receipt['projectSha256'],'actual helper parser roundtrip identity')
    need(receipt['sequenceSha256']==sha(sequence) and (destination/'inputs/sequence.json').read_bytes()==sequence.read_bytes(),'retained sequence identity')
    need(receipt['viewBox']==[0,0,400,300] and receipt['stageWidth']==3.2,'coordinate mapping metadata')
    need(len(receipt['inputs'])==len(data['moments']),'input manifest coverage')
    for item,moment in zip(receipt['inputs'],data['moments']):
        original=sequence.parent/moment['file'];retained=destination/item['retained']
        need(item['file']==moment['file'] and item['t']==moment['t'] and item['sha256']==sha(original)==sha(retained) and original.read_bytes()==retained.read_bytes(),'SVG input custody')
    need(set(receipt['sourceSha256'])=={'tools/import_svg.py','tools/fit_svg_targets.mjs','src/core.js','src/project.js','src/articulated.js'},'importer complete source identities')
    need(all(sources[k]==v for k,v in receipt['sourceSha256'].items()),'importer source bytes')
    need(project['format']=='shadow-stage/project-v1' and project['title']==data['title'] and project['duration']==data['duration'] and project['lightShare']==data['lightShare'] and project['construction']==dict(mode='single',maxPieces=1),'project metadata')
    target_equal(targets,expected);target_equal(project['targets'],expected)
    need(project['scene']['duration']==data['duration'],'scene duration')
    rows=[]
    for target in expected:
        projected=authored_projection(project['scene'],target['t'])
        rows.append(dict(t=target['t'],projected=projected,expected=target['polygon'],symmetric_vertex_boundary_distance=boundary_distance(projected,target['polygon'])))
    write(out/(case+'-independent-projection.json'),dict(rows=rows,producer_fit_report=report,metric='Symmetric maximum vertex-to-boundary distance; not producer sampled RMS.'))
    if case=='compatible':
        need(max(r['symmetric_vertex_boundary_distance'] for r in rows)<=1e-8,'compatible authored projection')
    else:
        need(math.isfinite(report['authoredKeyRms']) and report['authoredKeyRms']>1e-4,'incompatible residual must be retained')
        need(rows[-1]['symmetric_vertex_boundary_distance']>1e-4,'independent incompatible boundary mismatch')
    return dict(project_sha256=sha(destination/'project.json'),scene_sha256=receipt['sceneSha256'],fit_calls=receipt['fitCalls'],roundtrip=True,authoredKeyRms=report['authoredKeyRms'],max_independent_boundary_distance=max(r['symmetric_vertex_boundary_distance'] for r in rows))

def run(out):
    import shutil
    out.mkdir(parents=True,exist_ok=False)
    producer_paths=['tools/import_svg.py','tools/fit_svg_targets.mjs','tools/export_video.py','tools/project_frames.mjs','src/core.js','src/project.js','src/runtime.js','src/articulated.js']
    source_files=[ROOT/p for p in producer_paths]+[p for p in HERE.rglob('*') if p.is_file()]
    sources={str(p.relative_to(ROOT)):sha(p) for p in sorted(source_files)};write(out/'sources-before.json',sources)
    runtime=dict(python=sys.version,executable=sys.executable,python_sha256=sha(sys.executable),affinity=sorted(os.sched_getaffinity(0)),threads={k:os.environ.get(k) for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS')},tools={})
    for executable,flag in [('node','--version'),('ffmpeg','-version'),('ffprobe','-version')]:
        path=shutil.which(executable);need(path is not None,'required tool '+executable);runtime['tools'][executable]=dict(path=path,sha256=sha(path))
        result=command([path,flag],out,executable+'-version');need(result['exit']==0,'runtime version')
    write(out/'runtime.json',runtime)
    cases=[('compatible',HERE/'paper-kite/sequence.json',HERE/'paper-kite/expected.json'),('incompatible',HERE/'incompatible-sequence.json',HERE/'incompatible-expected.json')]
    imports={}
    for case,sequence,expected in cases:
        destination=out/(case+'-import');result=command([sys.executable,ROOT/'tools/import_svg.py',sequence,destination],out,case+'-import')
        need(result['exit']==0,'import failed '+case)
        imports[case]=check_import(case,sequence,destination,json.loads(expected.read_text())['targets'],out,sources)
        write(out/'import-summaries.json',imports)
    before=inventory(out/'compatible-import');write(out/'existing-output-before.json',before)
    result=command([sys.executable,ROOT/'tools/import_svg.py',HERE/'paper-kite/sequence.json',out/'compatible-import'],out,'refusal-existing')
    after=inventory(out/'compatible-import');write(out/'existing-output-after.json',after)
    need(result['exit']!=0 and 'Output already exists' in (out/'refusal-existing.stderr').read_text() and before==after,'existing-output preservation')
    refusals=[]
    for suffix,reason in [('curve','Unsupported SVG token or path command'),('transform','Unsupported shape attribute'),('multiple','exactly one polygon or path'),('comma','Malformed SVG comma separator.'),('unicode-digits','Unsupported SVG token or path command.')]:
        destination=out/('refused-'+suffix)
        result=command([sys.executable,ROOT/'tools/import_svg.py',HERE/('refusal-'+suffix+'.json'),destination],out,'refusal-'+suffix)
        need(result['exit']!=0 and not destination.exists(),'unsupported artwork refused')
        partials=list(out.glob('.refused-'+suffix+'.partial-*'));need(len(partials)==1,'refusal evidence directory')
        failure=json.loads((partials[0]/'failure.json').read_text());need(failure['status']=='failed' and failure['fitInvoked'] is False and reason in failure['error'],'specific pre-fit artwork refusal')
        need(not (partials[0]/'fitter.stdout').exists() and not (partials[0]/'project.json').exists(),'refusal did not reach helper')
        for item in failure['inputs']:need(sha(partials[0]/item['retained'])==item['sha256'],'refused input retained hash')
        refusals.append(dict(case=suffix,error=failure['error'],fitInvoked=False,partial_directory=partials[0].name))
        write(out/'unsupported-refusals.json',refusals)
    movie_dir=out/'movie';export=command([sys.executable,ROOT/'tools/export_video.py',out/'compatible-import/project.json',movie_dir],out,'export-compatible')
    need(export['exit']==0,'ordinary unchanged exporter accepted imported project')
    movie_receipt=json.loads((movie_dir/'receipt.json').read_text())
    need(movie_receipt['inputSha256']==imports['compatible']['project_sha256'] and movie_receipt['sceneSha256']==imports['compatible']['scene_sha256'],'import-to-export identity')
    need((movie_dir/'input-project.json').read_bytes()==(out/'compatible-import/project.json').read_bytes(),'ordinary consumer project bytes')
    need(json.loads((movie_dir/'scene.json').read_text())==json.loads((out/'compatible-import/project.json').read_text())['scene'],'export scene preservation')
    need(all(sources[k]==v for k,v in movie_receipt['sourceSha256'].items()) and movie_receipt['sourceUnchanged'] is True,'unchanged exporter sources')
    movie=receive_movie(movie_dir,out)
    after_sources={name:sha(ROOT/name) for name in sources};write(out/'sources-after.json',after_sources);need(after_sources==sources,'source/input bytes unchanged')
    result=dict(passed=True,successful_imports=2,fitScene_calls=2,fit_count_semantics='Fixed helper control flow and two successful receipts, not external dynamic tracing.',encode_processes=1,full_decode_processes=1,prefit_refusals=6,imports=imports,movie=movie,refusals=refusals,sources=sources,runtime=runtime,limits=['Finite importer capability receiving; no general SVG or artistic certification.','Prior exporter all-frame mask qualification was not repeated.','Four selected decoded PNGs await visual inspection.'])
    write(out/'result.json',result);return result

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    try:print(json.dumps(run(args.output),allow_nan=False))
    except BaseException as error:
        if args.output.exists():write(args.output/'receiving-failure.json',dict(type=type(error).__name__,error=str(error)))
        raise
