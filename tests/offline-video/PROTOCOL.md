# Prospective offline-video receiving

Two newly authored projects establish a bounded fixed-profile export capability. No historical movie, real model asset, browser capture, solver or quality study is used. Source, fixtures and this protocol must be frozen before rendering or encoding.

## Fixed course

`single.json` contains one square with smoothstep translation and a quarter turn, fixed light height 5 and cutout height 2.5. Its one-second duration produces 24 frames. `crossing.json` contains two oppositely moving squares, differing vertical offsets, and a moving light. Its 1.05-second duration produces 25 frames. A third saved project has no scene and is used solely for refusal. The second refusal attempts an existing output directory; it must preserve the already completed output. Exactly two successful full movies are encoded; no parameter sweep or failed-course retry is authorized.

The fixed camera is 1000 by 714, mapping world `(x,y)` to `(500+260x,350-260y)`, at 24 fps. Frame count is `max(2,floor(duration*24+0.5))`. Physical time is `i/(N-1)`; nominal presentation time is `i/24`. Encoding is the selected one-thread VP9 lossless YUV444p profile, with fixed 2x Pillow rasterization and LANCZOS reduction. Lossless YUV encoding does not imply exact original RGB or browser-canvas pixels.

## Independent whole-movie checks

The receiver does not import producer geometry. It directly derives the two authored trajectories using `u=t*t*(3-2*t)`, elementary rotation, and point-light projection at scale 2; the moving-light offset is subtracted explicitly. It rasterizes independent expected pixel-center inclusion masks and calculates distance to every polygon edge. Every decoded movie frame is checked, including the first, last, and intermediate frames.

A fixed three-pixel edge-distance band is excluded from the primary classification gate. RGB pixels are classified by nearest squared distance to the declared foreground/background colors. Every frame must have at least 99.5% correct classification outside the band. All whole-mask errors, foreground counts, union-relative mismatches, overlap counts and decoded RGB frame hashes are retained before assertions. The overlapping interior of the crossing movie must remain foreground; this detects XOR/holes. The moving single fixture and separated crossing endpoints disconfirm frozen frames and omitted/reordered endpoints.

Decoded frame count and dimensions must be exact. Each actual PTS must match `i/24` within one recorded stream time-base tick, including its absolute origin; no silent timestamp rebasing. Container duration must agree with `N/24` within the same recorded tick. Source per-frame physical and presentation times must match the declared schedule. Source RGB hashes are distinct from decoded RGB hashes: a recorded source hash alone is provenance, not independent access to source pixels. Complete encoded bytes and decoded RGB bytes are retained for later data-only inspection.

Input project bytes, producer/runtime source identities and FFmpeg/ffprobe versions are recorded. Inputs and sources must remain unchanged. All command output/error/exit receipts and refused-request evidence are retained. This course establishes only these authored movies and the declared fixed profile; it does not establish arbitrary scene correctness, artistic quality, cross-runtime byte identity or browser equivalence.

The emitted per-frame world polygons are independently checked against the authored analytic projection with at most 1e-10 camera-pixel coordinate error. Exact first/middle/last retained RGB PNG bytes are hashed against the corresponding source-frame receipt hashes (three per movie); remaining source RGB hashes are provenance only. Each command has a 60-second bound and timeout kills its process group; root retains the outer course bound. No receiver invokes the producer projection module.

Before any encode, the fixed VP9 profile is explicitly `-deadline good -cpu-used 4`; both command and receipt profile must agree. Requested duration and signed rounding difference must match the input and `N/24 - requested`. The observed time-base tick must be positive and at most 0.001 seconds, and all frame timestamps must be finite and strictly increasing, in addition to the existing one-tick schedule/duration gates. These refinements add no movies or refusal cases.
