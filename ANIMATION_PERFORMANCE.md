# Animation performance benchmark

Performance is measured in Chrome development builds, not asserted as wall-clock CI tests.

1. Import `SVG Samples/car_stress_test.svg` and open Animate mode.
2. In DevTools, record a Performance trace while playing and scrubbing for ten seconds.
3. Create a plan from `createSyntheticAnimationBenchmark()` and run `runAnimationBenchmark(plan, 600)` from `animation-benchmark.ts`. The default workload is 2,000 tracks and exactly 50,000 keys.
4. Record p50/p95 evaluation work, scrub input-to-paint, longest frame, and visible timeline DOM counts.

Acceptance targets are p95 evaluation below 4 ms, p95 frame work at or below 16.7 ms, scrub input-to-paint below 33 ms, and timeline DOM proportional to the viewport. Save dated baseline and post-change trace files outside source control; traces are machine-specific and too large for the repository.
