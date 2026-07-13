import { AnimationEvaluationPlan } from "./animation-evaluation-plan";
import { AnimationDocument } from "../objects/animation.object";

export interface AnimationBenchmarkResult { samples: number; p50: number; p95: number; maximum: number; }

/** Repeatable DevTools helper; intentionally not a flaky wall-clock CI assertion. */
export function runAnimationBenchmark(plan: AnimationEvaluationPlan, samples = 600): AnimationBenchmarkResult {
    const timings = new Array<number>(samples);
    const duration = Math.max(0.001, plan.animation.duration);
    for(let index = 0; index < samples; index++) {
        const start = performance.now();
        plan.evaluateEach((index / Math.max(1, samples - 1)) * duration, () => {});
        timings[index] = performance.now() - start;
    }
    timings.sort((a, b) => a - b);
    return {
        samples,
        p50: percentile(timings, 0.5),
        p95: percentile(timings, 0.95),
        maximum: timings[timings.length - 1] ?? 0,
    };
}

export function createSyntheticAnimationBenchmark(trackCount = 2_000, keyCount = 50_000): AnimationDocument {
    const duration = 10;
    const baseKeys = Math.floor(keyCount / trackCount);
    const remainder = keyCount % trackCount;
    return {
        version: 2,
        duration,
        fpsHint: 60,
        loop: true,
        markers: [],
        variables: [],
        tracks: Array.from({ length: trackCount }, (_unused, trackIndex) => {
            const count = baseKeys + (trackIndex < remainder ? 1 : 0);
            return {
                id: `stress-track-${trackIndex}`,
                targetId: `stress-target-${trackIndex}`,
                property: "transform.translateX",
                valueType: "number" as const,
                enabled: true,
                keyframes: Array.from({ length: count }, (_empty, keyIndex) => ({
                    id: `stress-key-${trackIndex}-${keyIndex}`,
                    time: count <= 1 ? 0 : keyIndex / (count - 1) * duration,
                    value: Math.sin(trackIndex * 0.1 + keyIndex * 0.25) * 100,
                    easing: { type: "ease-in-out" as const },
                })),
            };
        }),
    };
}

function percentile(values: readonly number[], percentileValue: number): number {
    return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * percentileValue) - 1))] ?? 0;
}
