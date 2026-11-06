# Export a physical performance without a browser

From the checkout root, with Python/Pillow, Node, FFmpeg built with `libvpx-vp9`, and ffprobe already installed:

```sh
python3 tools/export_video.py saved-project.json new-output-directory
```

The destination must not exist and its parent must exist. The saved project must contain a physical scene and have duration at most 120 seconds. Existing project validation and physical projection run unchanged; no solver, model provider or browser is invoked. The original input is copied before processing.

The exporter produces a fixed 1000 × 714 movie at 24 frames per second. It chooses `N = max(2, floor(duration × 24 + 0.5))`, samples normalized physical time `i/(N−1)`, and declares actual movie duration `N/24`. It uses the existing camera `(500 + 260x, 350 − 260y)` and colors, Pillow at fixed 2× resolution with LANCZOS downsampling, then one single-threaded `libvpx-vp9` lossless `yuv444p` encode. Lossless YUV encoding does not preserve exact RGB bytes and is not browser-pixel equivalence. No encoder option is selected from observed output quality.

Only a bounded number of raster buffers are live; raw movie frames are streamed to FFmpeg rather than retained as a full movie in memory. The bundle contains `performance.webm`, `receipt.json`, copied input, canonical `scene.json`, projected frame geometry, three preview PNGs, encoder logs and ffprobe records. Per-frame source RGB hashes identify pre-encode pixels; preview hashes can be checked directly for retained frames. Scene identity hashes exact Node `JSON.stringify` UTF-8 bytes without a newline, retained verbatim in `scene.json`.

The receipt records source and executable identities, frame/sample times, actual duration, encoder exit, movie hash and probe information. The producer has a 600-second subprocess deadline; qualification may use a narrower outer deadline. Source files are checked again before publication. A new sibling temporary directory holds incomplete output. On failure it remains with `failure.json` and available logs; stderr identifies its location. Successful publication uses Linux `renameat2(RENAME_NOREPLACE)` so it never replaces an existing destination, including one created concurrently. This utility currently requires that Linux publication primitive and does not claim power-loss durability. Interrupted writes or process termination outside Python cleanup can leave an incomplete temporary directory.

The completed bundle is an opt-in export artifact. It does not change maintained browser export, editing, project schema, rendering source, motion, history or solver behavior. It does not certify collision clearance, fabrication, artistic quality or general browser equivalence. The independent finite whole-movie receiver lives under `tests/offline-video`; its prospective protocol and actual execution evidence are separate from this usage description.

The fixed encoder command also selects `-deadline good -cpu-used 4`; these settings were chosen before receiving, not from measured outcomes. The receipt includes requested duration, frame-derived duration and their signed difference. If final publication fails after an encoder receipt was prepared, that original is retained as `prepublication-receipt.json`; `receipt.json` and `failure.json` record the failed operation.
