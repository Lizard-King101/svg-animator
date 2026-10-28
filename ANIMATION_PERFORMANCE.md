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

## WebGPU investigation

The first renderer experiment is isolated from the editor and measures derived solid outlines only. See [RENDERER_OVERHAUL.md](RENDERER_OVERHAUL.md) for commands, coverage, backend limitations and the staged integration plan. Default headless Chrome exercised the no-adapter fallback; explicit SwiftShader Vulkan exercised GPU correctness. Software texture readback passes, but its headless page screenshots show corrupted canvas presentation. The initial forced headless hardware Vulkan run lost its device during verification. The subsequent user-supplied desktop hardware result is recorded below. Lab submission timings exclude GPU execution and cannot replace the complete editor baseline above.

### Desktop hardware result supplied by the user

Chrome 149 on Linux, NVIDIA Ampere (`isFallbackAdapter: false`), 1380×1104 canvas pixels, devicePixelRatio 2. The first lab pipeline measured 180 samples per backend on the `10,40` workload with ~16.7 ms idle refresh calibration. These are user-supplied measurements, not the earlier headless environment. They validate hardware feasibility for the outline-only workload; they do not establish complete-scene parity or GPU execution time.

| First-pipeline result | SVG | WebGPU |
|---|---:|---:|
| Application work p95 | 27.0 ms | 18.7 ms |
| Geometry preparation p95 | 24.1 ms | 17.6 ms |
| Submission p95 | 3.2 ms | 1.0 ms |
| Application work p99 | 29.3 ms | 33.9 ms |
| Median rAF interval | 33.2 ms | 16.7 ms |
| Missed refresh opportunities | 34.07% | 2.17% |

Percentiles are calculated independently; stage p95 values must not be summed or treated as the same frame. Frame intervals are rAF cadence, not a measurement of GPU completion or physical presentation.

### Packed outline preparation — 2026-10-27

A Node CPU profile of 360 dense scene evaluations identified taper resampling, stroke-join construction and GC as substantial work. The shared kernel now evaluates each cubic sample once, merges the small set of taper positions into ordered source samples instead of rebuilding/sorting/searching all sample distances, reuses adjacent segment directions, and emits only needed join vertices. Bounds scan directly without temporary coordinate arrays. The uniform sampling count and interpolation arithmetic remain unchanged.

The GPU lab consumes synchronous rounded polygon emission directly into reusable triangle-fan buffers. It skips section strings and source bounds for this solid-outline workload and avoids creating an intermediate rounded polygon object graph. Live contour references and drawing objects remain stable for a scene lifetime. Replacing a scene uses new draw identities so identical local revisions cannot preserve stale GPU buffers. The report identifies this implementation as `packed-outlines-v2`; packing time now belongs to its geometry stage, so compare total application time rather than submission time alone across versions.

Same host as the original local measurements, Node 24.15.0, 10 dense rigs, 120 warmup + 240 measured samples. Rig evaluation occurs before each measured geometry call. A saved pre-change bundled scene was measured before modification; the updated scene was measured with the same loop. This is CPU geometry preparation only, excluding browser/DOM, upload and GPU work.

| CPU geometry output | p50 | p95 | p99 |
|---|---:|---:|---:|
| Pre-change numeric polygons | 16.23 ms | 19.91 ms | 25.15 ms |
| Optimized direct packed buffers | 7.33 ms | 10.09 ms | 12.46 ms |

A separate alternating-order comparison using the optimized kernel measured numeric output at 11.37 ms p95 and direct packed output at 9.37 ms p95. The difference between that and the independent 10.09 ms run illustrates timing variation. Do not apply these Node numbers directly to the user's NVIDIA browser result. Sampling profiles of the same 360-call workload recorded 373 versus 181 GC samples; this is sampling evidence, not an allocation-byte measurement.

Reproduce current numeric-versus-packed CPU timing and seek/vertex parity:

```sh
npx esbuild scripts/benchmark-outline-pipeline.ts --bundle --platform=node --format=esm --outfile=/tmp/svg-outline-pipeline.mjs
node /tmp/svg-outline-pipeline.mjs
# Optional: compare against an outline.ts bundle saved before a refactor.
node /tmp/svg-outline-pipeline.mjs /absolute/path/to/pre-change-outline.mjs
```

The saved pre-change kernel matched all 810 characterization cases exactly, including metadata and serialized outline vertices. Cases cover closed/open contours, cap/join combinations, tapers, dashes and reveal progress. Packed float32 vertices also match ordinary numeric packing at fractional, forward and backward seeks. Focused tests cover buffer reuse/growth, invalid input, scene replacement and cache lifetime. GPU texture checks exercise both polygon and packed inputs.

