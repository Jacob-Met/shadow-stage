# Video export interruption: source candidate awaiting browser receiving

## Intended user behavior

A recording attempt fails if the page is hidden at admission or becomes hidden before export finishes. Returning to the page does not rescue that attempt. The author receives the existing error feedback and can explicitly start another export; no automatic restart occurs.

The listener spans the initial scene digest, frame capture and final blob digest. Failure uses the existing recorder/track/canvas cleanup path and rejects instead of returning a completed movie. The app, physical projection, frame schedule, model calls, scene formats and motion controls are unchanged. A failure before the scene digest finishes has `sceneSha256: null`; this is an incomplete digest, not a completed source identity.

## Source and ownership

Base: `a08c90590e1aba0f1f827f034bfbb0344c220ff2`. Original video Git blob: `69447ad53643aad5ce880785b9efc391a4f4ccd6`.

| File | SHA-256 |
| --- | --- |
| Original `src/video.js` | `7492acb043d7cc126bd2db9e9c96fc121347f5056ffb5bf4f164db00a7f0d45a` |
| Candidate `src/video.js` | `6607476be6c647d462de9b1069ff09c94f7533d746d21efd9f2943c984c6da80` |
| `tests/video-visibility.test.js` | `5e5a734b0af3a17e09df336a4397516d480da12bbf33b664802a8acb0df4c64d` |

Scope is recorded in [issue 1 comment 6676778783](https://github.com/Jacob-Met/shadow-stage/issues/1#issuecomment-6676778783). Primary product ownership remains estate95a. The existing draft motion PR9, presentation handoff, target history and phone work remain separate. App and all motion/presentation source files retain their original bytes. The package allowlist adds only the new test and this receiving note.

## Observed source checks

The implementation author ran the focused simulated test once. It passed one grouped test with six cases: hidden start, transient hide/return during initial digest, interruption during capture, transient hide/return during final digest, a fresh foreground attempt, and cancellation during initial digest. Assertions include listener/resource cleanup and unchanged caller scene.

Root independently ran the new receiver against the original video source. It failed at hidden-start with `Missing expected rejection`; later baseline cases were not reached. The candidate then passed the maintained native suite: **79 tests passed, zero failed**, including the new grouped test. Source bytes remained unchanged. The author pass and root suite are separate executions.

Commands from the project root:

```sh
node --test tests/video-visibility.test.js
npm test
```

These tests use simulated DOM, recorder, digest and clock objects. They establish deterministic source behavior; they do not establish real tab visibility, encoder behavior, downloaded-file suppression or UI recovery. Independent static review found that the existing app's rejected-result path preserves its success/download distinction and clears its pending controller.

The retained baseline runner receipt initially attached the outer candidate hash map to both commands. A supplementary post-run readback verified that the executed baseline file exactly matches the original video bytes listed above. The raw receipt was retained unchanged; no baseline rerun or retroactive success claim was made.

## Remaining integration gate

Real-browser receiving remains pending because the available browser route could not initialize. No browser session or movie recording was started for this change.

Before integration, receive the ordinary Export flow with observed real visibility changes during capture and finalization, plus hidden-start and initial-digest controls. Verify failed status, absence of a completed-video download, ended tracks, removed temporary canvas, recovered Export control and preserved studio edits. A fresh explicit foreground export must yield a playable movie with matching receipt/file identity. Returning to a visible page must not automatically restart recording. Controlled digest delays must be disclosed separately from actual browser and encoder behavior.

This candidate does not claim background-tab video quality, constant encoded cadence, browser-pixel equivalence, artistic transition quality or release readiness. Normal source review and integration are separate from the existing public-release, deployment and submission holds.
