# Paper Bloom — Bud, Flower, Fold

An original six-second angular paper-flower study. A compact bud opens into a broad angular bloom, folds to the right and returns. The stepped outlines are intentional. A construction of persistent square cutouts supplies the changing shadow; no cutout is meant to disappear.

## Authoring source

The four SVG files share a 400 × 300 viewBox. Their vertices are specified in `geometry.json` before fitting. The sequence uses stage width 3.2, fixed light share zero, and moments at 0, 0.30, 0.65 and 1.

From the repository root, create a new output directory with:

```sh
python3 tools/import_svg.py examples/paper-bloom/sequence.json paper-bloom-project --construction pieces --max-pieces 24
```

Choose **Open** in the studio and select the generated `paper-bloom-project/project.json`. The project retains its authored silhouettes and actual persistent physical pieces. Inspect the silhouettes, select pieces and scrub their motion before accepting the result.

To render that saved physical scene:

```sh
python3 tools/export_video.py paper-bloom-project/project.json paper-bloom-video
```

Both destinations must be new. See the [SVG import guide](../../tools/SVG_IMPORT.md) and [offline video guide](../../tools/OFFLINE_VIDEO.md) for dependencies and supported inputs.

## Receiving status

This is authored source before its first fit. No resulting piece count, silhouette error, exported movie or visual acceptance is claimed yet. The independent target specification and fixed consumer course will be frozen before product execution. The pieces engine can retain silhouette mismatch and may produce paths that differ from a chosen intermediate boundary morph. Collision clearance, fabrication feasibility and botanical realism are not established.