Validation: 59 focused browser tests, 19 GPU texture comparisons on SwiftShader, renderer type checking, production build, runtime golden fixtures/API report, runtime size budget (20,352 / 30,720 gzip bytes), web-export smoke tests and `git diff --check` pass. Full-suite and physical-display verification remain part of the later rollout gate. Rerun the desktop lab with the same workload, resolution and browser to measure the actual hardware effect.

### Desktop confirmation: packed outlines v2

User-supplied result, 2026-10-27: Chrome 149 / Linux, NVIDIA Ampere non-fallback adapter, 1380×1104 backing pixels, DPR 2, workload `10,40`, 180 samples, calibrated refresh 16.7 ms. Confirmed report marker `packed-outlines-v2` (the earlier unmarked rerun was an old server bundle).

| Metric | Initial WebGPU | Packed v2 WebGPU | Packed v2 SVG |
| --- | ---: | ---: | ---: |
| Application p50 | 15.8 ms | 8.0 ms | 16.5 ms |
| Application p95 | 18.7 ms | 9.5 ms | 18.9 ms |
| Application p99 | 33.9 ms | 10.0 ms | 21.5 ms |
| Geometry p95 | 17.6 ms | 7.0 ms | 15.2 ms |
| Submission p95 | 1.0 ms | 2.1 ms | 3.2 ms |
| Missed refresh opportunities | 2.17% | 0% | 6.74% |

WebGPU frame intervals p50/p95/p99: 16.7/16.8/16.8 ms. Application p95 is about 49% below the initial run, although submission p95 increased; geometry remains the largest CPU stage. Zero misses describes this short sample, not a universal guarantee. CPU time excludes GPU execution and is still above the half-refresh headroom target (~8.35 ms). This remains an outline-only lab, not full-scene editor acceptance.

### Worker lab measurement contract

`worker-outlines-v3` adds a third backend. The main-thread SVG/WebGPU timings retain their prior scope. Worker results separately report main-thread dispatch, worker evaluation/geometry/submission, request-to-response latency, completed versus superseded requests, main-thread RAF intervals, and acknowledgement intervals. No expanded geometry crosses threads during playback. Acknowledgement means CPU submission completed; it does not measure physical presentation or GPU completion. In particular, low main-thread missed-refresh counts must not mask slow or superseded worker frames.

The local SwiftShader smoke run (one rig, four segments, 90 measured requests) completed all 90 with no superseded previews; p95 dispatch 0.1 ms, worker processing 0.7 ms, response latency 1.0 ms. This is protocol/instrumentation evidence on a software adapter, **not** a hardware performance comparison. Desktop NVIDIA dense-workload measurements are pending.

### Desktop confirmation: worker outlines v3

User-supplied NVIDIA Ampere / Chrome 149 Linux run, `worker-outlines-v3`, workload `10,40`, 1380×1104 pixels, DPR 2, 180 samples and 16.7 ms refresh. Both main-thread and worker adapters reported non-fallback NVIDIA Ampere.

| Metric | Main-thread WebGPU | Worker WebGPU |
| --- | ---: | ---: |
| CPU processing p50 | 7.7 ms | 8.1 ms |
| CPU processing p95 | 9.4 ms | 9.2 ms |
| CPU processing p99 | 10.8 ms | 9.6 ms |
| Geometry p95 | 6.9 ms | 6.8 ms |
| Submission p95 | 2.1 ms | 1.9 ms |

Worker main-thread dispatch p50/p95/p99: 0/0.1/0.2 ms; response latency 8.4/9.5/10.0 ms. All 180 requests completed; none were superseded. Main-thread missed refreshes were zero for both GPU modes. Worker acknowledgement intervals were 16.6/18.3/19.1 ms; these are not compositor presentation intervals. The result supports moving CPU work off the main thread without an appreciable increase in request latency, not a large reduction in total CPU cost. SVG application p95/p99 were 20.5/33.0 ms, with 8.16% missed refresh opportunities in the same run.

`scene-clips-v4` adds matrix uniforms and optional nested mask passes to the shared renderer. Existing timed workloads remain the same outline-only scenes; the new static scene preview/verification exercises ordered paint and clipping separately. Hardware timings for this renderer revision have not yet been collected. Clip textures retain four samples per pixel and have a 256 MiB aggregate mask budget, up to 32 masks and depth 16; excessive workloads fail explicitly rather than dropping clips. Mask passes currently rerender each frame. Mask caching/atlasing and complete scene performance measurement remain future work.

