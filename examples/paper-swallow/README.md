# Paper Swallow

A six-second study in a single angular silhouette: the swallow dips, banks upward, then returns to its opening pose. Unequal swept wings and a forked tail make the direction readable. The wings stay fixed relative to the body; this is a turning paper cutout, not an articulated flight simulation.

## Use from the repository root

Choose fresh output directories whose parent already exists:

```sh
python3 tools/import_svg.py examples/paper-swallow/sequence.json paper-swallow-project
python3 tools/export_video.py paper-swallow-project/project.json paper-swallow-video
```

Open `paper-swallow-video/performance.webm` with a VP9-capable video player. The importer writes the actual fitted project, normalized targets, fit report and input/source receipts. The exporter writes the movie, previews and frame metadata. Neither command overwrites an existing output directory. See the [SVG importer](../../tools/SVG_IMPORT.md) and [offline exporter](../../tools/OFFLINE_VIDEO.md) for requirements and the complete supported contract.

## Art direction and exact construction

The four SVGs use one black, twelve-vertex polygon in a common `0 0 400 300` viewBox. Every point is baked into the source: no SVG transform, curve, stroke, style or clipping is required. Each moment preserves the same vertex order and applies only a translation, a positive uniform scale and a rational rotation. [geometry.json](geometry.json) records the base outline and exact coefficients independently of any fitted result.

| Moment | Authored time | Center in SVG coordinates | Scale | Rotation (cos, sin) |
|---|---:|---|---|---|
| Start | 0 | (150, 125) | 1 | (1, 0) |
| Dip | 0.30 | (205, 170) | 4/5 | (24/25, 7/25) |
| Turn | 0.65 | (255, 125) | 9/10 | (4/5, -3/5) |
| Return | 1 | (150, 125) | 1 | (1, 0) |

The rotation convention is SVG's downward y axis. The dip turns clockwise; the turn banks counterclockwise. The final SVG is byte-identical to the first. The source uses stage width 3.2 and light share zero, keeping the fitted light's lateral share at zero. This avoids one equal-origin translation-drift term; it does not promise exact intermediate target interpolation.

At six seconds, the maintained fixed-24-fps exporter specifies 144 frames, physical samples `i/143` and presentation times `i/24`. The intermediate authored moments are not exact physical frame samples: indices 43 and 93 are nearest to 0.30 and 0.65 respectively. These are source-derived expectations, not observed movie results.

## Authorship and receiving boundary

This is newly authored example source. At this source checkpoint no importer, fitter, renderer, encoder or decoder has been run for Paper Swallow. Read the resulting fit report before treating the targets as realized. Broad margins were chosen for readability, but continuous framing, rendered appearance and artistic acceptance require the actual downstream result. Similarity correspondence is intentional; a fixed polygon is not a claim about real bird motion.
