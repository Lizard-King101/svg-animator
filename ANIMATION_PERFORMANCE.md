# Animation Performance Benchmark

Performance is measured in Chrome development builds, not asserted as wall-clock CI tests.

## Workload

1. Import `SVG Samples/car_stress_test.svg` and open Animate mode.
2. In DevTools, record a Performance trace while playing and scrubbing for ten seconds.
3. Create a plan from `createSyntheticAnimationBenchmark()` and run `runAnimationBenchmark(plan, 600)` from `animation-benchmark.ts`. The default workload is 2,000 tracks and exactly 50,000 keys.
4. Record p50/p95 evaluation work, scrub input-to-paint, longest frame, and visible timeline DOM counts.

The synthetic workload deliberately contains 2,000 tracks and exactly 50,000 keyframes. It is large enough to expose accidental per-frame sorting, recursive target lookup, allocation churn, or full timeline rendering.

## Acceptance targets

| Measurement | Target |
|---|---:|
| Pure evaluation p95 | `< 4 ms` |
| Playback/scrub frame work p95 | `≤ 16.7 ms` |
| Scrub input-to-paint | `< 33 ms` |
| Timeline DOM | Proportional to visible rows and time range |

Frame evaluation must not sort keyframes, recursively search for targets, or allocate a new per-track array. Forward playback should advance active-segment cursors; seeks and reverse movement should use binary search. Timeline and graph surfaces should render virtual rows and only visible keys plus overscan.

## Recording results

Record a dated baseline before a performance refactor and a post-change run on the same machine/browser build. Keep trace files outside source control; they are machine-specific and too large for the repository. Record the following beside each trace:

| Field | Baseline | Post-change |
|---|---:|---:|
| Browser/build | | |
| Artwork/document | | |
| Evaluation p50/p95 | | |
| Frame work p50/p95 | | |
| Scrub input-to-paint | | |
| Longest frame | | |
| Visible row/key DOM nodes | | |

Unit and characterization tests still verify deterministic results, invalidation, segment lookup, renderer output, and compiler equivalence. The trace is the repeatable development benchmark; it is intentionally not a flaky wall-clock CI assertion.