### Animated scene workload (`animated-scenes-v5`)

The lab now exposes 1/3/10-rig supported polygon scenes with weighted fills/strokes, rigid attachments, nested static/moving clips and dependent IK. Scene structure and binding references compile once; evaluation updates only changed geometry and attachment matrices. The original outline workloads remain unchanged in scope. Experimental WebGPU is off by default in the lab and must be enabled before GPU measurements.

The scene SVG reference serializes editor markup and rebuilds its subtree per frame. Its reported time must not be presented as the production editor SVG renderer's cost or used to claim an editor speedup. Main-thread GPU and worker CPU timings remain directly instrumented; worker completion still means submission acknowledgement rather than display presentation. Hardware results for these animated scene workloads are pending.

The mask allocation limit is currently significant: 20 masks × 1380 × 1104 × 4 samples × 4 bytes ≈ 465 MiB, above the 256 MiB aggregate mask budget. The ten-rig scene therefore explicitly falls back at that backing resolution. It passes correctness tests at smaller surfaces. This is an experimental renderer limit to address through mask lifetime/allocation work, not through quality reduction.

Local instrumentation check: `npm run renderer:lab -- --smoke --software-gpu --require-gpu --rig-scene` completed 90 samples for one animated scene rig using SwiftShader. Main-thread WebGPU application p95 was 1.6 ms. Worker processing p95 was 2.0 ms, dispatch p95 0.1 ms and response latency p95 2.6 ms; all 90 requests completed with none superseded. Worker acknowledgement intervals p50/p95/p99 were 16.7/19.1/23.4 ms. This verifies the animated measurement path on a software adapter; it is **not a hardware performance result, editor speedup baseline or physical presentation measurement**.

### Clip lifetime reuse (`pooled-clips-v6`)

The previous ten-rig mask-budget blocker is removed at 1380×1104. A cached lifetime schedule now interleaves mask generation and painter-ordered artwork, reusing textures only after their final consumer. At this resolution the fixture's 20 masks require **2 live textures: 48,752,640 bytes / 46.5 MiB**, down from **487,526,400 bytes / 465 MiB** (90% less logical mask storage). Four-sample antialiasing and output resolution are unchanged. Main-thread and worker benchmark results expose `clipMemory: { textures, bytes }`; these values exclude other render surfaces and driver overhead.

SwiftShader verification passed seven SVG/GPU timestamp comparisons and seven worker/main-thread readback comparisons for ten rigs at that exact resolution, including backward seeks and loop boundaries. Smaller 1/3/10-rig scenes, shrinking surfaces, empty scenes and rejection/recovery for a truly excessive live allocation were also exercised. User-supplied hardware CPU timings are recorded below; GPU execution/presentation costs remain unmeasured. Color passes now store/load multisample contents between mask batches; a matched comparison is needed before claiming a throughput improvement. Mask passes still redraw each frame, and arbitrary overlapping clip lifetimes may require more than two textures.

### Desktop confirmation: pooled clips v6

User-supplied NVIDIA Ampere / Chrome 149 Linux run, `pooled-clips-v6`, workload `rig-scene,10`, 1380×1104 pixels, DPR 2, 180 samples and 16.7 ms calibrated refresh. Main-thread and worker adapters both reported non-fallback NVIDIA Ampere.

| Metric | Main-thread WebGPU | Worker WebGPU |
| --- | ---: | ---: |
| CPU processing p50 | 1.4 ms | 1.4 ms |
| CPU processing p95 | 2.0 ms | 1.8 ms |
| CPU processing p99 | 2.2 ms | 2.0 ms |
| Geometry p95 | 1.2 ms | 1.0 ms |
| Submission p95 | 0.6 ms | 0.6 ms |
| Allocated mask textures | 2 | 2 |
| Logical mask bytes | 48,752,640 | 48,752,640 |

Worker dispatch p50/p95/p99 was 0/0.1/0.2 ms; response latency was 1.7/2.2/2.3 ms. All 180 requests completed with zero superseded previews. Main-thread missed refresh opportunities were zero in both GPU modes. Worker acknowledgement intervals were 16.7/17.5/18.0 ms. Both CPU p95 values are below the half-refresh headroom target (8.35 ms), but neither CPU submission nor acknowledgement measures GPU execution or physical presentation.

