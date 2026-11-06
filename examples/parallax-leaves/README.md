# Parallax Leaves

**One light, three stationary cutouts.** This eight-second saved project begins as a single slender leaf. Moving one point light reveals three separate shadows, holds their arrangement, then brings them back together. The physical cutouts never move.

## Export from the repository root

With the dependencies in the [offline video guide](../../tools/OFFLINE_VIDEO.md) installed, run:

```sh
python3 tools/export_video.py examples/parallax-leaves/project.json parallax-leaves-video
```

The output directory must not already exist. Open `parallax-leaves-video/performance.webm` in a VP9-compatible player. The output bundle also contains three previews, the frozen scene, frame metadata and an export receipt. This ordinary export does not invoke a solver or model provider. Linux publication and encoder requirements are described in the tool guide; no dependencies are installed automatically.

## How the scene works

The light remains at height 5. The three cutouts sit at depths 1, 2.5 and 3.75. For a cutout at depth `z`, the magnification onto the screen is `m = 5/(5−z)`. Its projected point is `q = m·p − (m−1)·l`, where `p` is the physical point and `l` is the horizontal light position.

Each physical leaf and its center are scaled by `(5−z)/5`, making the three initial shadows coincide at projected center `(0.65, 0)` when the light is at `(0, 0, 5)`.

| Cutout depth | Magnification | Physical leaf scale | Physical center x | Shadow center at the separated pose |
|---|---:|---:|---:|---|
| 1 | 1.25 | 0.8 | 0.52 | (0.5125, −0.02) |
| 2.5 | 2 | 0.5 | 0.325 | (0.10, −0.08) |
| 3.75 | 4 | 0.25 | 0.1625 | (−1.00, −0.24) |

The light moves from `(0, 0, 5)` to `(0.55, 0.08, 5)` and back. Identical light keys create an initial hold through normalized time 0.15 and a separated hold from 0.65 to 0.8. These correspond to authored landmarks at 1.2, 5.2 and 6.4 seconds. Displayed transitions are sampled onto the exporter's fixed frame schedule; these authored landmarks are not promises of an exact displayed transition timestamp.

The eight-vertex leaves have matching initial projected height 1.7 units, approximately 442 pixels under the existing camera. All three cutouts have identical pose keys at times 0 and 1, a three-piece construction budget and valid lock IDs. Only endpoint target outlines are authored; there is no intermediate fitting or target-ground-truth claim.

## Observed creative result and limits

The first export produced **192 frames at nominal 24 fps, lasting eight seconds**. One independent full decode passed, with timestamp error within the observed one-millisecond time-base tick. Decoded endpoint frames matched, as did the checked initial-hold and separated-pause frames.

Review of eight actual decoded frames showed a readable initial/final single silhouette, opening and return, and three distinct separated silhouettes during the pause. No clipping or blank frame was visible in those selected frames. This is selected-frame creative acceptance, not browser playback, human inspection of every frame, or general artistic certification.

This example is separate from the exporter's [finite two-movie receiving course](../../docs/OFFLINE_VIDEO_RECEIVING.md). Lossless YUV encoding is not exact RGB preservation or browser-pixel equivalence. The project does not certify fabrication, collision clearance or behavior of arbitrary other scenes. A later export on a different toolchain need not reproduce identical encoded bytes.
