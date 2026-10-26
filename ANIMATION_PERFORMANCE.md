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

## Editing latency check — 2026-10-25

Diagnosed editing with the user's TCG Title export: 101 artwork elements (75 paths, 17 groups, 9 shapes), 457 segments, 33 paths with 35 outline sections, maximum group depth four, and no rigs. The 4.39 MB export includes a 3.55 MB tracing reference. The private export is not a repository fixture.

The following medians compare the previous calculations with the new implementations on the same document, using Node 24.15.0 and 50 iterations. They measure model/projection work, **not browser input-to-paint latency**. Raw and cached outline strings matched exactly.

| Calculation | Before | After |
|---|---:|---:|
| Project all unchanged outlines | 6.263 ms | 0.050 ms |
| Move one point and project the scene's outlines | 6.727 ms | 0.357 ms |
| Read each outline three times | 15.321 ms | 0.097 ms |
| Resolve every element's local transform | 0.487 ms | 0.007 ms |

Layer names previously wrote into the live model on every keystroke. Artwork and bone rows now share a native draft input outside Angular's event handling, reentering on completion. Artwork renames commit once as metadata, avoiding animation invalidation and thumbnail generation. Unchanged outline projections are reused across canvas, gradient-bound, and export consumers; exact mutable inputs invalidate them during gestures. Nested group bounds no longer traverse a subtree twice just to resolve its automatic origin.

Rendered tests cover typing without Angular reentry, Enter/blur, Escape, IME, focus transfer, undo/redo, stale documents, and bone renames. Geometry tests cover projection reuse/invalidation and bounded nested-origin traversal. Browser checks on an imported copy cover rename cancellation/completion, one-step undo, and moving an outlined path anchor followed by exact rendered-geometry restoration.