The diagnostic SVG reference also had zero missed refreshes, with CPU application p50/p95/p99 of 2.1/2.6/2.9 ms; it is not the retained editor renderer. This validates the new fixture's hardware operation and reported memory allocation. There is no matched unpooled hardware timing at this resolution, so it does not establish pooling's speed impact. The earlier `10,40` outline workload has different geometry and cannot be used as a before/after timing baseline for `rig-scene,10`. Longer runs, more geometry per rig and actual GPU/presentation instrumentation remain necessary to establish scaling limits.

### Independent stress axes (`stress-scenes-v7`)

The lab retains the previous baseline and adds these synthetic workloads. Every row has ten dependent-IK rigs, a rigid attachment per rig and twenty clip masks. Additional animated paths have distinct offset/scaled geometry and bone weights; higher vertex counts add small bends along edges. They are supported straight polygon artwork, not a claim of complete curved-fill/imported-scene support.

| Workload ID | Moving rigs | Paths per rig | Vertices per path | Static background layers | Paint draws | Bound points, including moving clips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `rig-scene,10` | 10 | 2 | 6 | 0 | 50 | 160 |
| `scene-geometry-24` | 10 | 2 | 24 | 0 | 50 | 520 |
| `scene-geometry-48` | 10 | 2 | 48 | 0 | 50 | 1,000 |
| `scene-layers-8` | 10 | 8 | 6 | 0 | 170 | 520 |
| `scene-layers-24` | 10 | 24 | 6 | 0 | 490 | 1,480 |
| `scene-combined` | 10 | 12 | 24 | 0 | 250 | 2,920 |
| `scene-static-0` | 1 | 2 | 6 | 0 | 50 | 160 |
| `scene-static-500` | 1 | 2 | 6 | 500 | 550 | 160 |
| `scene-static-2000` | 1 | 2 | 6 | 2,000 | 2,050 | 160 |

Compare geometry/layer presets against `rig-scene,10`; compare static backgrounds against `scene-static-0`, which also leaves nine rigs still. Static artwork retains geometry but still incurs draw submission and raster work. The combined preset increases two dimensions deliberately and should not be used to attribute a bottleneck to just one of them. Reports include `workloadDetails` with actual target, draw, clip and binding counts.

The UI defaults to 1,800 samples per backend and offers 180 or 7,200. At 60 Hz these are approximately 3, 30 or 120 measured seconds **per backend**, plus calibration/warmup; actual duration depends on refresh rate and load. `measuredSeconds` reports each observed sample window. Cancel measurement aborts pending frame waits and drains/cancels worker previews; hiding the tab stops the run rather than recording background throttling. An interrupted run does not produce a completed report. Experimental WebGPU remains off by default.

For NVIDIA comparison, restart the lab, enable Experimental WebGPU, and run baseline, geometry, layers and static-surroundings presets at the same backing resolution. Start with 1,800 samples, then use 7,200 for workloads near the frame budget. Repeat near-limit workloads to distinguish consistent costs from isolated stalls. CPU submission, worker response and main-thread refresh metrics retain their existing limitations; GPU execution and physical presentation are still unmeasured. Hardware stress results are pending.

GPU results additionally report `finalGpuDrainMs`: a queue-completion wait after the sampled workload. Worker draining follows an extra exact-final evaluation/submission. This catches a slow tail of queued work that CPU submission timings alone omit; it is not per-frame GPU execution or presentation timing, and a low final drain cannot establish smooth presentation throughout the run. Ordinary previews do not wait on GPU completion. The existing worker watchdog still bounds a failed or excessively slow final acknowledgement.

Measurement preparation drains prior main-thread and worker GPU work before calibration, so previous previews cannot keep rendering through the next backend's sample window. Cancellation can abandon these waits immediately; it cannot retract work already submitted to a driver.

Software-GPU smoke runs use a 256-pixel-wide comparison preview and a short sample count, while explicit correctness captures retain their stated dimensions, including the existing 1380×1104 ten-rig check. These diagnostic preview sizes do not change the interactive hardware lab, which follows actual canvas size and DPR. A full-size software run was stopped when the heavy workloads saturated SwiftShader; its partial timings are not a performance result.

A completed 30-sample `scene-combined` instrumentation run at 256×205 on SwiftShader showed final queue waits of 11,635.3 ms (main-thread GPU) and 11,142.8 ms (worker), despite zero missed main-thread refreshes and all 30 worker CPU acknowledgements completing. This exposes submission/completion cadence as an insufficient proxy for rendering throughput. It is software-adapter evidence only, not a prediction for NVIDIA; CPU timing differences from this run are not a hardware speed comparison. The diagnostic does not bound GPU queue depth during playback; overload handling remains future renderer work.

