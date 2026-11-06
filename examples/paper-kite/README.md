# Paper Kite

An original three-moment silhouette sequence for the bounded SVG importer. The kite lifts from the left, turns across the stage, and settles near the centre. These inputs were authored before execution; this example does not report fitting, rendering, performance, or qualification results.

## Use

From the repository root, with the importer and offline exporter dependencies available:

```sh
python3 tools/import_svg.py examples/paper-kite/sequence.json paper-kite-project
python3 tools/export_video.py paper-kite-project/project.json paper-kite-video
```

Use fresh output directories. The first command creates an editable project from the authored targets. The second passes that project to the offline movie exporter. Inspect the generated fit report: an imported target is an input to the fitter, not a guarantee of an exact fit for arbitrary artwork.

## Coordinates and motion

All three SVGs share `viewBox="0 0 400 300"`. The sequence sets `stageWidth` to `3.2`, so the importer centres the common coordinate frame, scales both axes uniformly by `3.2 / 400 = 0.008`, and reverses the SVG downward y-axis:

```text
stage x = (SVG x - 200) * 0.008
stage y = (150 - SVG y) * 0.008
```

Keeping the same viewBox preserves the authored translations and relative sizes across the moments; each shape is not independently fitted to its own bounding box.

The starting design is an asymmetric four-corner kite. Its three moments are exact translation, rotation, and uniform-scale transforms of one base polygon. Coordinates are baked into each SVG, rather than expressed through SVG transform attributes. The first moment is low and left, the middle moment rises and turns to the right, and the last moment settles back toward the centre. The manifest places these moments at normalized times `0`, `0.5`, and `1` over a four-second sequence, with `lightShare` set to `0.65`.

## Deliberately small SVG subset

Each file contains one black filled silhouette in the common viewBox. `start.svg` and `settle.svg` use a polygon; `rise.svg` uses a closed straight-line `M/L/Z` path. There are no strokes, styles, curves, embedded resources, or transform attributes. This example demonstrates the importer's explicit straight-edged subset; it does not promise general SVG or browser vector-rendering semantics.
