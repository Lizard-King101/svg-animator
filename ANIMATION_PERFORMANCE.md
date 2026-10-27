# Animation Performance Benchmark

Measure production builds first and compare development builds separately. Timing targets are diagnostic measurements, not wall-clock CI assertions. Playback samples elapsed time on requestAnimationFrame; fpsHint is not an editor frame-rate cap.

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


## Rig playback overhaul — 2026-10-27

### Reproduction and diagnostics

The local arm export has seven bones, two dependent IK constraints, two weighted paths (21 bound points including handles), one derived outline, and 16 keys. It remains outside the repository. Sequential and backward sampling at 181 timestamps produced identical artwork. The original production build also completed a 15-second, 901-frame headless playback run without missed 60 Hz refreshes or long tasks: intermittent user-visible jitter was **not reproduced** in that baseline.

`RigEvaluationPlan` compiles setup once and evaluates into isolated reusable pose/point buffers. Bone indexes, constraint order, inverse rest/bind matrices and weight ownership are no longer reconstructed for each constraint or binding. The editor caches target/point references for one preview revision, and exported playback consumes the same kernel. SVG attributes, role-node lookups and timeline references avoid redundant work. FK/IK pointer previews coalesce to a display frame and release flushes the exact final sample before one commit.

The dense fixture exposed quadratic outline-distance searches plus repeated flattening and sample-object churn. Binary searches, reuse of complete-contour samples for bounds, and fixed-shape sample objects retain the same curve sampling and generated vertices. Eighty dense comparisons against the previous projection, including dashes and tapers, produced identical serialized projections. No quality reduction or authored-key changes were used.

Generate shareable synthetic scenes and run the model benchmark:

```sh
npx esbuild scripts/benchmark-rigs.ts --bundle --platform=node --format=esm --outfile=/tmp/svg-rig-benchmark.mjs
node /tmp/svg-rig-benchmark.mjs /tmp/svg-rig-fixtures /path/to/local-project.svg-animator.json
```

The optional final argument reads a local project without copying it into the repository. The generated scenes cover 1/3/10 independent rigs with dependent double IK, root movement, weighted curves, outlines, rigid attachments and nested clipping. `ten-one-moving` adds 500 static layers; `ten-dense` increases each rig from 32 to 320 bound points. These measure rig-count and geometry scaling separately; they do not add cross-armature parenting support.

Build and profile the complete editor in an isolated temporary Chrome profile:

```sh
npm run build
npx esbuild scripts/profile-editor.ts --bundle --platform=node --format=esm --outfile=/tmp/svg-profile-editor.mjs
node /tmp/svg-profile-editor.mjs dist/svg-animator/browser /tmp/svg-rig-fixtures/ten.svg-animator.json
# Optional separate run: CPU sampling, estimated allocations (including collected objects), GC events.
node /tmp/svg-profile-editor.mjs dist/svg-animator/browser /tmp/svg-rig-fixtures/ten.svg-animator.json --trace
# Development comparison; keep its output separate from the production bundle.
npx ng build --configuration development --output-path /tmp/svg-performance-development
node /tmp/svg-profile-editor.mjs /tmp/svg-performance-development/browser /tmp/svg-rig-fixtures/ten.svg-animator.json
```

The harness imports through the UI, calibrates the idle display interval, warms playback for two seconds, then measures 15 seconds. It records application stage timings, actual rAF intervals, missed refresh opportunities, long tasks, CPU/browser identity and CDP metrics. Trace runs add overhead and must not be used as uninstrumented FPS measurements. Allocation sampling is an estimate, not an exact byte count. Cold import/first-pose preparation is outside the steady-state timing window.

For manual diagnosis, append `&performance=1` to an editor URL and reload. `window.svgAnimatorPerformance.start(displayIntervalMs)`, `.report()` and `.stop()` control an opt-in ring of at most 1,800 samples and 1,800 long-task durations. Supply an idle measured interval (e.g. 1000/60 on a verified 60 Hz display); without it, missed-refresh fields are unknown, not zero. The observed playback median must never substitute for display refresh when a scene is overloaded. Application stages exclude asynchronous raster/GPU work; use the browser Performance panel for paint/compositor inspection.

### Acceptance and limits

