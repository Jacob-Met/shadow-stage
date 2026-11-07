# Export authored targets as editable SVGs

Export a saved project's authored silhouettes, edit them in an external tool, and import the sequence to create a new physical construction. This utility exports **targets**, not shadows sampled from the saved scene. It does not fit, render, or modify the input project.

## Export, edit, reimport

From the repository root:

```sh
node tools/export_svg_targets.mjs saved-project.json editable-targets
```

The output contains `sequence.json`, one `moment-00.svg`-style file per authored time, and `receipt.json`. Open or edit the SVG polygons while keeping their common viewBox and the supported minimal markup. Keep the sequence alongside its SVG files. Then create a new fitted project:

```sh
python3 tools/import_svg.py editable-targets/sequence.json refitted-project
```

Both destination directories must be new, with existing parent directories. Existing destinations are never intentionally replaced, including empty directories. Preserve the original saved project if you want to retain its physical construction.

Export requires Node (the repository requires version 20 or later), Python3 on PATH, and Linux with libc `renameat2`. Python is used only for atomic no-overwrite directory publication. Export does not require a browser or model provider. Reimport has the maintained importer's separate requirements and performs a new fit.

## Light share and construction

If the saved project has `lightShare`, export preserves it, including zero. Supplying `--light-share` when a saved value exists is refused, even if the supplied value is identical.

If it is absent, explicitly choose the preference for the future fit:

```sh
node tools/export_svg_targets.mjs saved-project.json editable-targets --light-share 0.65
```

The option accepts decimal values from 0 through 1. No light share is inferred from scene tracks. This preference does not encode the saved physical light trajectory.

Reimport defaults to a single cutout. For a sequence with `lightShare` exactly zero, you may instead request persistent square pieces:

```sh
python3 tools/import_svg.py editable-targets/sequence.json refitted-pieces --construction pieces --max-pieces 24
```

The maintained pieces importer accepts budgets 1–24, defaults to 24, and refuses nonzero light share. `--max-pieces` is not valid for single mode. Construction is a command option, not an additional sequence JSON field. Export does not reproduce a saved construction budget, cutout identities, locks or physical tracks; valid saved projects may have construction settings outside this importer's limits.

## Supported target subset and coordinates

The exporter first uses the maintained project parser, then applies a narrower SVG sequence contract:

- 2–16 authored targets, with strictly increasing times including exactly 0 and 1.
- 3–128 vertices per polygon; maintained validity checks still apply. Simple concave polygons are supported. Vertex order is preserved; nothing is simplified or resampled.
- Duration greater than zero and at most 120 seconds.
- Every target coordinate inside `x=[-1.6,1.6]`, `y=[-1.2,1.2]`, including the boundary.
- The saved title and authored times are preserved. The maintained parser limits title length.

A generally valid project can fall outside this subset: the project schema permits longer durations, more targets or vertices, and targets without both endpoint times. Export refuses these cases instead of modifying them.

Every output SVG uses viewBox `0 0 400 300`; the sequence uses `stageWidth: 3.2`. The common mapping is:

```text
svgX = 200 + 125*x
svgY = 150 - 125*y
```

The importer maps these back with `(svgX-200)*3.2/400` and `(150-svgY)*3.2/400`. This preserves position and aspect ratio in real arithmetic while reversing SVG's downward y direction. It does not independently center or stretch each silhouette. Floating-point roundtripping is not promised to preserve coordinate bytes exactly.

Before publication, the exporter reparses its emitted numeric points, applies that inverse arithmetic, and calls maintained `validateTargets`. A polygon close to a numerical validity threshold can be valid originally but invalid after roundtripping; it is refused with `SVG roundtrip geometry refused:` rather than silently perturbed. This check is not an executed Python reimport or a fitting guarantee.

## Editing compatible SVGs

The emitted files contain one direct black-filled polygon. External editors may add unsupported attributes or markup; save back to the maintained [SVG import subset](SVG_IMPORT.md) before reimporting. In particular:

- Keep the identical explicit viewBox across files and keep vertices inside it.
- Use one polygon, or one closed straight-edged path in the supported grammar.
- Do not add transforms, curves, holes, multiple shapes, strokes, styles, text, clipping, XML declarations or comments.
- Keep generated relative filenames and the sequence's exact schema. Times must remain ordered with endpoints 0 and 1.

Actual serialized limits are 64 KiB for the sequence, 256 KiB per SVG and 2 MiB total SVG content. The project input is bounded to 2 MiB. Editing can invalidate an otherwise valid exported bundle; reimport validates it again.

## What is retained, and what is not

Authored target polygons, title, duration, times and the selected light share survive this target-authoring workflow. A project with a null scene, a single-cutout scene or an articulated scene may supply those targets, provided the project and narrower subset validate.

The exported SVGs do not capture physical occluders, scene animation, locks, provider evidence or proposed-authoring history. Reimport creates a new fit and may retain residual error, especially for incompatible shapes. It does not guarantee the same scene, intermediate silhouettes, collision clearance, fabrication feasibility or seamless looping. See the [SVG importer guide](SVG_IMPORT.md) for construction-specific limitations.

## Receipts and failures

`receipt.json` records input identity, source hashes before and after export, selected light-share provenance, mapping, roundtrip validation, and hashes and sizes of the generated SVGs and sequence. Receipt hashes do not recursively include the receipt itself.

`inputSha256` and `inputBytes` describe the bytes actually consumed. The read is bounded to the project limit plus one byte. `inputComplete` is true for a confirmed complete admitted read; an oversized refusal does not claim a whole-file hash.

Failures after staging retain a sibling `.DESTINATION.partial-*` directory where possible. Stderr prints its exact path. Available output and failed receipts remain there for diagnosis; early argument or existing-destination refusals may occur before staging. Do not treat a partial directory as a successful export.

Publication uses a direct-argument Python3 subprocess with Linux `RENAME_NOREPLACE`, a 10-second timeout and a 64-KiB output cap. A failed publication retains its prepared receipt separately when the stage remains. If reporting fails after the stage has moved, the exporter reports an uncertain publication outcome: inspect the destination and do not blindly retry. There is no power-loss durability guarantee.

## Receiving status

The exporter and its focused receiving course are prospective. No successful receiving result is claimed here. Original course outcomes will be documented after the frozen course runs; this guide does not establish portability beyond the eventual tested Linux/Python3 route.
