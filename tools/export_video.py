#!/usr/bin/env python3
"""Export a saved physical scene to a fixed-frame WebM, without a browser."""
import argparse
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import threading
from PIL import Image, ImageDraw, __version__ as pillow_version

ROOT=Path(__file__).resolve().parent.parent
WIDTH,HEIGHT,FPS,SCALE=1000,714,24,2

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def write(path,value):
    path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')

def publish(stage,destination):
    # Linux renameat2 avoids replacing even an empty directory created concurrently.
    libc=ctypes.CDLL(None,use_errno=True)
    rename=getattr(libc,'renameat2',None)
    if rename is None:raise RuntimeError('Atomic no-replace publication requires renameat2 on this platform; completed temporary bundle retained.')
    rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
    rename.restype=ctypes.c_int
    if rename(-100,os.fsencode(stage),-100,os.fsencode(destination),1)!=0:
        number=ctypes.get_errno();raise OSError(number,os.strerror(number),str(destination))

def export(input_path,destination):
    input_path=input_path.resolve();destination=destination.absolute()
    if os.path.lexists(destination):raise ValueError('Output already exists; choose a new output directory.')
    if not destination.parent.is_dir():raise ValueError('Output parent directory must exist.')
    node=shutil.which('node');ffmpeg=shutil.which('ffmpeg');ffprobe=shutil.which('ffprobe')
    if not all((node,ffmpeg,ffprobe)):raise ValueError('Installations of Node, FFmpeg and ffprobe are required; no tools are installed automatically.')
    with input_path.open('rb') as stream:raw=stream.read(2*1024*1024+1)
    if len(raw)>2*1024*1024:raise ValueError('Project exceeds 2 MiB size limit.')
    stage=Path(tempfile.mkdtemp(prefix='.'+destination.name+'.partial-',dir=destination.parent))
    processes=[];started=time.monotonic();receipt={'status':'preparing','output':str(destination),'temporaryDirectory':str(stage)}
    expired=threading.Event()
    def check_deadline():
        if expired.is_set() or time.monotonic()-started>=600:raise TimeoutError('Offline export exceeded its 600-second deadline.')
    def launch(command,**options):
        check_deadline()
        process=subprocess.Popen(command,**options);processes.append(process)
        if expired.is_set():
            process.kill();raise TimeoutError('Offline export exceeded its 600-second deadline.')
        return process
    def expire():
        expired.set()
        for process in processes:
            if process.poll() is None:process.kill()
    deadline=threading.Timer(600,expire);deadline.daemon=True;deadline.start()
    try:
        (stage/'input-project.json').write_bytes(raw)
        receipt['runtime']={'python':sys.version,'pillow':pillow_version,'executables':{k:{'path':v,'sha256':sha(v)} for k,v in [('node',node),('ffmpeg',ffmpeg),('ffprobe',ffprobe)]}}
        with (stage/'projection.stderr').open('wb') as errors,(stage/'projected-frames.jsonl').open('wb') as geometry:
            helper=launch([node,str(ROOT/'tools/project_frames.mjs'),str(stage/'input-project.json')],stdout=subprocess.PIPE,stderr=errors)
            def line():
                data=helper.stdout.readline(4*1024*1024+1)
                if not data or len(data)>4*1024*1024:raise ValueError('Projection helper returned missing or oversized record.')
                geometry.write(data);return json.loads(data)
            header=line()
            if header.get('type')!='header':raise ValueError('Missing projection header.')
            receipt.update({k:v for k,v in header.items() if k not in ('type','scene','sceneJson')})
            if receipt['inputSha256']!=hashlib.sha256(raw).hexdigest():raise ValueError('Projection input identity mismatch.')
            receipt['sourceSha256']['tools/export_video.py']=sha(__file__)
            (stage/'scene.json').write_bytes(header['sceneJson'].encode('utf-8'))
            if sha(stage/'scene.json')!=header['sceneSha256']:raise ValueError('Scene identity mismatch.')
            movie=stage/'performance.webm'
            command=[ffmpeg,'-hide_banner','-nostdin','-n','-f','rawvideo','-pixel_format','rgb24','-video_size','1000x714','-framerate','24','-i','pipe:0','-an','-c:v','libvpx-vp9','-lossless','1','-pix_fmt','yuv444p','-threads','1','-filter_threads','1','-row-mt','0','-deadline','good','-cpu-used','4','-frames:v',str(header['frameCount']),str(movie)]
            receipt['encoder']={'command':command}
            receipt['profile']={'supersampling':2,'downsample':'Pillow LANCZOS','background':'#e7ebd7','foreground':'#283e32','camera':[500,260,350,260],'codec':'libvpx-vp9','lossless':True,'pixelFormat':'yuv444p','threads':1,'deadline':'good','cpuUsed':4}
            receipt['frames']=[]
            with (stage/'encoder.stderr').open('wb') as log:
                encoder=launch(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=log)
                for i in range(header['frameCount']):
                    frame=line()
                    if frame.get('type')!='frame' or frame['frame']!=i:raise ValueError('Projection sequence mismatch.')
                    image=Image.new('RGB',(WIDTH*SCALE,HEIGHT*SCALE),'#e7ebd7');draw=ImageDraw.Draw(image)
                    for polygon in frame['polygons']:
                        points=[((500+260*x)*SCALE,(350-260*y)*SCALE) for x,y in polygon]
                        if not all(math.isfinite(v) for point in points for v in point):raise ValueError('Nonfinite projected coordinate.')
                        draw.polygon(points,fill='#283e32')
                    image=image.resize((WIDTH,HEIGHT),Image.Resampling.LANCZOS)
                    pixels=image.tobytes()
                    receipt['frames'].append({k:frame[k] for k in ('frame','physicalTime','presentationTime')}|{'rgbSha256':hashlib.sha256(pixels).hexdigest()})
                    if i in {0,header['frameCount']//2,header['frameCount']-1}:image.save(stage/f'preview-{i:04d}.png')
                    encoder.stdin.write(pixels)
                encoder.stdin.close()
                receipt['encoder']['exit']=encoder.wait(timeout=120)
                if receipt['encoder']['exit']!=0:raise RuntimeError('FFmpeg encoding failed; see encoder.stderr.')
            if helper.stdout.read(1):raise ValueError('Projection helper produced extra records.')
            helper.stdout.close();receipt['projectionExit']=helper.wait(timeout=10)
            if helper.returncode:raise RuntimeError('Projection helper failed; see projection.stderr.')
        probe_command=[ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(movie)]
        probe=launch(probe_command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        probe_stdout,probe_stderr=probe.communicate(timeout=30)
        (stage/'ffprobe.stdout').write_bytes(probe_stdout);(stage/'ffprobe.stderr').write_bytes(probe_stderr)
        receipt['probe']={'command':probe_command,'exit':probe.returncode}
        if probe.returncode:raise RuntimeError('ffprobe failed.')
        receipt['probe']['info']=json.loads(probe_stdout)
        after={name:sha(ROOT/name) for name in receipt['sourceSha256']}
        receipt['sourceUnchanged']=after==receipt['sourceSha256']
        if not receipt['sourceUnchanged']:raise RuntimeError('Exporter source changed during execution.')
        receipt['videoSha256']=sha(movie);receipt['videoBytes']=movie.stat().st_size
        receipt['elapsedSeconds']=time.monotonic()-started
        receipt['limitations']=['Lossless YUV encoding is not exact RGB preservation or browser-pixel equivalence.','Fixed nominal 24 fps with N/24 duration; requested duration is rounded to a frame count.','No collision, fabrication or artistic-quality certification.']
        receipt['status']='complete';write(stage/'receipt.json',receipt)
        check_deadline()
        publish(stage,destination)
        return destination
    except BaseException as error:
        for process in processes:
            if process.poll() is None:process.terminate()
        for process in processes:
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait()
        receipt.update(status='failed',error=str(error),elapsedSeconds=time.monotonic()-started,processExits=[p.returncode for p in processes])
        if (stage/'receipt.json').exists():
            (stage/'receipt.json').rename(stage/'prepublication-receipt.json')
        write(stage/'receipt.json',receipt)
        write(stage/'failure.json',receipt)
        print('Export failed; incomplete evidence retained at '+str(stage),file=sys.stderr)
        raise
    finally:
        deadline.cancel()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args()
    try:print(export(args.project,args.output))
    except Exception as error:print(str(error),file=sys.stderr);return 1
    return 0

if __name__=='__main__':raise SystemExit(main())
