# Paper Swallow — Dip and Return

A six-second study in a single angular silhouette: the paper bird dips, banks upward, then returns to its opening pose. Unequal swept wings and a forked tail give it a direction. The wings stay fixed relative to the body. Its rigid shape can also read as a paper aircraft; this is a paper-cutout study, without a biological-flight claim.

## Open the ready-made project

From the repository root, run `node server.mjs` and open `http://127.0.0.1:4318`. Choose **Open** in the header and select [project.json](project.json) from this directory. Use the play button (**Play performance**) or scrub the **Performance timeline** to inspect the physical shadow and authored outlines. **Save project** downloads your editable version.

The included project is the original output of the SVG import described below, preserved byte for byte. Its parser roundtrip and use by the offline exporter were observed. These UI instructions follow the maintained controls; this example's receiving course did not exercise browser opening or playback.

## Author from the SVGs

Choose new output directories whose parent already exists:

```sh
python3 tools/import_svg.py examples/paper-swallow/sequence.json paper-swallow-project
python3 tools/export_video.py paper-swallow-project/project.json paper-swallow-video
```

Open `paper-swallow-video/performance.webm` in a VP9-capable player. The importer retains the normalized targets, actual fit report, editable project and input/source receipts. The exporter retains the movie, previews and frame metadata. Neither command overwrites an existing output directory. See the [SVG importer](../../tools/SVG_IMPORT.md) and [offline exporter](../../tools/OFFLINE_VIDEO.md) for requirements.

## Art direction and construction

The four SVGs use one black, twelve-vertex polygon in a common `0 0 400 300` viewBox. Coordinates are baked into each file. Every pose preserves the same vertex order and applies a translation, positive uniform scale and rational rotation. [geometry.json](geometry.json) records the authored outline and coefficients; [expected.json](expected.json) records coordinates independently derived before the SVGs were inspected.

| Moment | Normalized time | SVG center | Scale | Rotation (cos, sin) |
|---|---:|---|---|---|
| Start | 0 | (150, 125) | 1 | (1, 0) |
| Dip | 0.30 | (205, 170) | 4/5 | (24/25, 7/25) |
| Turn | 0.65 | (255, 125) | 9/10 | (4/5, -3/5) |
| Return | 1 | (150, 125) | 1 | (1, 0) |

SVG y points downward: the dip turns clockwise and the bank counterclockwise. Return is byte-identical to start. Stage width is 3.2 and light share is zero. This removes lateral light movement, while depth realizes the authored scale changes. It does not promise exact intermediate target interpolation.

## Observed receiving

The [fixed plan](receiving-plan.json) and all inputs were frozen at `091c1258d4a7e8eb117b9b859ec5ea4dcfaf2d73` before the first course. [RECEIVING.json](RECEIVING.json) records the actual result and its limits:

- One import/helper fit, one encode and one complete decode; no prior regression course was repeated.
- 144 frames at 1000 × 714, 24 fps and six seconds. Physical samples are `i/143`; presentation times are `i/24`.
- Maximum authored corresponding-vertex error: approximately `1.76e-16` stage units. All sampled geometry and decoded foreground framing checks passed.
- Interpolated-target RMS remains `0.012919459632490351`. The authored poses match closely; the chosen intermediate boundary morph remains a different comparison.
- Independent data review passed. Root and an independent reviewer inspected all 144 decoded thumbnails and two full-size frames, observing the intended dip, bank and return without blank or visibly clipped frames.

The nearest movie samples to the intermediate authored moments are 43 and 93; neither is an exact key-time sample. Four selected PNGs and four ordered contact sheets came from the original decode. Their inspection is framewise evidence, not real-time playback or an artistic guarantee. Source-only status fields in the frozen geometry, expectation and plan files describe their original pre-execution checkpoint.
