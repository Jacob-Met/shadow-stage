# Target-edit Undo/Redo receiving

## Outcome and current gate

The target-history candidate passes the native and real-browser functional checks below, including comparison with maintained main. **Actual desktop and narrow pixel review is still pending.** Keep the pull request in draft until those pixels have been reviewed and the normal integration process is satisfied.

This is the complementary task `shadow-stage-target-edit-history-3093ab`, owned by `estate-3093ab-20261027`. Primary SHADOW STAGE ownership remains `estate95a-20261027`; the parent physical-performance outcome remains open. The [native claim](https://github.com/Jacob-Met/shadow-stage/issues/1#issuecomment-6436480967) and [primary-owner integration note](https://github.com/Jacob-Met/shadow-stage/issues/1#issuecomment-6436787791) establish the boundary.

## Source and package identity

- Base: `2ef7d2222331106bc99c7fb29ff8eb91803546e9`.
- Qualified `app.js` Git blob: `f2d813be25003dcde55a1092b0230d9164f35746`.
- Qualified `src/target-history.js` Git blob: `6536cf0f1486059ffc04090ce34e03a86154f899`.
- ZIP SHA-256: `e2c5f1ed624b4d82b7c1eecd62f2af4b5f278867a8f0fd5d144174c5d49509b6`.
- ZIP: 390869 bytes; 43 allowlisted source files plus the generated manifest.
- Two builds produced identical ZIP bytes. Every extracted manifest entry was checked.
- All 49 upstream blobs were checked against GitHub before applying this delta. The combined source contains 53 blobs; the two receiving documents added for publication are outside the package allowlist.
- The authoritative blob map and original receiving receipt are in [receiving-target-history.json](receiving-target-history.json).

The exact tested source was reconstructed in a separate publication worktree on ThinkPad and reproduced the same ZIP hash. This protects publication from older operations with unresolved admission state in the first worktree.

## Behavior added

Canvas move, point and completed drawing gestures, transform-control gestures, and add/remove moment operations gain Undo/Redo. Each accepted gesture is one history boundary. Snapshots restore exact target geometry, key times, ordering and active selection; navigation alone is not a new edit.

History is target-only. It restores directly rather than replacing the project, retaining the current physical scene, locks, construction settings and comparison baseline. Playback stops and retained physical fits become dirty. Pending solver work is invalidated. The reconciliation with the new transition code assigns accepted targets before calling `cancelSolve()`, so invalidation sees the new target signature.

A changed edit after Undo discards the old redo branch. Invalid and no-op edits preserve redo. Cancelled unfinished drawings preserve their original targets; cancelled move/point gestures retain and commit the last accepted geometry once. Slider commits preserve the existing cumulative transform baseline. Successful project replacement clears history; rejected import does not.

History retains at most 32 total entries and 4 MiB of serialized snapshots. Undo/Redo transfers entries without growing retained payload. Stale geometry boundaries clear the chain safely. Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, and Ctrl+Y work outside editable controls.

## Executed verification

Root ran these checks through Renpō on the unprivileged receiving host, with Chromium sandboxing enabled and the application CSP intact. Retained workers reviewed source or evidence; they did not independently execute the tests.

| Check | Result |
| --- | --- |
| Combined extracted-package native suite | 77 passed, 0 failed |
| Target-history browser suite | 11 clusters passed |
| Existing transition browser suite | 17 passed |
| Same-fixture baseline comparison | Passed |
| Reproducible packaging | Two identical builds |
| Actual pixel assessment | Pending |

The browser coverage includes real canvas/drawing edits, pointer cancellation, multiple range input events per gesture, intermediate transform states, exact moment/selection restoration, redo/no-op branching, keyboard ownership, physical-scene custody, real pending-worker cancellation, rejected and accepted import, New, and a 390px viewport.

The fair comparison served baseline `2ef7d222` and the freshly extracted candidate at the same 1440×1000 viewport. Each imported the same fixture and received the same 12-step canvas drag. Both produced identical changed targets. Baseline retained the edit after Ctrl+Z; the candidate restored the complete original targets in one Ctrl+Z. Physical scene data remained unchanged in both.

- Original targets: `0a9b9a6d5a3946c2126b6a56fe9f69dd666a7cef702997eb48bc8dc699276359`.
- Edited targets: `5cbcb95b8903361675c618166ae668cc0c376ac39850b39b8a50bc08d34cf72b`.

### Exact scope of the claims

The editable-control test establishes that the application's target-history handler leaves the tested shortcut events unconsumed. It does not demonstrate native browser text undo. The locked fixture contains one nonempty locked piece in articulated mode, with `maxPieces: 1` and `lightShare: 0.31`; this check does not establish multi-piece custody. The target edit plus Undo sequence collectively terminates the pending real worker; the test does not isolate Undo as the sole cancellation cause.

Automated control visibility and interaction results do not establish visual composition or readability. No actual model inference, collision/fabrication certification, public release, or completion of the parent product is claimed.

## Reproduction and original receipts

The completed receiving operation is `estate-3093ab-current-main-receiving-002`, owned by `node-903c4f10ea2c1b62a63348ff2b40705e`, incarnation `8824dba795253939b7e2a4e0c75a11e4`, binding generation 2. Its native command request SHA-256 is `b1395204db362de165573672bb206dc16211e13f0ca7e052e60167544c613598`. It ran from 2026-10-27T08:05:13.024932105Z to 2026-10-27T08:05:37.910433227Z and exited 0.

Commands in the reconstructed candidate and then its extracted package:

```sh
python3 scripts/package.py --output ../v3-build-a
python3 scripts/package.py --output ../v3-build-b
node --test --test-concurrency=2 tests/*.test.js
node tests/target-history-receiving.mjs
node tests/target-history-baseline.mjs
node tests/transition-receiving.mjs
```

The original script passed the sorted native test paths explicitly. The browser scripts received `SHADOW_STAGE_URL`, `SHADOW_STAGE_BASELINE_URL` and separate `SHADOW_STAGE_EVIDENCE` directories. Both loopback servers used `PORT=0`; receiving terminated them after testing. Playwright resolved from `/home/ubuntu/.npm/_npx/f0a362733743bae2/node_modules`, with executable `/home/ubuntu/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`.

Receiver root: `/home/ubuntu/work/jobs/estate-3093ab-history-independent-receiving-001`.

- Exact candidate source: `v3-candidate`.
- Served package: `v3-extracted/shadow-stage`.
- Native log: `v3-native.log`.
- History receipt/screenshots: `v3-consumer/receipt.json`, `01-canvas-history.png`, `02-solver-cancellation.png`, `03-narrow-history.png`.
- Baseline comparison: `v3-baseline-comparison/receipt.json`.
- Existing transition receipt: `v3-transition-regression/transition-receiving.json`.

Verified publication copy: `/var/tmp/estate-3093ab-shadow-target-history/qualified-source`. Matching package: `/var/tmp/estate-3093ab-shadow-target-history/qualified-package/shadow-stage.zip`. The reconstruction operation is `estate-3093ab-qualified-publication-reconstruct-001` on owner `node-2b8c9803b6069b758adef320e07b48ed`.

## Preserved failures and open work

The initial old-base browser harness used Playwright polling incompatible with the application's CSP and failed before product assertions. Only the two receiving scripts were changed to the repo's existing evaluate-polling pattern. CSP was preserved. A later refreshed candidate integrated main `2ef7d222` and passed the checks above.

Retrieval of the existing receiver screenshots currently fails on gateways that do not have the original owner configured as a peer. The original owner and operation handles remain authoritative. A separate unprivileged ThinkPad rerender reached Chromium's “No usable sandbox” boundary; no sandbox, AppArmor, user-namespace, setuid, peer-trust or SSH host-validation settings were weakened. That failed rerender is not receiving evidence.

Next: retrieve and inspect the existing desktop/narrow images through an authorized original-owner route, or receive the exact package on an existing suitable sandboxed browser host; record the actual visual assessment; refresh main and ownership; verify the exact published head; finish normal review/integration/merge. The primary owner can perform receiving through their already working route if necessary.

Retained review identities are `/root/source_recovery` (source/event review), `/root/consumer_review` (acceptance evidence/limits), and `/root/service_route` (baseline probe design and evidence assessment). Root executed the checks. Publication identity is verified separately from those scoped reviews.
