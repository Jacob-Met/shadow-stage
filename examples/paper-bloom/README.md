# Paper Bloom — Bud, Flower, Fold

An original six-second block-art animation: a compact bud opens into a broad angular bloom, folds to the right and returns. Sixteen persistent square cutouts assemble and reconfigure the shadow. Some squares visibly separate from the flower and stem during transitions; the stepped artwork and changing assembly are part of the result.

## Open the included performance

Start the studio as described in the [main README](../../README.md). Choose **Open** in the studio header and select `examples/paper-bloom/project.json`. Use **Play performance** or the **Performance timeline** to inspect the motion, select physical pieces to edit them, and choose **Save project** to keep your version.

The included project is the original generated output. Its authored silhouettes, fixed cutout vertices and physical motion tracks remain editable.

## Work from the SVG artwork

The four SVG files share a 400 × 300 viewBox. `geometry.json` records their authored vertices. The sequence uses stage width 3.2, fixed light share zero, and normalized moments 0, 0.30, 0.65 and 1.

To make a new fit, run this from the repository root with a new destination:

```sh
python3 tools/import_svg.py examples/paper-bloom/sequence.json paper-bloom-project --construction pieces --max-pieces 24
```

Open the generated `paper-bloom-project/project.json`. The budget is a maximum; this original example used 16 pieces. To render the included saved physical scene into another new destination:

```sh
python3 tools/export_video.py examples/paper-bloom/project.json paper-bloom-video
```

See the [SVG import guide](../../tools/SVG_IMPORT.md) and [offline video guide](../../tools/OFFLINE_VIDEO.md) for dependencies and supported inputs.

## What was observed

The [receiving summary](RECEIVING.json) records the original import and six-second, 144-frame movie at 1000 × 714 pixels. An independent 256 × 192 observation grid found zero differing cells at all four authored moments, using the union of the actual physical projections. That is agreement on the sampled grid; it does not certify exact continuous outlines.

The native intermediate mask error was **0.14311100325455303**. Ordered thumbnails of every decoded frame and selected full-size frames were reviewed. The authored poses read clearly, and no blank frame or obvious clipping was observed. During transitions, an upper square detaches, the flower head can separate from its stem, and gaps appear between lower pieces. This is a moving block-art assembly, with an intentionally limited claim about intermediate fidelity.

One import/fit, one encode and one complete decode produced the retained result. The review did not repeat those operations. The original evidence and later visual reviews remain separate. Framewise inspection does not establish real-time playback quality, a seamless loop, collision clearance or physical fabrication feasibility.
