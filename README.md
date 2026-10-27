# SHADOW STAGE

An editable shadow choreography studio. Author silhouette moments, fit one persistent planar cutout and moving point light, then inspect the physical scene and its projected shadow. The browser renderer computes the shadow from the scene geometry at every frame.

## Run locally

Node.js 20 or newer is required. There are no runtime npm dependencies and no install step.

```sh
node server.mjs
```

Open `http://127.0.0.1:4318`. The server binds to loopback by default. `HOST` and `PORT` configure its address; set them only for the intended deployment environment. Local target authoring, physical fitting, playback, project import/export, SVG snapshots and standalone performance export do not require a model credential or network call.

Choose a preset, edit a silhouette with its transform controls or on the stage, and select **Find the performance**. Scrub the timeline to compare the physical shadow with the target outline. Move the lamp or change cutout depth to see the physical cause of the shadow motion. An edited target requires a fresh solve to evaluate its new fit.

Save the project JSON to continue editing later. A standalone HTML performance embeds the scene and reconstructs the shadow without the studio server. An SVG is a single projected frame, not an animated scene.

## What the inverse fit actually does

The first authored silhouette supplies the fixed cutout shape. The fitter centers and scales it once, then estimates translation, rotation and scale for every target using cyclic correspondence and a least-squares similarity fit. Equal vertex counts use exact vertex correspondence; different counts use 64 samples along the closed polygon boundary. Opposite winding and a different starting vertex are considered.

This is a constrained single-template fit, not a joint optimization of a new cutout across all targets. A triangle and a square cannot both become exact shadows of this one planar cutout under the supported motion. Different shapes leave a measurable residual. There are no per-frame replacement meshes, and topology changes or multiple occluders are not supported.

The stage is the plane `z=0`, and fitted lights are at `z=5`. For a cutout world point `P`, light position `L`, and cutout depth `z`, the shadow is

```text
shadow.xy = L.xy + (5 / (5 - z)) * (P.xy - L.xy)
```

The implementation uses the scene's actual light height when playing or manually editing. Scale is realized by moving the cutout between stage and light. Translation is shared between lamp and cutout according to the motion-balance control. Valid scenes keep the cutout above the stage and at least 0.05 below every light key; the conservative global separation check guarantees valid depth throughout the bounded interpolation. Extreme requested scale ratios can be infeasible and are rejected.

Pose channels use bounded smoothstep interpolation, with zero velocity at each key and shortest-arc, cumulatively unwrapped angles. The tracks are continuous and C1 within the authored timeline. This does not guarantee a seamless repeat when the first and last poses differ.

## Reading fit evidence

The report distinguishes:

- **Authored-key residual:** projected physical boundaries compared with the actual authored silhouettes at their key times.
- **Interpolated-target residual:** physical shadows compared with correspondence-aligned, smoothstep-interpolated target boundaries at sampled times. That target interpolation is an authoring choice, not observed ground truth between keys.
- **No-solve baseline:** the first target held static and compared with the authored targets.
- **Geometric validity:** finite validated geometry and the depth constraints. This does not imply an aesthetically good performance or exact fit.

Residuals are symmetric sampled boundary-to-segment RMS distances in stage coordinates. They are not image overlap percentages or pixel-accuracy scores. The studio may express distance relative to its two-unit stage width. Independent receiving tests additionally use a raster-mask comparison for their own known translation fixture.

## Verify behavior

```sh
node --test tests/*.test.js
```

The native tests cover analytic ray projection, fixed-cutout fitting, incompatible-shape residuals, changed-input causality, motion sharing, continuity, validation, project custody and proposal validation. Independent receiving tests derive their own ray projection and compare a known translation fixture at held-out times; passing those checks does not validate all possible authored shapes or motion sequences.

`tests/browser-receiving.mjs` is a separate browser receiving harness. It requires a working browser automation environment; inspect its invocation and environment settings before running it. Node test success alone is not evidence that the rendered interface or downloaded player has been reviewed.

## Reproducible package

Python 3's standard library is sufficient:

```sh
python3 scripts/package.py
```

The command writes `dist/shadow-stage.zip`, `dist/shadow-stage.zip.sha256`, and a source-file `dist/SHA256SUMS`. An explicit file allowlist includes the runtime, source, tests and this documentation; it excludes credentials, environment files, logs and unrelated workspace contents. The archive contains a `shadow-stage/` directory and its own `SHA256SUMS`. File order, timestamps and permissions are fixed, and ZIP storage uses no version-dependent compressor. Identical input bytes produce an identical archive.

```sh
cd dist
sha256sum -c shadow-stage.zip.sha256
unzip shadow-stage.zip
cd shadow-stage
sha256sum -c SHA256SUMS
node --test tests/*.test.js
node server.mjs
```

No generated bundle, CDN, build-time transpilation or package installation is needed. To choose another output directory, use `python3 scripts/package.py --output /path/to/output`. A checksum confirms matching bytes; it is not a signature or an assertion of public-release qualification.

## Optional model suggestions

The server includes an optional Nebius proposal route. Local authoring is usable when no credential is configured. A returned suggestion must pass structural validation and explicit adoption before it changes authored targets. A configured route, a test fixture, and an actual model response are different evidence states. This document makes no claim that a model request has been executed or that a model-generated proposal has been qualified in use.
