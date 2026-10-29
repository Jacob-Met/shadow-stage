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
6. For a multi-piece scene, prepare a separate transition preview. Scrub original and candidate motion together, inspect physical poses and the shape-versus-motion tradeoff, then explicitly adopt or keep the original.
7. Save the editable project, export a projected SVG frame, download a standalone HTML player, or record the physical performance as WebM.

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

## Explore transition motion

**Prepare transition preview** creates a separate multi-piece performance from the current scene. It inserts physical poses between authored moments and searches their translation and depth against the chosen target boundary morph. Existing physical keys, piece identities, local geometry and the light remain fixed. Locked pieces retain their full tracks.

The current project stays unchanged during calculation, scrubbing and synchronized playback. Original and candidate shadows share a fixed camera and time; clipping is disclosed rather than silently changing the view. The dashed outline is an author-selected intermediate morph, not an observed silhouette. Normal and quarter-speed playback, the quarter-time shortcut and a worst-held-out shortcut help locate difficult passages.

The panel retains original, inserted-key and final held-out errors. It also shows the sampled maximum vertex step and explicitly warns when that measure worsens. The eight-second paper→triangle→square receiving fixture improves sampled silhouette fit while moving some projected vertices farther between samples. Added smoothstep keys introduce zero-velocity moments and may cause hesitant motion. A numerical mask criterion is not an artistic judgment.

Select a physical piece and scrub to inspect its current original/candidate position, height, rotation and light clearance, alongside its fixed vertices and editable motion keys. **Adopt this motion** is explicit and preserves targets, locks and historical proposal custody. It invalidates old comparison scores while retaining the comparison baseline and bounded recovery history. The comparison can run again immediately.

**Undo motion adoption — this session** restores the prior scene while no later project edit has intervened. Opening or creating a project clears transition preview and session undo. After adoption, **Dismiss comparison** only closes the retained preview; undo is the action that restores the previous motion. Normal project export includes an adopted scene, never an unadopted preview.

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

The transition course exercises actual fitting and module workers, immutable preview, live physical pose inspection, original/adopt/undo paths, preservation of comparison baseline/history, immediate subsequent comparison, exact locked tracks, cancellation, stale edits, downloaded project reopening, responsive layout and the served CSP:

```sh
SHADOW_STAGE_URL=http://127.0.0.1:4318 SHADOW_STAGE_EVIDENCE=/path/to/transition-evidence node tests/transition-receiving.mjs
```

The comparison proposal-adoption journey uses a controlled local response marked `executed:false`. It tests lifecycle behavior only; it is not inference evidence.

### Compare a separate motion alternative

After preparing a transition preview, choose **Prepare motion alternative** to explore a second candidate. The same two canvases then compare the shape candidate with the motion alternative at one shared time and camera. The physical inspector follows those displayed scenes. The original shape-refinement measurements remain labeled as stage evidence; the new section reports its own mean and maximum silhouette error, sampled projected-shadow vertex speed and finite-difference velocity-change rate. **Return to shape candidate** changes the view without changing the project. Adoption remains explicit, and session undo restores the actual project from before either preview. Dismissing an adopted comparison retains that undo until a later project edit invalidates it.

The bounded search moves only inserted, unlocked x/y/z keys. It preserves the light, local meshes, identities, key times, angles, original physical keys and complete locked tracks. It selects with training samples, then separately checks held-out samples. Qualification retains at least 90% of the prior mean-error gain with at most 0.005 absolute mean-error loss; it also requires more than 1% lower peak sampled projected-vertex speed without more than 0.1% increase in the velocity-change proxy. Maximum silhouette error is reported separately and may increase. The fixed observation window is [-1.2, 1.2] on both axes; unresolved or out-of-window reference observations are refused, and out-of-window assessed shadows cannot qualify. The combined-work guard applies before rasterization, motion evaluation and search, after initial scene validation.

These are sampled geometric measures, including vertices hidden inside an opaque silhouette. They are not physical cutout acceleration, energy use, exact shadow equality or an artistic-quality verdict. Smoothstep still imposes pauses at physical keys. The full alternatives remain inspectable even when they do not qualify; a numerical result is not adopted automatically.

The focused motion course is intended to exercise real native workers and check preview custody, live pose references, return/adopt/dismiss/undo, comparison availability, actual download and fresh replay, cancellation during edits, historical explanations and narrow layout:

The current combined source passed 79 native tests, two independent scalar-motion receiving cases, and exact reproduction of both retained motion proposals. The scalar oracle checks metric calculation and duration scaling; it is not additional optimizer-quality evidence. Browser receiving covered 65 distinct groups: 15 studio, 9 comparison, 16 target-history/phone, 17 transition, 5 motion, and 3 combined motion/history groups. The affected courses ran against an extracted reproducible package in sandboxed Chrome 156, retaining strict served-CSP and error checks.