### Desktop confirmation: 2,000 static background layers

User-supplied `stress-scenes-v7` / `scene-static-2000` report on NVIDIA Ampere, Chrome 149 Linux, 1380×1104 pixels, DPR 2 and 16.7 ms calibrated refresh. The scene contains ten rigs with one moving, 2,000 static background layers, 2,070 scene targets, 2,050 paint draws, twenty masks and 160 bound points. Both adapters reported non-fallback NVIDIA Ampere.

| Metric | Main-thread WebGPU | Worker WebGPU |
| --- | ---: | ---: |
| CPU processing p50 | 4.0 ms | 3.8 ms |
| CPU processing p95 | 4.8 ms | 4.7 ms |
| CPU processing p99 | 5.2 ms | 5.6 ms |
| Evaluation p95 | 0.2 ms | 0.3 ms |
| Geometry p95 | 2.3 ms | 2.1 ms |
| Submission p95 | 2.7 ms | 2.7 ms |
| Final GPU queue drain | 19.7 ms | 27.8 ms |

All 180 worker requests completed with none superseded. Worker dispatch p95 was 0.1 ms; response latency p95/p99 was 5.1/5.9 ms. Both GPU modes recorded zero missed main-thread refresh opportunities, two mask textures and 48,752,640 logical mask bytes. Worker acknowledgement intervals p50/p95/p99 were 16.7/17.9/18.4 ms. The final drain is a small absolute tail in this run, not a per-frame GPU duration or presentation measurement; the worker value includes draining the extra final submission.

This report used **180 samples**, not the longer 1,800-sample preset: each GPU sample window lasted approximately 3.0004 seconds. It supports short-run CPU headroom and shows no large queue tail at the end of this fixture, but does not establish sustained performance or fully animated character density limits. Repeat with 1,800 samples, then measure the combined animated workload separately. The SVG diagnostic took 6.2675 seconds for its 180 samples, with CPU p95 28.2 ms and 52.13% missed refreshes; it rebuilds SVG markup/DOM and remains unsuitable as a retained-editor speedup baseline. GPU preparation/submission costs exceed rig evaluation costs here, making static-scene traversal/submission reasonable profiling candidates, rather than evidence that rig solving needs further optimization.

### Longer desktop confirmation: 1,800 static-scene samples

The user repeated `scene-static-2000` on the same reported NVIDIA Ampere / Chrome 149 Linux setup, 1380×1104 pixels and DPR 2, with **1,800 samples**. Main-thread and worker GPU sample windows lasted 30.0209 and 30.0208 seconds respectively.

| Metric | Main-thread WebGPU | Worker WebGPU |
| --- | ---: | ---: |
| CPU processing p50 | 3.8 ms | 3.7 ms |
| CPU processing p95 | 4.5 ms | 4.3 ms |
| CPU processing p99 | 4.9 ms | 4.9 ms |
| Geometry p95 | 2.1 ms | 1.9 ms |
| Submission p95 | 2.5 ms | 2.6 ms |
| Final GPU queue drain | 23.0 ms | 28.7 ms |
| Missed main-thread refresh opportunities | 0.0555% | 0.0555% |

Each GPU mode recorded one inferred missed refresh opportunity across the sample window. All 1,800 worker requests completed with zero superseded previews; dispatch p95 was 0.1 ms, response latency p95/p99 was 4.7/5.3 ms, and acknowledgement intervals p95/p99 were 17.7/18.3 ms. Both retained two mask textures / 48,752,640 logical mask bytes.

Compared with the 180-sample run, CPU p95 was slightly lower (4.8→4.5 ms main-thread, 4.7→4.3 ms worker), while final queue waits remained in the same tens-of-milliseconds range (19.7→23.0 ms and 27.8→28.7 ms). This supports stable aggregate CPU processing and a small final queue tail over the longer static-heavy workload; the small timing changes are not evidence of a code optimization. No large accumulated end-of-run GPU backlog appeared. These aggregate statistics do not measure per-frame GPU execution or physical presentation, nor establish fidelity/performance for denser moving characters. The next independent workload is `scene-combined` at 1,800 samples and the same backing resolution.

The SVG diagnostic took 61.7253 seconds for 1,800 samples, with application p95/p99 28.3/35.9 ms and 51.39% missed refresh opportunities. Its markup/DOM rebuild behavior remains unsuitable as a production retained-editor speedup baseline.
