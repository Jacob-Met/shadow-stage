"""One prospective Paper Swallow creative receiving course; no regression replay.

Run only after source freeze and outer admission. One import (30 s), one export
(90 s), one full RGB decode (45 s); no earlier receiver is imported. Timeouts
are per command, not an aggregate CPU/RSS guarantee. Outer supervision owns
whole-course admission and descendant cleanup.
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
COUNT, WIDTH, HEIGHT = 144, 1000, 714
SELECTED = {0, 43, 93, 143}
PRODUCERS = (
    "tools/import_svg.py", "tools/fit_svg_targets.mjs",
    "tools/export_video.py", "tools/project_frames.mjs",
    "src/core.js", "src/project.js", "src/runtime.js", "src/articulated.js",
)
AUTHORED = (
    "start.svg", "dip.svg", "turn.svg", "return.svg", "sequence.json",
    "geometry.json", "README.md", "expected.json", "receiving.py",
)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def need(ok, message):
    if not ok:
        raise AssertionError(message)


def command(args, out, name, timeout):
    args = list(map(str, args))
    write(out / (name + "-command.json"), {"command": args, "timeout_seconds": timeout})
    started = time.monotonic()
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True)
    expired = False
    try:
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
    (out / (name + ".stdout")).write_bytes(stdout)
    (out / (name + ".stderr")).write_bytes(stderr)
    record = dict(command=args, exit=process.returncode, timed_out=expired,
                  wall_seconds=time.monotonic() - started,
                  stdout_sha256=hashlib.sha256(stdout).hexdigest(),
                  stderr_sha256=hashlib.sha256(stderr).hexdigest())
    write(out / (name + "-exec.json"), record)
    need(not expired and process.returncode == 0, name + " command failed")
    return record


def authored_projection(scene, t):
    light = next(key for key in scene["light"]["keys"] if key["t"] == t)
    piece = scene["occluder"]
    pose = next(key for key in piece["keys"] if key["t"] == t)
    scale = light["z"] / (light["z"] - pose["z"])
    cosine, sine = math.cos(pose["angle"]), math.sin(pose["angle"])
    return [
        [scale * (pose["x"] + cosine*x - sine*y) + (1-scale)*light["x"],
         scale * (pose["y"] + sine*x + cosine*y) + (1-scale)*light["y"]]
        for x, y in piece["vertices"]
    ]


def compare_vertices(actual, expected):
    need(len(actual) == len(expected) == 12, "expected twelve corresponding vertices")
    need(all(len(p) == 2 for p in actual + expected), "two-coordinate vertices")
    errors = [math.hypot(a[0]-b[0], a[1]-b[1]) for a, b in zip(actual, expected)]
    need(all(math.isfinite(v) for v in errors), "finite vertex errors")
    return max(errors)


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
    out = out.resolve()
    need(not out.is_relative_to(HERE), "output must be outside authored example directory")
    out.mkdir(exist_ok=False)
    sources = {name: sha(ROOT/name) for name in PRODUCERS}
    sources.update({str((HERE/name).relative_to(ROOT)): sha(HERE/name) for name in AUTHORED})
    write(out / "sources-before.json", sources)
    tools = {name: shutil.which(name) for name in ("node", "ffmpeg", "ffprobe")}
    need(all(tools.values()), "required installed executables")
    write(out / "runtime.json", dict(python=sys.version, executable=sys.executable,
          python_sha256=sha(sys.executable), pillow=PILLOW_VERSION,
          affinity=sorted(os.sched_getaffinity(0)),
          thread_environment={k: os.environ.get(k) for k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS")},
          executables={k: dict(path=v, sha256=sha(v)) for k,v in tools.items()}))
    try:
        oracle = read(HERE/"expected.json")
        expected = [dict(t=row["t"], polygon=[[x/row["denominator"], y/row["denominator"]]
                    for x,y in row["numerators"]]) for row in oracle["expected"]]
        need(len(expected) == 4 and [x["t"] for x in expected] == [0, .3, .65, 1], "four frozen authored moments")
        imported = out/"imported"
        command([sys.executable, ROOT/"tools/import_svg.py", HERE/"sequence.json", imported], out, "import", 30)
        receipt, helper = read(imported/"receipt.json"), read(imported/"fitter.stdout")
        project, targets = read(imported/"project.json"), read(imported/"targets.json")
        fit_report = read(imported/"fit-report.json")
        diagnostics = []
        need(len(targets) == len(project["targets"]) == 4, "four imported targets")
        for target, saved, want in zip(targets, project["targets"], expected):
            need(target["t"] == saved["t"] == want["t"], "authored target times")
            normalized_error = compare_vertices(target["polygon"], want["polygon"])
            project_error = compare_vertices(saved["polygon"], want["polygon"])
            projected = authored_projection(project["scene"], want["t"])
            projection_error = compare_vertices(projected, want["polygon"])
            diagnostics.append(dict(t=want["t"], expected=want["polygon"], normalized=target["polygon"],
                  projected=projected, normalized_max_vertex_error=normalized_error,
                  project_max_vertex_error=project_error, projection_max_vertex_error=projection_error))
        write(out/"authored-projection.json", dict(rows=diagnostics, fit_report=fit_report,
              metric="Corresponding native twelve-vertex Euclidean error; direct projection from actual scene keys."))
        need(all(x["normalized_max_vertex_error"] <= 1e-12 and x["project_max_vertex_error"] <= 1e-12 for x in diagnostics), "normalized targets")
        need(all(x["projection_max_vertex_error"] <= 1e-8 for x in diagnostics), "authored physical projection")
        need(receipt["status"] == "complete" and receipt["fitInvoked"] is True and receipt["fitCalls"] == 1 and receipt["fitterExit"] == 0, "one successful helper fit")
        need(receipt["roundtrip"] is True and helper["roundtrip"] is True and receipt["sourceUnchanged"] is True, "actual parser roundtrip")
        need(helper["projectSha256"] == receipt["projectSha256"] == sha(imported/"project.json"), "helper project identity")
        need(all(sources[k] == v for k,v in receipt["sourceSha256"].items()), "importer source identity")
        sequence = read(HERE/"sequence.json")
        need(receipt["sequenceSha256"] == sha(HERE/"sequence.json") == sha(imported/"inputs/sequence.json"), "sequence custody")
        need(len(receipt["inputs"]) == 4, "four retained SVGs")
        for item, moment in zip(receipt["inputs"], sequence["moments"]):
            need(item["file"] == moment["file"] and item["t"] == moment["t"] and
                 item["sha256"] == sha(HERE/moment["file"]) == sha(imported/item["retained"]), "SVG custody")
        need(project["format"] == "shadow-stage/project-v1" and project["duration"] == 6 and
             project["scene"]["duration"] == 6 and project["lightShare"] == 0 and
             project["construction"] == dict(mode="single", maxPieces=1), "project contract")
        movie = out/"movie"
        command([sys.executable, ROOT/"tools/export_video.py", imported/"project.json", movie], out, "export", 90)
        movie_receipt = read(movie/"receipt.json")
        need(movie_receipt["status"] == "complete" and movie_receipt["encoder"]["exit"] == 0 and
             movie_receipt["projectionExit"] == 0 and movie_receipt["probe"]["exit"] == 0, "export completion")
        need(movie_receipt["frameCount"] == COUNT and movie_receipt["actualDurationSeconds"] == 6, "movie duration/count")
        need(movie_receipt["videoSha256"] == sha(movie/"performance.webm"), "movie hash")
        need(movie_receipt["inputSha256"] == receipt["projectSha256"] == sha(movie/"input-project.json"), "ordinary consumer input")
        need(movie_receipt["sceneSha256"] == receipt["sceneSha256"] == sha(movie/"scene.json") and
             read(movie/"scene.json") == project["scene"], "scene preservation")
        need(movie_receipt["sourceUnchanged"] is True and all(sources[k] == v for k,v in movie_receipt["sourceSha256"].items()), "export source identity")
        frames = movie_receipt["frames"]
        need(len(frames) == COUNT and all(f["frame"] == i and f["physicalTime"] == i/143 and
             f["presentationTime"] == i/24 for i,f in enumerate(frames)), "fixed physical/presentation schedule")
        info = movie_receipt["probe"]["info"]
        need(len(info["streams"]) == 1, "single video stream")
        stream = info["streams"][0]
        need(stream["codec_name"] == "vp9" and stream["width"] == WIDTH and stream["height"] == HEIGHT, "VP9 geometry")
        numerator, denominator = map(int, stream["time_base"].split("/"))
        tick = numerator/denominator
        need(0 < tick <= .001 and abs(float(info["format"]["duration"])-6) <= .001, "movie time base/duration")
        projected_rows = [json.loads(line) for line in (movie/"projected-frames.jsonl").read_text().splitlines()]
        header, geometric = projected_rows[0], projected_rows[1:]
        need(header["sceneSha256"] == receipt["sceneSha256"] and len(geometric) == COUNT, "projected-frame identity/count")
        bounds = []
        for i,row in enumerate(geometric):
            need(row["frame"] == i and row["physicalTime"] == i/143 and row["presentationTime"] == i/24, "projected schedule")
            need(len(row["polygons"]) == 1 and len(row["polygons"][0]) == 12, "one twelve-vertex silhouette")
            pixels = [[500+260*x, 350-260*y] for x,y in row["polygons"][0]]
            valid = all(math.isfinite(x) and math.isfinite(y) and 1 <= x <= 998 and 1 <= y <= 712 for x,y in pixels)
            bounds.append(dict(frame=i, pixel_vertices=pixels, inside=valid))
        write(out/"geometry-bounds.json", bounds)
        need(all(x["inside"] for x in bounds), "all sampled polygons within camera bounds")
        decoded = decode(movie/"performance.webm", out, tools["ffmpeg"], tick)
        final_sources = {name: sha(ROOT/name) for name in sources}
        write(out/"sources-after.json", final_sources)
        need(final_sources == sources, "source/input bytes changed")
        result = dict(passed=True, imports=1, helper_fit_calls=1,
              fit_count_semantics="Fixed unchanged helper control flow and successful receipt, not external dynamic tracing.",
              encode_processes=1, full_decode_processes=1, refusal_cases=0,
              project_sha256=receipt["projectSha256"], scene_sha256=receipt["sceneSha256"],
              movie_sha256=movie_receipt["videoSha256"], fit_report=fit_report,
              max_authored_vertex_error=max(x["projection_max_vertex_error"] for x in diagnostics),
              normalized_tolerance=1e-12, authored_tolerance=1e-8,
              geometry_bounds=[1,998,1,712], pixel_gate="Pillow L <128: nonempty; no foreground at image edges.",
              decode=decoded, limitations=[
                  "Creative consumer course, not producer regression or performance study.",
                  "Sampled geometry/pixel bounds do not establish continuous-time framing or target equality.",
                  "Thresholded foreground is not full silhouette quality, pixel identity or artistic acceptance.",
                  "Contact sheets and selected frames await separate visual review."])
        write(out/"result.json", result)
        return result
    finally:
        after = {name: sha(ROOT/name) for name in sources}
        write(out/"sources-after.json", after)
        need(after == sources, "source/input bytes changed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.output), allow_nan=False))
    except BaseException as error:
        if args.output.is_dir():
            write(args.output/"receiving-failure.json", dict(type=type(error).__name__, error=str(error)))
        raise