The combined course checks that target Undo/Redo keeps an adopted physical scene and source custody, makes stale motion actions unavailable, and updates the real phone preview. It also downloads and reopens the combined project in a fresh studio, and verifies cancellation when target Undo interrupts a pending motion worker. Its mirror comparison uses the maintained renderer; phone viewports are simulated rather than physical-device tests.

```sh
SHADOW_STAGE_URL=http://127.0.0.1:4318 SHADOW_STAGE_EVIDENCE=/path/to/motion-evidence node tests/motion-receiving.mjs
SHADOW_STAGE_URL=http://127.0.0.1:4318 SHADOW_STAGE_EVIDENCE=/path/to/motion-history-evidence node tests/motion-history-receiving.mjs
```

The unchanged 200-, 400-, and 800-interval diagnostics compare the selected motion alternative with the shape candidate. Their peak projected-shadow speed ratios are 0.845 on all three grids for the original shape-change fixture and 0.971 / 0.969 / 0.968 for the unfamiliar star/arrow/diamond fixture. On the 200-interval grid:

| Eight-second fixture | Original scene | Shape candidate | Motion alternative |
| --- | ---: | ---: | ---: |
| Shape change | 1.1163 | 1.6163 | 1.3657 |
| Star / arrow / diamond | 0.8810 | 0.9636 | 0.9355 |

Values are sampled peak projected-shadow vertex speeds in stage units per second. Both alternatives remain above their original pre-refinement scenes. All 24 inspected inserted-key neighborhoods have speed and velocity-change-rate ratios of 1.0: the diagnostic shows no local improvement there. The original scene receipts and these limits remain preserved; the diagnostic does not retune the proposal or establish continuous-time bounds, lower actuator demands, or better visual or artistic quality.

The independent calculation can be rerun from the source checkout:

```sh
node scripts/receive-motion-independent.mjs /path/to/new-independent-motion-receipt.json
```

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

## Keep the stage in view on a phone

The phone target editor includes a read-only **Stage preview** view. It mirrors the
same target outline and physical shadow as the full stage while you adjust the
Across, Rise, Size and Turn controls. A changed target still retains the last
physical performance until you choose **Find the performance**; the preview
states that distinction and honors the existing target-outline setting.

The compact view stays within target authoring as you scroll. Short or enlarged
layouts keep it in the ordinary page flow so it does not take over the viewport.
**Edit on full stage** moves to the original canvas for closer inspection or direct
editing. The preview does not add history entries or change saved projects.

## Undo and redo target edits

Use **Undo** and **Redo** below the target editing modes to reverse canvas moves,
point edits, completed drawings, transform gestures, and added or removed moments.
Outside text, number, range and other editable controls, Ctrl/Cmd+Z undoes,
Ctrl/Cmd+Shift+Z redoes, and Ctrl+Y also redoes. Each completed pointer gesture is
one step. Keyboard range changes follow the browser's individual change events.

History restores the exact target sequence and selected moment. It keeps the
current physical scene, cutout locks, construction settings and comparison
baseline. The retained performance is marked as needing a new solve; a pending
solve cannot replace the restored targets. A cancelled move keeps its last valid
geometry and can be undone. Cancelling an unfinished drawing keeps the original
silhouette.

History lasts for the current session, with at most 32 retained edits and a
4 MiB serialized snapshot budget. A changed edit after Undo starts a new branch;
an unchanged or rejected edit keeps Redo available. New scenes and successful
project replacements clear history. Saving a project saves its current targets
and physical scene, without the session's Undo stack.

Focused consumer receiving uses a real browser and the maintained HTTP server:

```sh
SHADOW_STAGE_URL=http://127.0.0.1:4318 \
SHADOW_STAGE_EVIDENCE=/tmp/shadow-stage-history \
node tests/target-history-receiving.mjs
```

With the pinned previous source served separately, the baseline comparison uses
the same imported document, viewport and drag in both versions:

```sh
SHADOW_STAGE_BASELINE_URL=http://127.0.0.1:4319 \
SHADOW_STAGE_URL=http://127.0.0.1:4318 \
SHADOW_STAGE_EVIDENCE=/tmp/shadow-stage-history-baseline \
node tests/target-history-baseline.mjs
```

Both scripts require the receiving host's Playwright installation, preserve the
Chromium sandbox, and accept an existing Chrome binary through
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. No browser dependency is needed to run the
studio itself.