Target p95 application work below half the measured display interval and fewer than 1% missed refresh opportunities on the arm. Preserve exact elapsed-time sampling at any refresh rate; do not skip authored keys, quantize poses, or lower outline fidelity. Browser timing results are machine/workload specific. The dense outline stress case can still exceed a frame budget despite faster rig math; a smooth ten-rig result is not a guarantee for arbitrary geometry complexity. Physical high-refresh display validation remains separate from the 60 Hz headless runs.

### Recorded results

Machine: AMD Ryzen 9 6900HX, 16 logical cores, Linux, Chrome Headless 149.0.0.0, 1600×1000 viewport, calibrated ~16.7 ms display interval. Application timings below are **uninstrumented by the CPU/heap profiler** but include the bounded stage timer. Runs are sequential, after warmup, with the editor visible in Animate mode. Headless timing does not establish physical high-refresh or input-to-photon performance.

| Production workload | Bound points | Frame work p50 | p95 | p99 | Missed refresh opportunities |
|---|---:|---:|---:|---:|---:|
| Local arm | 21 | 0.8 ms | 1.2 ms | 1.3 ms | 0.00% |
| One synthetic rig | 32 | 1.0 ms | 1.5 ms | 1.6 ms | 0.00% |
| Three moving rigs | 96 | 1.9 ms | 2.5 ms | 2.7 ms | 0.00% |
| Ten moving rigs | 320 | 3.8 ms | 4.7 ms | 5.3 ms | 0.00% |
| One moving / ten rigs + 500 static layers | 320 | 1.2 ms | 1.7 ms | 1.8 ms | 0.22% |
| Ten dense moving rigs | 3200 | 27.6 ms | 36.8 ms | 40.7 ms | 49.83% |

The local arm and ordinary ten-rig workloads meet the half-refresh application budget on this machine. The dense scene does not: it presents roughly 30 frames/second, with ~50% of 60 Hz refresh opportunities missed. Before the outline changes (already using compiled rigs), its p95 application work was 152.7 ms; after, 36.8 ms. The initial median-based refresh estimate incorrectly reported no misses for this overloaded case; the calibrated results above replace that estimate.

The same final arm workload in a development build measured 1.1 ms p95 / 1.3 ms p99 with no missed refreshes. The difference from production's 1.2 ms p95 is within run-to-run noise; this does not establish that development is faster. The original production arm baseline also had no missed refreshes, so this pass establishes more processing headroom, not a reproduced/fixed cause of the user's intermittent jitter.

An additional production arm trace (CPU and allocation sampling enabled) recorded 26 GC events, 39.8 ms total GC time and 4.8 ms maximum GC duration over 15 seconds. Allocation sampling (including collected objects) estimated 299.8 MB allocated; this includes browser-visible JavaScript work, not just rig math. Main-thread trace totals were 514.0 ms Paint and 519.5 ms Layout, with maxima of 0.58 ms and 1.39 ms respectively; these are trace categories, not GPU completion times. Its p95 application work was 1.4 ms; do not compare profiled FPS directly to normal runs. Traces and raw JSON remain outside source control.

Separate Node 24.15.0 kernel measurements use 300 warmup iterations followed by 600 samples. They exclude SVG generation, paint, UI, animation-channel sampling and first-plan compilation:

| Rig workload | Reference pipeline p95 | Compiled workspace p95 |
|---|---:|---:|
| Local arm, 21 bound points | 0.366 ms | 0.011 ms |
| Ten rigs, 320 bound points | 3.686 ms | 0.161 ms |
| Ten dense rigs, 3,200 bound points | 34.838 ms | 0.579 ms |

All six model workloads matched forward/backward artwork at all 181 sampled times. Deterministic tests additionally cover dependent ordering, unchanged authored poses, no steady-state setup cloning, unreachable targets, suspended IK, cross-rig preflight, attachment origins, render-node remounts, timeline zoom/remounts, bounded diagnostics and exact final-pointer/cancel behavior. Full-suite focus tests explicitly deliver focus events when headless Karma's document lacks native focus; product focus behavior is unchanged.

Final validation: 967 browser tests passed; production build, runtime golden fixtures, API report, runtime size budget (20,103 / 30,720 gzip bytes), minified/unminified/embedded web-export smoke checks, and `git diff --check` passed.
