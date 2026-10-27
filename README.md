# SHADOW STAGE

An editable shadow choreography studio. Author silhouette moments, build a physical performance with a moving point light and persistent cutouts, then inspect, edit and export the result. The stage renders shadows from the physical scene at every frame.

This is the selected SHADOW STAGE concept tracked in [HAMON #1631](https://github.com/Jacob-Met/hamon/issues/1631#issuecomment-6431099893). The current implementation is a private working studio. Actual model benefit, collision clearance and physical fabrication are not established.

## Run the studio

Node.js 20 or newer is required. There are no runtime npm dependencies or installation steps.

```sh
node server.mjs
```

Open `http://127.0.0.1:4318`. The server binds to loopback by default; `HOST` and `PORT` configure its address. Target editing, fitting, playback and all local exports work without a model credential or network request.

1. Choose a preset or draw a silhouette. Move its vertices or use translation, scale and rotation controls. Add moments to the authored timeline.
2. Choose one cutout or a construction of pieces. **Find the performance** fits the physical scene without replacing the requested silhouettes.
3. Scrub or play the result. The dashed target and rendered shadow expose remaining mismatch.
4. Edit the light or select a physical cutout and change its translation, rotation or depth. Lock a cutout's motion to preserve its full track during refinement.
5. Keep a baseline and compare another unlocked construction under shared settings. Inspect all four states, then explicitly adopt one or undo the last selection.
6. Save the editable project, export a projected SVG frame, download a standalone HTML player, or record the physical performance as WebM.

Solving runs in a module worker. A new project, incoming import, changed target, physical edit or lock change cancels older work. Completion also checks the dispatch generation and the captured project contents before committing.

## Two construction methods

### One persistent cutout

The first authored silhouette supplies a fixed planar polygon. A similarity fit estimates translation, rotation and scale at each authored moment. Cyclic correspondence, reversed winding and different starting vertices are considered; unequal vertex counts use boundary resampling.

Scale is realized by moving the cutout in depth. Translation can be shared between lamp and cutout. This constrained template cannot reproduce arbitrary changes of shape: a triangle and a square leave a visible residual when made from one fixed planar polygon.

### A construction of pieces

A greedy raster cover approximates each target with squares. Persistent square cutouts are assigned between moments and their physical translation and depth realize the projected cover. Surplus pieces overlap other pieces; they do not disappear or become transparent. Piece IDs and vertices remain fixed throughout the performance.

The maximum-piece setting controls construction complexity. More pieces can improve authored silhouettes without improving the paths between them. The current search is neither globally optimal nor a solution to collision-free assembly.

**Refine this construction** performs bounded coordinate search from the current physical scene. It retains the light, piece count and geometry. Locked cutout meshes and complete tracks are preserved exactly. The UI uses at most 2,000 candidate attempts; actual candidate raster evaluations, initial objective work and final measurement are recorded separately in the result.

## Compare constructions

**Keep current as baseline** preserves a detached multi-piece construction and its targets. Edit the rig or adopt a physical proposal, then choose **Compare frozen constructions**. The current project remains unchanged while a separate native worker refines both inputs.

Comparison requires identical targets and duration, equal actual piece and total vertex counts, and unlocked constructions. Both inputs receive the same configured iterations, raster resolution and candidate-attempt limit. Refinement preserves each input's light, fixed piece geometry and identity.

Four synchronized previews show baseline/current before and after refinement. One observation window and common sample locations measure all four states. Authored-key IoU, missed-target fraction and spill relative to target are separate from the chosen intermediate morph. Higher IoU is better; the results are finite-resolution estimates. Unresolved targets reject, and close differences need higher-resolution confirmation before a strong benefit claim.

Actual candidate attempts, raster evaluations and measurement work remain visible. Equal configured budgets do not imply equal actual work. No score identifies a model winner or establishes continuous-time coverage.

Adoption is explicit. It preserves targets and existing proposal records; those records describe their historical response, not necessarily the newly selected geometry. **Undo last comparison adoption** restores the preceding scene while that adoption is still the latest project change. Session history retains at most three entries and 8 MiB. New/open projects clear it; project JSON does not save this comparison undo history.

## Physical model and motion

The stage is the plane `z=0`. For light `L`, cutout world point `P` and cutout depth `z`, point-light projection is:

```text
shadow.xy = L.xy + (L.z / (L.z - z)) * (P.xy - L.xy)
```

Multiple opaque projected polygons form a union. No target image is used as the rendered shadow. Valid scenes keep cutouts above the stage and at least 0.05 below the conservative minimum light height. This keeps the depth interpolation away from its projection singularity.

Pose channels use smoothstep interpolation, with zero velocity at keys and shortest-arc, cumulatively unwrapped angles. Motion is continuous within the timeline, but added keys can produce pauses. Different initial and final poses do not form a seamless loop. Playback stops at the end.

Physical pieces may intersect. The studio does not certify fabrication dimensions, collision clearance, mechanical feasibility, penumbrae or real-lamp behavior.

## Read the evidence by metric

For a single cutout, residuals are symmetric sampled boundary-to-segment RMS distances in stage coordinates. They are not image-overlap percentages.

For multiple pieces, mismatch is sampled shadow/target symmetric difference divided by their union. Zero means agreement on the sampled raster; it is not continuous-area certification. Measurements reject targets occupying fewer than four cells rather than awarding an empty-mask success. A larger scene extent can make small targets unresolved.

Both modes separate:

- Authored moments, compared with the actual requested silhouettes.
- Between-moment samples, compared with a chosen boundary morph. This is an authoring specification, not observed intermediate ground truth.
- A static first-target baseline.
- Geometric validity, which does not by itself establish an aesthetically good performance.

The six-case experiment in `docs/geometry-quality.json` found that 24 pieces substantially improved authored silhouettes on two fixtures. Transition mismatch remained high. These examples do not establish general performance on unseen shapes.

## Save, receive and export

Project JSON preserves authored targets, canonical physical geometry, construction settings, locks and bounded proposal history. Reopening recomputes fit evidence; imported metric claims are not trusted.

The standalone HTML player embeds the actual physical scene and reconstructs every projected cutout offline. It needs no studio server, external scripts or target artwork. The SVG is one projected frame.

**Export performance as WebM** records a validated snapshot of the physical scene at 1000 × 714 pixels, without target outlines or studio controls. The export takes approximately the performance duration; keep the tab active. Edits made during recording do not change its frozen scene. Cancel produces no completed-video download, and a fresh export can be started afterward.

The browser must support MediaRecorder, WebM and manual canvas-frame capture. This bounded export supports up to 120 seconds and 64 MiB. It requests nominally 24 frames per second; browser encoding determines actual frame cadence and duration. Exact constant frame rate, lossless pixels, background-tab behavior, long-duration reliability and MP4 compatibility are not established. The standalone player remains available independently of video support.

## Optional model proposals

The maintained server has two distinct routes:

- `/api/propose` proposes explicit edits to authored moments. The author reviews and adopts them.
- `/api/scene-propose` proposes a physical construction against unchanged targets and duration. The studio requests the existing actual piece count, up to 16, for a controlled initialization candidate.

The fixed provider endpoint is `https://api.tokenfactory.nebius.com/v1/chat/completions`; the default model is `nvidia/Nemotron-3_5-Lightning`, as listed in the [official Nebius cookbook](https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/README.md). The server only reads existing process configuration; it does not acquire credentials.

Requests and streaming responses are bounded, proposals are structurally and geometrically validated, and adoption is explicit. A response may record provider ID, model, time, token usage and content hash. Imported metadata remains an unverified record of a response, not independent proof of model execution.

No actual Nebius inference has run for this project. A configured adapter, fixture response and usable account route are distinct evidence states. There is no demonstrated model search advantage yet.

## Verify the maintained application

```sh
node --test tests/*.test.js
```

Native tests cover physical projection, fitting, scene validation, custody, bounded proposals and independent receiving oracles. The real-browser course in `tests/browser-receiving.mjs` requires Playwright and its browser in the receiving environment:

```sh
SHADOW_STAGE_URL=http://127.0.0.1:4318 \
SHADOW_STAGE_EVIDENCE=/path/to/evidence \
node tests/browser-receiving.mjs
```

It exercises actual controls, download and fresh import, physical refinement, exact lock preservation, worker cancellation during newer edits, responsive layout, and downloaded offline players. The offline mask check derives ray projection independently. Browser automation preserves the application's CSP and Chromium sandbox. Screenshots require separate visual review.

The comparison and finished-video courses use the same actual HTTP entry point and a fresh evidence directory for each run:

```sh
SHADOW_STAGE_URL=http://127.0.0.1:4318 \
SHADOW_STAGE_EVIDENCE=/path/to/comparison-evidence \
node tests/comparison-browser.mjs

SHADOW_STAGE_URL=http://127.0.0.1:4318 \
SHADOW_STAGE_EVIDENCE=/path/to/video-evidence \
node tests/video-browser.mjs
```

Video receiving additionally requires existing `ffmpeg` and `ffprobe` executables. It observes native capture tracks, cancellation and recovery, downloads the actual file, opens fresh playback, decodes the complete stream and checks selected decoded frames against an independent ray/union oracle. Timing correspondence retains uncertainty and all plausible request intervals; it does not equate encoded frame index with request index. Its three-second foreground fixture does not qualify every duration or browser.

The comparison proposal-adoption journey uses a controlled local response marked `executed:false`. It tests lifecycle behavior only; it is not inference evidence.

## Reproducible delivery

```sh
python3 scripts/package.py
```

This builds `dist/shadow-stage.zip`, its SHA256 sidecar and a per-file `SHA256SUMS`. An explicit allowlist includes runtime modules, tests and documentation. Credentials, environment files, dependencies, logs and unrelated workspace contents are excluded. Ordering, timestamps, permissions and ZIP storage are fixed.

```sh
cd dist
sha256sum -c shadow-stage.zip.sha256
unzip shadow-stage.zip
cd shadow-stage
sha256sum -c SHA256SUMS
node --test tests/*.test.js
node server.mjs
```

The extracted package needs no CDN, generated bundle or transpilation. Receiving must exercise this extracted application as well as the source checkout. Checksums identify matching bytes; they are not signatures or public-release qualification.
