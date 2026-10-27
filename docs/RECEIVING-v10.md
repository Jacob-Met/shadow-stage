# SHADOW STAGE v10 — received comparison and finished footage

V10 adds a controlled construction comparison and a usable finished WebM export to the editable physical shadow studio. The package was tested after clean extraction, using its maintained server and actual browser entry point.

## Exact package and execution

- ZIP SHA256: `753103e58b9b6aabef3524d7d3a733b9f0d7c687090de368625bfec1b5a15d5c`
- Size: 289,024 bytes; 35 allowlisted files. Two independent package builds were byte-identical.
- Package: `/home/ubuntu/hamon-work/estate95a-20261027/delivery-v10/a/shadow-stage.zip`
- Native command `estate95a-package-receiving-v10`: 54 tests passed, no skips, exit 0.
- Browser command `estate95a-package-browser-v10`: 07:18:43.134–07:19:07.322 UTC, 2026-10-27; exit 0.
- Clean extracted runtime: 15 existing studio checks, nine comparison journeys, and complete video receiving passed.
- Chromium sandbox enabled; application CSP unchanged; no page errors.

The machine-readable report preserves all 35 source hashes, command receipts, and course summaries: [receiving-v10.json](receiving-v10.json).

## Consumer behavior

The author can retain a baseline, compare its initial/refined forms with the current initial/refined construction, scrub all four previews together, inspect actual refinement work, and explicitly adopt a result. A bounded session undo restores the prior construction. Comparison preserves the active project until adoption and rejects incompatible targets, duration, actual geometry counts and locks. Real-worker cancellation and stale-result invalidation were exercised on physical and duration edits.

A controlled physical-proposal response was used to verify baseline retention and prior-result invalidation. It explicitly records `executed:false`; no inference or model benefit is claimed. Shared settings, target-derived refinement domains and common observation windows support controlled sampled comparisons. They do not establish equal actual computational cost or universal geometric equivalence.

The video action freezes the physical scene before recording. It uses native manual canvas capture and MediaRecorder, then downloads the complete WebM. Before-capture and during-capture cancellation produced no file, stopped tracks and removed the recording canvas. Another export succeeded in the same tab. Importing scene B while scene A was recording preserved A in the movie and B in the studio.

## Actual video and independent receiving

- Actual movie: `delivery-v10/video-receiving/video-receiving/frozen-performance.webm`
- SHA256: `a7ae2c9e7d9aa9d54ddc690999a0e60c3f6953ae9ca9834ee04b97fa4abc798c`
- VP8 WebM, 61,491 bytes, 1000 × 714.
- Fresh playback completed at 3.027 seconds; FFmpeg decoded the entire file.
- 73 decoded frames from 72 frame requests; no duplicate presentation timestamps.
- Median positive timestamp gap: 49 ms; maximum gap: 77 ms. Observed span: 3.043 seconds, including the reported final interval.
- Independent pose/ray/union receiving checked selected decoded frames against every plausible request pose inside a declared 123.7 ms timing uncertainty. Worst foreground mismatch: 2.381%, below the predeclared 4% threshold. Both endpoints passed.

The clock bound includes measured 63.7 ms startup plus a diagnostic-informed 60 ms capture/encoding allowance. It is an explicit assumption for this receiving run, not a universal codec guarantee. The evidence establishes a complete playable export for the tested three-second, two-piece scene; it does not qualify constant frame rate, every frame's geometry, long duration, background tabs, every encoder error, or all resource-limit boundaries.

## Visual and review scope

Root inspected the actual desktop comparison, narrow comparison and fresh playback end-frame images. Desktop four-state cards fit in two columns; narrow cards remain readable and retain their controls. The tested movie's final two-piece shadow is fully visible. These stills do not establish artistic motion quality.

`service_recovery` independently reviewed comparison method and supplied source; `backup_recovery` independently designed/reviewed video receiving and reviewed supplied lifecycle code. Root executed the final package checks. Neither review is presented as an independent rerun or an audit of every final file.

An exact positional endpoint repair preserves authored stored values at segment endpoints in both the studio core and standalone player. It retains the original failing regression rather than weakening equality.

## Remaining product work

The transition experiment is deliberately outside this package. Its held-out silhouette error improved on two fixtures while its maximum projected motion step worsened. The next consumer increment will expose that tradeoff with synchronized preview, editable physical keys, explicit adoption and undo.

Actual NVIDIA inference through Nebius still requires an existing authorized route and quota handoff in [HAMON #1630](https://github.com/Jacob-Met/hamon/issues/1630). No public release or production deployment is part of this increment. The parent [product issue](https://github.com/Jacob-Met/shadow-stage/issues/1) remains open.
