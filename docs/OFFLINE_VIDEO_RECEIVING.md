# Offline fixed-frame video: observed receiving

The opt-in command in [the usage guide](../tools/OFFLINE_VIDEO.md) passed one finite, independently authored whole-movie qualification from an extracted 52-file package. Source freeze was `eb6382f96913e2104fe06b92c67fe1ce8ba22ba6`. The completed course encoded two movies, decoded all 49 frames, checked two refusal cases and retained unchanged source identities. An earlier launcher stopped at resource admission before workspace creation, building or encoding; individual prior resource values were not retained. It was not an additional producer run.

The source exporter and projection helper remain separate from maintained browser export and use the unchanged project validator and physical projection. This receiving used Python 3.12.14, NumPy 2.3.5 and FFmpeg/ffprobe 6.1.1-3ubuntu5. Total qualification wall time was 12.973795938 seconds, including receiving work; it is descriptive cost, not a performance comparison.

## Complete-movie geometry and timing

The receiver derives trajectories and polygon masks analytically from two authored fixtures, without importing producer projection functions. It compares all decoded frames, using a prospectively fixed three-pixel boundary band and a 99.5% minimum foreground/background classification agreement outside that band. The actual outside-band agreement was **100% on every one of the 49 frames**. Boundary behavior remains visibly different from an ideal analytic mask and is reported separately below.

| Observation | Single moving piece | Crossing pieces |
|---|---:|---:|
| Decoded frames | 24 | 25 |
| Requested duration | 1 s | 1.05 s |
| Nominal duration, N/24 | 1 s | 1.0416666666666667 s |
| Container duration | 1 s | 1.042 s |
| Frame-count rounding relative to request | 0 s | −0.008333333333333304 s |
| Maximum absolute presentation timestamp error | 0.00033333333333340764 s | 0.00033333333333340764 s |
| Stream time-base tick | 0.001 s | 0.001 s |
| Worst whole-mask mismatch divided by mask union | 2.3191328459793294% | 2.697592335812429% |
| Maximum overlap-interior pixels | Not applicable | 4,248 |
| Incorrect overlap-interior pixels across course | Not applicable | 0 |

Both movies had strictly increasing frame timestamps within one recorded time-base tick of the fixed schedule. The crossing fixture exercises actual overlap, and its overlap interior remains foreground. These results do not claim exact edge masks: supersampling, rasterization and YUV conversion affect boundary pixels. The requested duration also need not equal N/24 or the container's tick-rounded duration.

The receiver checked every emitted physical/sample time and projected polygon against its independently derived trajectory, exact input and canonical scene identities, the complete producer source set, encoder/helper/probe success and actual movie hashes. Three preview PNGs per movie were checked against retained pre-encode RGB hashes. Full source-frame hashes provide provenance; they do not establish equality to decoded RGB. Lossless YUV encoding is not exact RGB preservation or browser-pixel equivalence.

## Refusal and publication behavior

An existing output directory was refused and its complete file inventory remained unchanged. A project lacking a physical scene was refused without publishing the requested destination; a sibling incomplete directory retained a failed receipt and the validator's reason. These are the two tested refusal cases, not a general interruption, concurrent-publication or resource-exhaustion qualification.

## Evidence identities

[The machine-readable public summary](../tests/offline-video/results.json) records source, fixture, scene, movie and raw receiving-artifact SHA-256 identities. It is a sanitized summary; original receipts remain separately retained without modification. The original result SHA-256 is `07ca579ece9b4b54514a93203a5c6c685f66a7f9a415662cad407fe09a607cf4`.

- Single movie SHA-256: `35adeb82869e71dfc59b417845b5d34900c74c4d07764909f14fe1b1e485f330`.
- Crossing movie SHA-256: `c547866901efaaeacf222ef9f5c2410144b57f16c0d059f518c19d374bc7b2ab`.
- Exporter SHA-256: `eacfb2e6612d0229bb461fa6b8d49ff264b032b57518708d8c6ac6a5e010a5c5`.
- Projection helper SHA-256: `ff6560878c4b591df4125c739d287d23d86df8008a6199b556c639ce26b7f17c`.
- Receiver SHA-256: `70d35876375d5e8c1eb19e203f3f9413deab6ad156b681e97711e14d30ed7512`.

## Limits and ownership

This is finite software/content receiving on two authored scenes, not a historical-data quality study or broad qualification of arbitrary projects, maximum durations or large scenes. It establishes neither artistic quality nor collision clearance, fabrication suitability or browser equivalence. It does not close the separate visibility-interrupted browser-export receiving gate.

Original product ownership and motion/presentation holds remain unchanged. No maintained browser, solver, history, schema or motion source was edited for this utility. This report is not approval for a public Release, deployment or external submission.
