# Import a small SVG silhouette sequence

From the repository root, run:

```sh
python3 tools/import_svg.py sequence.json new-output-directory
```

This opt-in local utility maps authored silhouettes into stage targets, calls one selected unchanged fitter once, and writes a normal saved project containing its actual physical scene and fit report. It requires Python and Node already installed, plus Linux `renameat2` for atomic no-overwrite publication. No browser, model provider or package installation is involved.

## Choosing a construction

The default command above keeps the existing single-cutout behavior. For an explicit bounded construction of persistent rigid square pieces, use:

```sh
python3 tools/import_svg.py sequence.json new-output-directory --construction pieces --max-pieces 24
```

Pieces mode accepts an integer budget from 1 through 24 and defaults to 24 when `--max-pieces` is omitted. It requires the sequence's `lightShare` to be exactly 0: the maintained pieces engine uses a fixed light. It does not silently ignore a nonzero light share. `--max-pieces` with the default or explicit `--construction single` is refused. These are command options; do not add construction fields to the sequence JSON.

Pieces mode calls `fitArticulated` with the selected budget, fixed `resolution: 32`, fixed `coverageTolerance: 0.01`, and the sequence duration. The budget is a maximum, not a promised piece count or achieved error. The unchanged engine approximates each silhouette with squares and assigns persistent physical cutouts across moments. It does not make a single polygon deform or guarantee an exact silhouette, collision clearance, fabrication feasibility, or intermediate target agreement. This opt-in route has not yet completed its new receiving course; no measured improvement is claimed here.

## Sequence contract

The UTF-8 JSON file has exactly these keys:

```json
{
  "format": "shadow-stage/svg-sequence-v1",
  "title": "Paper silhouette",
  "duration": 4,
  "stageWidth": 2.4,
  "lightShare": 0.65,
  "moments": [{"t": 0, "file": "start.svg"}, {"t": 1, "file": "finish.svg"}]
}
```

Use 2–16 strictly increasing finite times in [0,1], including both endpoints. Each moment contains exactly `t` and `file`. Filenames are resolved relative to the sequence file, must be local relative paths without `..`, and may not resolve outside that directory. Title is at most 300 characters; duration is in (0,120] seconds, stageWidth in (0,100], and lightShare in [0,1]. Booleans are not accepted as numbers. Sequence size is at most 64 KiB; each SVG is at most 256 KiB, and their total is at most 2 MiB.

## Deliberately small SVG subset

Each SVG must have exactly one direct shape and an explicit, identical finite `viewBox` with positive width and height across the sequence. Only the root's `viewBox` attribute is supported; the standard SVG namespace or no namespace is accepted. The shape is either:

- A `polygon` with a `points` attribute.
- A single closed straight-line `path` using `M`, `L`, `H`, `V`, `Z` or their relative lowercase forms. Repeated coordinate arguments and implicit line segments following the initial moveto are supported. Numbers use ASCII digits only. A single comma may separate numbers, but leading, trailing, repeated commas and commas next to commands are refused. Compact path boundaries at a new sign or decimal point, such as `10-20` or `.5.6`, remain supported; polygon and viewBox number lists require a whitespace or comma separator. Closure with `Z`/`z` is required; additional subpaths are refused.

The shape may additionally specify `fill="black"`, `fill="#000"` or `fill="#000000"`; omitted fill means black. No other attributes or nested elements are supported. Transforms, curves/arcs, holes, multiple shapes/subpaths, stroke, opacity, style, clipping, references, text and unsupported visual features are refused rather than approximated. XML declarations, comments, processing instructions, DOCTYPE and entity declarations are also refused. Save only the minimal silhouette markup, for example:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><polygon points="200,40 310,150 200,260 90,150" fill="black"/></svg>
```

Use 3–128 finite vertices entirely inside the viewBox. Artwork requiring viewport clipping is refused. One explicitly repeated closing point is removed; other repeated or self-intersecting boundaries and degenerate polygons are subject to unchanged target validation. Normalized coordinates must remain within ±100. A syntactically supported silhouette is not a guarantee that the fitter can realize it exactly.

## Mapping and fitting

For viewBox `(minX,minY,width,height)`, SVG point `(svgX,svgY)` maps to:

`x = (svgX − (minX + width/2)) × stageWidth/width`

`y = ((minY + height/2) − svgY) × stageWidth/width`

Both coordinates use the same width-derived scale, preserving aspect ratio while flipping SVG's downward y direction. No per-image recentering, stretching or score-based choice is performed.

All SVG files are parsed and mapped before the helper is invoked. The helper applies unchanged `validateTargets`, then calls either unchanged `fitScene` with the supplied lightShare and duration (single mode) or unchanged `fitArticulated` with the fixed options above (pieces mode). It roundtrips the resulting normal project through unchanged `serializeProject`/`parseProject`, retaining `construction: {mode, maxPieces}` and the actual physical scene. The sequence limit remains 16 moments in both modes.

Incompatible shapes can retain nonzero residual. `fit-report.json` is the actual selected fitter's report, not an invented success score or pixel/visual certificate. The single fitter's boundary RMS and the pieces fitter's finite-resolution raster union symmetric-difference error are different metrics and must not be compared numerically as if they measured the same quantity. A fair comparison needs the same independently specified measurement on both saved scenes. The pieces fitting grid resolution of 32 is distinct from the unchanged engine's final report measurement resolution. Interpolated target boundaries are an authoring choice, not observed intermediate ground truth.

## Output and failure evidence

The complete bundle contains `project.json`, `targets.json`, `fit-report.json`, `admitted.json`, retained raw input bytes under `inputs/`, helper stdout/stderr and `receipt.json`. Receipts include input/source hashes, helper exit, project/scene identities, roundtrip outcome and fixed-helper fit-call accounting. They also record `requestedConstruction`, the selected `construction`, `fitEngine` (`fitScene` or `fitArticulated`) and the exact `fitOptions` passed to that engine. These counts describe control flow, not independent dynamic instrumentation. Sources are checked before and after fitting. A helper invocation can fail target validation before reaching the fit. Invalid mode/budget combinations are refused before a temporary bundle is created; a nonzero pieces-mode light share is refused after sequence admission but before SVG parsing or helper invocation, retaining a failed receipt.

The destination must not exist and its parent must exist. A sibling temporary directory holds intermediate evidence; successful publication is atomic and does not replace even an empty destination created concurrently. Failure retains its temporary directory with a failed receipt and available raw inputs/logs. A failed late publication preserves the prior prepared receipt separately. The helper has a 120-second timeout. Process interruption outside Python cleanup may leave incomplete evidence. No power-loss durability guarantee is made.

To render an imported project, follow the [offline video guide](OFFLINE_VIDEO.md), for example:

```sh
python3 tools/export_video.py new-output-directory/project.json new-video-directory
```

Importing does not change maintained project schemas, browser/UI, solver mathematics, motion, history or existing demos. This contract is a restricted source workflow, not general SVG compatibility or a quality certification.
