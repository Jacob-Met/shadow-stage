"""One prospective Paper Bloom creative import/export/decode; no prior course replay."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
COUNT, WIDTH, HEIGHT = 144, 1000, 714
SELECTED = {0, 43, 93, 143}
PRODUCERS = ("tools/import_svg.py", "tools/fit_svg_targets.mjs",
 "tools/export_video.py", "tools/project_frames.mjs", "src/core.js",
 "src/project.js", "src/runtime.js", "src/articulated.js")
AUTHORED = ("receiving.py", "expected.json", "README.md", "geometry.json",
 "sequence.json", "bud.svg", "flower.svg", "fold.svg", "return.svg")

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def read(path):
    return json.loads(Path(path).read_text())

def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False)+"\n")

def need(ok, message):
    if not ok:
        raise AssertionError(message)

def command(args, out, name, timeout, refusal=None):
    args = list(map(str, args))
    receipt = dict(command=args, timeout_seconds=timeout, phase="about_to_launch",
                   announcement_only=True)
    write(out/(name+"-exec.json"), receipt)
    start = time.monotonic()
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True)
    expired = False
    try:
        receipt.update(phase="started", announcement_only=False, pid=process.pid)
        write(out/(name+"-exec.json"), receipt)
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        expired = True
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        stdout, stderr = process.communicate()
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
    (out/(name+".stdout")).write_bytes(stdout)
    (out/(name+".stderr")).write_bytes(stderr)
    receipt.update(phase="returned", exit=process.returncode, timed_out=expired,
        wall_seconds=time.monotonic()-start, stdout_sha256=hashlib.sha256(stdout).hexdigest(),
        stderr_sha256=hashlib.sha256(stderr).hexdigest())
    write(out/(name+"-exec.json"), receipt)
    need(not expired, name+" timeout")
    if refusal is None:
        need(process.returncode == 0, name+" failed")
    else:
        need(process.returncode != 0 and refusal in stderr.decode("utf-8", "replace"),
             name+" expected refusal")
    return receipt

def project_key(scene, t):
    # Independent point-light projection; no maintained geometry imports.
    light = next(k for k in scene["light"]["keys"] if k["t"] == t) if len(scene["light"]["keys"]) != 1 else scene["light"]["keys"][0]
    pieces = scene["occluders"] if scene["format"] == "shadow-stage/articulated-v1" else [scene["occluder"]]
    polygons = []
    for piece in pieces:
        pose = next(k for k in piece["keys"] if k["t"] == t)
        need(0 < pose["z"] < light["z"]-.049999, "positive physical clearance")
        m = light["z"]/(light["z"]-pose["z"])
        c, s = math.cos(pose["angle"]), math.sin(pose["angle"])
        polygon = [[light["x"]+m*(pose["x"]+c*x-s*y-light["x"]),
                    light["y"]+m*(pose["y"]+s*x+c*y-light["y"])]
                   for x,y in piece["vertices"]]
        need(all(math.isfinite(v) for p in polygon for v in p), "finite projected vertices")
        polygons.append(polygon)
    return polygons

def inside(x, y, polygon):
    answer = False
    previous = polygon[-1]
    for current in polygon:
        if (current[1] > y) != (previous[1] > y):
            crossing = current[0] + (previous[0]-current[0])*(y-current[1])/(previous[1]-current[1])
            if x < crossing:
                answer = not answer
        previous = current
    return answer

def observe(polygons):
    # Fixed square-cell observation grid, independent of producer cover/report.
    need(all(-1.6 <= x <= 1.6 and -1.2 <= y <= 1.2 for p in polygons for x,y in p),
         "observation window must contain projected geometry")
    return bytes(any(inside(-1.6+(x+.5)*.0125, -1.2+(y+.5)*.0125, p) for p in polygons)
                 for y in range(192) for x in range(256))

def score(prediction, target):
    xor = sum(a != b for a,b in zip(prediction,target))
    union = sum(bool(a or b) for a,b in zip(prediction,target))
    need(union > 0, "resolved nonempty union")
    return dict(xor=xor, union=union, target_occupied=sum(target),
                predicted_occupied=sum(prediction), error=xor/union)

def vertices_error(actual, expected):
    need(len(actual) == len(expected), "corresponding vertex count")
    errors = [math.hypot(a[0]-b[0],a[1]-b[1]) for a,b in zip(actual,expected)]
    need(all(math.isfinite(v) for v in errors), "finite vertex comparison")
    return max(errors)

def decode(movie, out, ffmpeg, tick):
    args = [ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "info",
            "-threads", "1", "-filter_threads", "1", "-copyts", "-i", str(movie),
            "-map", "0:v:0", "-vf", "showinfo", "-vsync", "0", "-pix_fmt", "rgb24",
            "-threads", "1", "-f", "rawvideo", "pipe:1"]
    write(out / "decode-command.json", dict(command=args, timeout_seconds=60,
          stdout="RGB24 streamed once; per-frame hashes, four PNGs and four ordered contact sheets retained; raw movie frames not retained"))
    rows, sheets = [], []
    frame_bytes = WIDTH * HEIGHT * 3
    expired = threading.Event()
    sheet = None
    started = time.monotonic()
    with (out / "decode.stderr").open("wb") as stderr:
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=stderr,
                                   start_new_session=True)
        def expire():
            expired.set()
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        timer = threading.Timer(60, expire)
        timer.daemon = True
        timer.start()
        try:
            while True:
                parts, remaining = [], frame_bytes
                while remaining:
                    part = process.stdout.read(remaining)
                    if not part:
                        break
                    parts.append(part)
                    remaining -= len(part)
                if not parts:
                    break
                need(remaining == 0, "truncated decoded RGB frame")
                i = len(rows)
                need(i < COUNT, "extra decoded frame")
                pixels = b"".join(parts)
                image = Image.frombytes("RGB", (WIDTH, HEIGHT), pixels)
                # Fixed pre-result threshold; dark cutout against pale background.
                mask = image.convert("L").point([255 if v < 128 else 0 for v in range(256)])
                bbox = mask.getbbox()
                foreground = mask.histogram()[255]
                inside = bbox is not None and bbox[0] >= 1 and bbox[1] >= 1 and bbox[2] <= 999 and bbox[3] <= 713
                row = dict(frame=i, rgb_sha256=hashlib.sha256(pixels).hexdigest(),
                           foreground_pixels=foreground, foreground_bbox=bbox,
                           nonempty=foreground > 0, foreground_off_edge=inside)
                if i in SELECTED:
                    path = out / ("frame-%04d.png" % i)
                    image.save(path)
                    row.update(png=path.name, png_sha256=sha(path))
                rows.append(row)
                if i % 36 == 0:
                    sheet = Image.new("RGB", (1500, 1200), "#f5f3e8")
                tile = image.resize((250, 179), Image.Resampling.LANCZOS)
                local = i % 36
                x, y = (local % 6) * 250, (local // 6) * 200
                sheet.paste(tile, (x, y + 20))
                ImageDraw.Draw(sheet).text((x + 4, y + 3), "Frame %03d | nominal %.3fs" % (i, i/24), fill="#283e32")
                if local == 35:
                    path = out / ("contact-%03d-%03d.png" % (i-35, i))
                    sheet.save(path)
                    sheets.append(dict(file=path.name, first_frame=i-35, last_frame=i, sha256=sha(path)))
                    sheet = None
                image.close()
                mask.close()
                tile.close()
            process.stdout.close()
            process.wait(timeout=5)
        finally:
            timer.cancel()
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            if process.stdout is not None:
                process.stdout.close()
            if sheet is not None and rows:
                path = out / "contact-partial.png"
                sheet.save(path)
                sheets.append(dict(file=path.name, partial=True, sha256=sha(path)))
            write(out / "decoded-frames.json", rows)
            write(out / "contact-sheets.json", sheets)
            write(out / "decode-exec.json", dict(command=args, exit=process.returncode,
                  timed_out=expired.is_set(), decoded_frames=len(rows),
                  complete_frame_stdout_bytes=len(rows)*frame_bytes,
                  wall_seconds=time.monotonic()-started,
                  stderr_sha256=sha(out / "decode.stderr")))
    timing = []
    for line in (out / "decode.stderr").read_text().splitlines():
        match = re.search(r"\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:([^\s]+)", line)
        if match:
            frame, pts, seconds = int(match[1]), int(match[2]), float(match[3])
            timing.append(dict(frame=frame, pts=pts, seconds=seconds,
                               error_seconds=seconds-frame/24))
    write(out / "decoded-timing.json", dict(tick_seconds=tick, frames=timing))
    need(not expired.is_set() and process.returncode == 0 and len(rows) == COUNT, "one complete decode")
    need(len(timing) == COUNT and [x["frame"] for x in timing] == list(range(COUNT)), "all frame timestamps")
    need(all(math.isfinite(x["seconds"]) and abs(x["error_seconds"]) <= .001 for x in timing), "PTS within one millisecond")
    need(all(a["seconds"] < b["seconds"] for a, b in zip(timing, timing[1:])), "strict PTS order")
    need(all(x["nonempty"] and x["foreground_off_edge"] for x in rows), "all frames nonempty with no dark foreground on image edges")
    need(len(sheets) == 4 and all(not x.get("partial") for x in sheets), "four complete ordered contact sheets")
    return dict(decoded_frames=len(rows), max_pts_error=max(abs(x["error_seconds"]) for x in timing),
                foreground_min_pixels=min(x["foreground_pixels"] for x in rows),
                contact_sheets=sheets, selected_frames=sorted(SELECTED), visual_review="pending")



def run(out):
    out=out.resolve()
    need(not out.is_relative_to(HERE), 'output outside frozen authored source')
    out.mkdir(exist_ok=False)
    sources={name:sha(ROOT/name) for name in PRODUCERS}
    sources.update({str((HERE/name).relative_to(ROOT)):sha(HERE/name) for name in AUTHORED})
    write(out/'sources-before.json',sources)
    result=dict(passed=False,status='started',successful_imports=0)
    write(out/'result.json',result)
    try:
        tools={name:shutil.which(name) for name in ('node','ffmpeg','ffprobe')}
        need(all(tools.values()),'installed dependencies')
        write(out/'runtime.json',dict(python=sys.version,executable=sys.executable,
            python_sha256=sha(sys.executable),pillow=PILLOW_VERSION,
            affinity=sorted(os.sched_getaffinity(0)),
            thread_environment={k:os.environ.get(k) for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS')},
            executables={k:dict(path=v,sha256=sha(v)) for k,v in tools.items()}))
        expected=read(HERE/'expected.json')['targets']
        sequence=read(HERE/'sequence.json')
        need([x['t'] for x in expected]==[0,.3,.65,1],'fixed four expected moments')
        folder=out/'imported'
        command([sys.executable,ROOT/'tools/import_svg.py',HERE/'sequence.json',folder,
                 '--construction','pieces','--max-pieces','24'],out,'import',90)
        receipt=read(folder/'receipt.json');helper=read(folder/'fitter.stdout')
        project=read(folder/'project.json');targets=read(folder/'targets.json');scene=project['scene']
        construction=dict(mode='pieces',maxPieces=24)
        options=dict(maxPieces=24,resolution=32,duration=6,coverageTolerance=.01)
        need(receipt['status']=='complete' and receipt['fitterExit']==0 and receipt['fitInvoked'] is True,'import completion')
        for obj in (receipt,helper):
            need(obj['fitCalls']==1 and obj['fitEngine']=='fitArticulated' and
                 obj['fitOptions']==options and obj['construction']==construction and obj['roundtrip'] is True,'selected engine receipt')
        need(receipt['requestedConstruction']==construction and project['construction']==construction,'construction retained')
        need(project['lightShare']==0 and project['duration']==scene['duration']==6,'duration/share')
        need(receipt['projectSha256']==helper['projectSha256']==sha(folder/'project.json'),'project identity')
        need(receipt['sceneSha256']==helper['sceneSha256'],'helper scene identity')
        need(receipt['sourceUnchanged'] and all(sources[k]==v for k,v in receipt['sourceSha256'].items()),'import source identity')
        need(helper['sourceSha256']=={k:v for k,v in receipt['sourceSha256'].items() if k!='tools/import_svg.py'},'helper source set')
        need(receipt['sequenceSha256']==sha(HERE/'sequence.json')==sha(folder/'inputs/sequence.json'),'sequence identity')
        need(len(receipt['inputs'])==4,'four retained SVGs')
        for item,moment in zip(receipt['inputs'],sequence['moments']):
            need(item['file']==moment['file'] and item['t']==moment['t'] and item['sha256']==sha(HERE/moment['file'])==sha(folder/item['retained']),'input custody')
        need(len(targets)==len(project['targets'])==4,'four saved targets')
        target_checks=[]
        for a,b,want in zip(targets,project['targets'],expected):
            need(a['t']==b['t']==want['t'],'authored times')
            target_checks.append(dict(t=a['t'],mapped_error=vertices_error(a['polygon'],want['polygon']),project_error=vertices_error(b['polygon'],want['polygon'])))
        write(out/'target-checks.json',target_checks)
        need(all(x['mapped_error']<=1e-12 and x['project_error']<=1e-12 for x in target_checks),'normalized target agreement')
        need(scene['format']=='shadow-stage/articulated-v1','articulated scene')
        ids=[x['id'] for x in scene['occluders']]
        need(1<len(ids)<=24 and len(set(ids))==len(ids),'distinct bounded pieces')
        need(all(len(x['vertices'])==4 and [k['t'] for k in x['keys']]==[0,.3,.65,1] for x in scene['occluders']),'persistent square/key structure')
        need(scene['light']['keys']==[dict(t=0,x=0,y=0,z=5)],'fixed light')
        result['successful_imports']=1;write(out/'result.json',result)
        rows=[]
        for i,target in enumerate(expected):
            polygons=project_key(scene,target['t'])
            actual=observe(polygons);wanted=observe([target['polygon']])
            af=out/('predicted-mask-%d.bin'%i);tf=out/('target-mask-%d.bin'%i)
            af.write_bytes(actual);tf.write_bytes(wanted)
            rows.append(dict(t=target['t'],polygons=polygons,target_polygon=target['polygon'],
                **score(actual,wanted),prediction_mask_sha256=sha(af),target_mask_sha256=sha(tf)))
        mean=sum(x['error'] for x in rows)/4
        masks=dict(window=[-1.6,1.6,-1.2,1.2],grid=[256,192],cell_side=.0125,
            boundary_rule='Cell centers; half-open y and strict x crossing; Boolean union.',
            rows=rows,mean_error=mean,maximum_error=max(x['error'] for x in rows),
            criteria=dict(per_authored_maximum=.08,mean_maximum=.05))
        write(out/'authored-masks.json',masks)
        # Complete the ordinary movie before applying artistic-consumer quality gates.
        movie=out/'movie'
        command([sys.executable,ROOT/'tools/export_video.py',folder/'project.json',movie],out,'export',120)
        video=read(movie/'receipt.json')
        need(video['status']=='complete' and video['encoder']['exit']==video['projectionExit']==video['probe']['exit']==0,'export completion')
        need(video['frameCount']==144 and video['actualDurationSeconds']==video['requestedDurationSeconds']==6 and video['durationRoundingSeconds']==0,'six-second schedule')
        need(video['videoSha256']==sha(movie/'performance.webm'),'movie identity')
        need(video['inputSha256']==receipt['projectSha256']==sha(movie/'input-project.json'),'consumer project identity')
        need(video['sceneSha256']==receipt['sceneSha256']==sha(movie/'scene.json') and read(movie/'scene.json')==scene,'consumer scene identity')
        need(video['sourceUnchanged'] and all(sources[k]==v for k,v in video['sourceSha256'].items()),'export source identity')
        frames=video['frames']
        need(len(frames)==144 and all(f['frame']==i and f['physicalTime']==i/143 and f['presentationTime']==i/24 for i,f in enumerate(frames)),'frame schedule')
        probe=video['probe']['info'];need(len(probe['streams'])==1,'one video stream');stream=probe['streams'][0]
        need(stream['codec_name']=='vp9' and stream['width']==WIDTH and stream['height']==HEIGHT,'codec/dimensions')
        a,b=map(int,stream['time_base'].split('/'));tick=a/b
        need(0<tick<=.001 and abs(float(probe['format']['duration'])-6)<=.001,'time base/duration')
        data=[json.loads(x) for x in (movie/'projected-frames.jsonl').read_text().splitlines()]
        need(len(data)==145 and data[0]['sceneSha256']==receipt['sceneSha256'],'projection identity')
        bounds=[]
        for i,row in enumerate(data[1:]):
            need(row['frame']==i and row['physicalTime']==i/143 and row['presentationTime']==i/24,'projection schedule')
            need(len(row['polygons'])==len(ids) and all(len(p)==4 for p in row['polygons']),'piece persistence in frames')
            pixels=[[500+260*x,350-260*y] for p in row['polygons'] for x,y in p]
            bounds.append(dict(frame=i,inside=all(math.isfinite(x) and math.isfinite(y) and 1<=x<=998 and 1<=y<=712 for x,y in pixels)))
        write(out/'geometry-bounds.json',bounds)
        need(all(x['inside'] for x in bounds),'sampled geometry framing')
        decoded=decode(movie/'performance.webm',out,tools['ffmpeg'],tick)
        need(all(x['error']<=.08 for x in rows) and mean<=.05,'prechosen authored mask criteria')
        after={name:sha(ROOT/name) for name in sources};write(out/'sources-after.json',after)
        need(after==sources,'source unchanged before pass')
        result.update(passed=True,status='completed',helper_fit_calls=1,encode_processes=1,full_decode_processes=1,
            expected_refusals=0,old_fit_replays=0,fit_count_semantics='Fixed selected helper control flow and successful receipt, not dynamic tracing.',
            authored_masks=masks,piece_count=len(ids),decode=decoded,project_sha256=receipt['projectSha256'],
            scene_sha256=receipt['sceneSha256'],movie_sha256=video['videoSha256'],
            native_fit_report=read(folder/'fit-report.json'),limitations=[
                'Finite authored-mask observations, not exact or continuous silhouette fidelity.',
                'Intermediate target equality and seamless looping are not asserted.',
                'No collision clearance, fabrication, performance or browser-pixel claim.',
                'Visual review pending; full decoded RGB not retained.'])
        write(out/'result.json',result)
        return result
    except BaseException as error:
        result.update(passed=False,status='failed',error=dict(type=type(error).__name__,message=str(error)))
        write(out/'result.json',result);raise
    finally:
        try:
            after={name:sha(ROOT/name) for name in sources};write(out/'sources-after.json',after)
            need(after==sources,'final source identity')
        except BaseException as error:
            result.update(passed=False,status='failed',final_identity_error=dict(type=type(error).__name__,message=str(error)))
            write(out/'result.json',result);raise

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(run(args.output),allow_nan=False))
