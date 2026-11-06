"""Prospective SVG pieces integration: two new fits, three pre-fit refusals,
one 96-frame export/decode. Original single baseline is read-only saved data.
No old receiver, fitter, or regression suite is invoked.
"""
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
COUNT, WIDTH, HEIGHT = 96, 1000, 714
SELECTED = {0, 47, 48, 95}
BASELINE_SHA = "cc603666e269ad6b5bd94d4e6bce58f8f7cdcd5ee87f28c8a1009dd7b7cbcdb7"
PRODUCERS = ("tools/import_svg.py", "tools/fit_svg_targets.mjs",
 "tools/export_video.py", "tools/project_frames.mjs", "src/core.js",
 "src/project.js", "src/runtime.js", "src/articulated.js")
AUTHORED = ("receiver.py", "expected.json", "default-start.svg", "default-end.svg",
 "default-sequence.json", "pieces-sequence.json", "square.svg", "triangle.svg")

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

def import_checks(folder, expected, sources, mode):
    receipt, helper = read(folder/"receipt.json"), read(folder/"fitter.stdout")
    project, targets = read(folder/"project.json"), read(folder/"targets.json")
    options = (dict(duration=1,lightShare=.65) if mode=="single" else
               dict(maxPieces=24,resolution=32,duration=4,coverageTolerance=.01))
    construction = dict(mode=mode,maxPieces=1 if mode=="single" else 24)
    engine = "fitScene" if mode=="single" else "fitArticulated"
    need(receipt["status"]=="complete" and receipt["fitterExit"]==0 and
         receipt["fitInvoked"] is True and receipt["fitCalls"]==helper["fitCalls"]==1,
         "one successful selected fit")
    for obj in (receipt,helper):
        need(obj["fitEngine"]==engine and obj["fitOptions"]==options and
             obj["construction"]==construction and obj["roundtrip"] is True,
             "mode-specific helper evidence")
    need(receipt["requestedConstruction"]==construction, "requested mode evidence")
    need(receipt["projectSha256"]==helper["projectSha256"]==sha(folder/"project.json"),
         "project identity")
    need(receipt["sourceUnchanged"] is True and all(sources[k]==v for k,v in receipt["sourceSha256"].items()),
         "import source identity")
    need(project["construction"]==construction and project["lightShare"]==(.65 if mode=="single" else 0),
         "saved construction and actual light setting")
    need(project["duration"]==project["scene"]["duration"]==options["duration"],"duration preserved")
    need(project["scene"]["format"]==("shadow-stage/scene-v1" if mode=="single" else "shadow-stage/articulated-v1"),
         "mode-specific physical scene")
    need(len(targets)==len(project["targets"])==len(expected)==2,"two targets")
    for a,b,want in zip(targets,project["targets"],expected):
        need(a["t"]==b["t"]==want["t"],"target times")
        need(vertices_error(a["polygon"],want["polygon"])<=1e-12 and
             vertices_error(b["polygon"],want["polygon"])<=1e-12,"normalized target identity")
    admitted=read(folder/"admitted.json")
    need(("construction" not in admitted) if mode=="single" else admitted["construction"]==construction,
         "legacy omission or explicit pieces admission")
    sequence_name="default-sequence.json" if mode=="single" else "pieces-sequence.json"
    need(receipt["sequenceSha256"]==sha(HERE/sequence_name)==sha(folder/"inputs/sequence.json"),
         "sequence retained byte identity")
    sequence=read(HERE/sequence_name)
    need(len(receipt["inputs"])==2,"two input SVG receipts")
    for item,moment in zip(receipt["inputs"],sequence["moments"]):
        need(item["file"]==moment["file"] and item["t"]==moment["t"] and
             item["sha256"]==sha(HERE/moment["file"])==sha(folder/item["retained"]),
             "original SVG custody")
    return project,receipt

def decode(movie, out, ffmpeg, tick):
    args = [ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "info",
            "-threads", "1", "-filter_threads", "1", "-copyts", "-i", str(movie),
            "-map", "0:v:0", "-vf", "showinfo", "-vsync", "0", "-pix_fmt", "rgb24",
            "-threads", "1", "-f", "rawvideo", "pipe:1"]
    write(out / "decode-command.json", dict(command=args, timeout_seconds=45,
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
        timer = threading.Timer(45, expire)
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
                if i % 24 == 0:
                    sheet = Image.new("RGB", (1500, 800), "#f5f3e8")
                tile = image.resize((250, 179), Image.Resampling.LANCZOS)
                local = i % 24
                x, y = (local % 6) * 250, (local // 6) * 200
                sheet.paste(tile, (x, y + 20))
                ImageDraw.Draw(sheet).text((x + 4, y + 3), "Frame %03d | nominal %.3fs" % (i, i/24), fill="#283e32")
                if local == 23:
                    path = out / ("contact-%03d-%03d.png" % (i-23, i))
                    sheet.save(path)
                    sheets.append(dict(file=path.name, first_frame=i-23, last_frame=i, sha256=sha(path)))
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



def run(out, baseline):
    out=out.resolve()
    need(not out.is_relative_to(HERE),"output outside frozen fixtures")
    need(sha(baseline)==BASELINE_SHA,"original saved baseline identity")
    out.mkdir(exist_ok=False)
    sources={name:sha(ROOT/name) for name in PRODUCERS}
    sources.update({str((HERE/name).relative_to(ROOT)):sha(HERE/name) for name in AUTHORED})
    write(out/"sources-before.json",sources)
    (out/"original-single-project.json").write_bytes(baseline.read_bytes())
    tools={name:shutil.which(name) for name in ("node","ffmpeg","ffprobe")}
    need(all(tools.values()),"installed tool dependencies")
    write(out/"runtime.json",dict(python=sys.version,executable=sys.executable,
        python_sha256=sha(sys.executable),pillow=PILLOW_VERSION,
        affinity=sorted(os.sched_getaffinity(0)),
        thread_environment={k:os.environ.get(k) for k in ("OMP_NUM_THREADS","OPENBLAS_NUM_THREADS","MKL_NUM_THREADS")},
        executables={k:dict(path=v,sha256=sha(v)) for k,v in tools.items()}))
    result=dict(passed=False,status="started",successful_imports=0,expected_refusals=0)
    write(out/"result.json",result)
    try:
        expected=read(HERE/"expected.json")
        old=read(baseline)
        need(old["targets"]==expected["pieces"] and old["lightShare"]==.65,
             "saved baseline target/setting identity")
        refusals=[
          ("single-budget","default-sequence.json",["--max-pieces","2"],
           "--max-pieces requires --construction pieces.",False),
          ("oversized-budget","pieces-sequence.json",["--construction","pieces","--max-pieces","25"],
           "Pieces construction requires an integer --max-pieces from 1 through 24.",False),
          ("nonzero-share","default-sequence.json",["--construction","pieces"],
           "Pieces construction requires lightShare=0 because the maintained engine uses a fixed light.",True)]
        refusal_rows=[]
        for name,sequence,flags,message,partial_expected in refusals:
            destination=out/("refused-"+name)
            receipt=command([sys.executable,ROOT/"tools/import_svg.py",HERE/sequence,destination,*flags],
                            out,name,10,refusal=message)
            partials=list(out.glob("."+destination.name+".partial-*"))
            need(not destination.exists(),"refusal not published")
            need(len(partials)==int(partial_expected),"expected pre-fit refusal stage")
            row=dict(name=name,exec=receipt,partials=[p.name for p in partials],
                     fit_count_basis="Fixed admission control flow plus absence of helper artifacts; not dynamic tracing.")
            if partials:
                p=partials[0]
                failed=read(p/"failure.json")
                row["failure"]=failed
                need(failed["fitInvoked"] is False and failed["status"]=="failed","pre-fit refusal receipt")
                need(sha(p/"inputs/sequence.json")==sha(HERE/sequence),"refused raw sequence retained")
                need(not any((p/f).exists() for f in ["fitter.stdout","fitter.stderr","project.json","targets.json"]),
                     "no helper or mapped targets for share refusal")
            refusal_rows.append(row)
            write(out/"refusals.json",refusal_rows)
            result["expected_refusals"]+=1
            write(out/"result.json",result)
        single_folder=out/"default-single"
        command([sys.executable,ROOT/"tools/import_svg.py",HERE/"default-sequence.json",single_folder],
                out,"default-import",30)
        single,single_receipt=import_checks(single_folder,expected["default"],sources,"single")
        default_rows=[]
        for want in expected["default"]:
            projected=project_key(single["scene"],want["t"])[0]
            default_rows.append(dict(t=want["t"],projected=projected,
                maximum_corresponding_vertex_error=vertices_error(projected,want["polygon"])))
        write(out/"default-projection.json",default_rows)
        need(all(r["maximum_corresponding_vertex_error"]<=1e-8 for r in default_rows),"default single geometry")
        result["successful_imports"]=1
        write(out/"result.json",result)
        pieces_folder=out/"pieces"
        command([sys.executable,ROOT/"tools/import_svg.py",HERE/"pieces-sequence.json",pieces_folder,
                 "--construction","pieces","--max-pieces","24"],out,"pieces-import",60)
        pieces,pieces_receipt=import_checks(pieces_folder,expected["pieces"],sources,"pieces")
        scene=pieces["scene"]
        ids=[p["id"] for p in scene["occluders"]]
        need(1 < len(ids) <=24 and len(set(ids))==len(ids),"bounded distinct persistent pieces")
        need(all(len(p["vertices"])==4 and [k["t"] for k in p["keys"]]==[0,1] for p in scene["occluders"]),
             "persistent square geometry and authored key times")
        need(scene["light"]["keys"]==[dict(t=0,x=0,y=0,z=5)],"fixed articulated light")
        result["successful_imports"]=2
        write(out/"result.json",result)
        comparison=[]
        for i,target in enumerate(expected["pieces"]):
            target_mask=observe([target["polygon"]])
            (out/("target-mask-%d.bin"%i)).write_bytes(target_mask)
            row=dict(t=target["t"])
            for label,project in [("original_single",old),("pieces",pieces)]:
                polygons=project_key(project["scene"],target["t"])
                prediction=observe(polygons)
                path=out/("%s-mask-%d.bin"%(label,i));path.write_bytes(prediction)
                row[label]=dict(**score(prediction,target_mask),polygons=polygons,mask_sha256=sha(path))
            comparison.append(row)
        old_mean=sum(r["original_single"]["error"] for r in comparison)/2
        pieces_mean=sum(r["pieces"]["error"] for r in comparison)/2
        comparison_record=dict(window=[-1.6,1.6,-1.2,1.2],grid=[256,192],sample="cell centers",
            boundary_rule="Half-open y crossings and strict x<edge intersection; identical rule for all masks.",
            rows=comparison,original_mean=old_mean,pieces_mean=pieces_mean,improvement=old_mean-pieces_mean,
            old_light_share=.65,new_light_share=0,
            interpretation="Whole construction comparison, not isolated causal piece-count effect; no RMS comparison.",
            complexity=dict(original_pieces=1,original_vertices=len(old["scene"]["occluder"]["vertices"]),
                new_pieces=len(ids),new_vertices=sum(len(p["vertices"]) for p in scene["occluders"])),
            criteria=dict(mean_improvement_minimum=.02,per_key_worsening_maximum=.02))
        write(out/"comparison.json",comparison_record)
        # Preserve the ordinary consumer output even if the later benefit gate fails.
        movie=out/"movie"
        command([sys.executable,ROOT/"tools/export_video.py",pieces_folder/"project.json",movie],
                out,"export",90)
        receipt=read(movie/"receipt.json")
        need(receipt["status"]=="complete" and receipt["encoder"]["exit"]==receipt["projectionExit"]==receipt["probe"]["exit"]==0,
             "ordinary export completed")
        need(receipt["frameCount"]==96 and receipt["actualDurationSeconds"]==4 and
             receipt["requestedDurationSeconds"]==4 and receipt["durationRoundingSeconds"]==0,"four-second movie")
        need(receipt["videoSha256"]==sha(movie/"performance.webm"),"movie identity")
        need(receipt["inputSha256"]==pieces_receipt["projectSha256"]==sha(movie/"input-project.json"),
             "ordinary consumer project identity")
        need(receipt["sceneSha256"]==pieces_receipt["sceneSha256"]==sha(movie/"scene.json") and
             read(movie/"scene.json")==scene,"saved scene identity")
        need(receipt["sourceUnchanged"] is True and all(sources[k]==v for k,v in receipt["sourceSha256"].items()),
             "export source identity")
        frames=receipt["frames"]
        need(len(frames)==96 and all(f["frame"]==i and f["physicalTime"]==i/95 and f["presentationTime"]==i/24
             for i,f in enumerate(frames)),"physical/presentation schedule")
        info=receipt["probe"]["info"]
        need(len(info["streams"])==1,"single stream")
        stream=info["streams"][0]
        need(stream["codec_name"]=="vp9" and stream["width"]==WIDTH and stream["height"]==HEIGHT,"codec/dimensions")
        a,b=map(int,stream["time_base"].split("/"));tick=a/b
        need(0<tick<=.001 and abs(float(info["format"]["duration"])-4)<=.001,"time base/duration")
        data=[json.loads(line) for line in (movie/"projected-frames.jsonl").read_text().splitlines()]
        need(data[0]["sceneSha256"]==pieces_receipt["sceneSha256"] and len(data)==97,"frame source chain")
        bounds=[]
        for i,row in enumerate(data[1:]):
            need(row["frame"]==i and row["physicalTime"]==i/95 and row["presentationTime"]==i/24,"frame schedule")
            need(len(row["polygons"])==len(ids) and all(len(p)==4 for p in row["polygons"]),"persistent piece count")
            pixels=[[500+260*x,350-260*y] for p in row["polygons"] for x,y in p]
            bounds.append(dict(frame=i,inside=all(math.isfinite(x) and math.isfinite(y) and 1<=x<=998 and 1<=y<=712 for x,y in pixels)))
        write(out/"geometry-bounds.json",bounds)
        need(all(r["inside"] for r in bounds),"sampled geometry framing")
        decoded=decode(movie/"performance.webm",out,tools["ffmpeg"],tick)
        need(old_mean-pieces_mean>=.02,"practical mean improvement at least .02")
        need(all(r["pieces"]["error"]-r["original_single"]["error"]<=.02 for r in comparison),
             "no authored key worsens more than .02")
        need(sha(baseline)==sha(out/"original-single-project.json")==BASELINE_SHA,"baseline unchanged")
        after={name:sha(ROOT/name) for name in sources}
        write(out/"sources-after.json",after)
        need(after==sources,"source and fixtures unchanged")
        result.update(passed=True,status="completed",helper_fit_calls=2,encode_processes=1,full_decode_processes=1,
            old_fit_replays=0,fit_count_semantics="Fixed helper control flow and successful mode-specific receipts.",
            comparison=comparison_record,decode=decoded,movie_sha256=receipt["videoSha256"],
            project_sha256=pieces_receipt["projectSha256"],scene_sha256=pieces_receipt["sceneSha256"],
            default_project_sha256=single_receipt["projectSha256"],
            limitations=["Finite fixed-grid union estimates, not continuous geometry equivalence.",
                "Saved old single light share .65 versus new pieces0; whole-construction comparison.",
                "Interpolation is not asserted equal to authored boundary morph.",
                "No collision/fabrication guarantee or performance claim.","Visual review pending."])
        write(out/"result.json",result)
        return result
    except BaseException as error:
        result.update(passed=False,status="failed",error=dict(type=type(error).__name__,message=str(error)))
        write(out/"result.json",result)
        raise
    finally:
        try:
            after={name:sha(ROOT/name) for name in sources}
            write(out/"sources-after.json",after)
            need(after==sources and sha(baseline)==BASELINE_SHA,"final source/baseline identity")
        except BaseException as error:
            result.update(passed=False,status="failed",final_identity_error=dict(type=type(error).__name__,message=str(error)))
            write(out/"result.json",result)
            raise

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--baseline",type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(run(args.output,args.baseline.resolve()),allow_nan=False))
