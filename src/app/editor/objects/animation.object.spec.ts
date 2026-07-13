import {
    AnimationTrack,
    evaluateTemporalNumberSegment,
    evaluateTemporalSpeed,
    evaluateTrack,
    normalizedKeyframes,
    restoreAnimation,
} from "./animation.object";

describe("temporal animation math", () => {
    const temporalTrack = (outSpeed: number, inSpeed: number): AnimationTrack => ({
        id: "track", targetId: "shape", property: "transform.translateX", valueType: "number",
        keyframes: [
            { id: "a", time: 0, value: 0, temporal: { linked: false, out: { speed: outSpeed, influence: 1 / 3 } } },
            { id: "b", time: 1, value: 10, temporal: { linked: false, in: { speed: inSpeed, influence: 1 / 3 } } },
        ],
    });

    it("preserves endpoint values and endpoint velocities", () => {
        const [from, to] = temporalTrack(-4, 22).keyframes;
        expect(evaluateTemporalNumberSegment(from, to, 0)).toBe(0);
        expect(evaluateTemporalNumberSegment(from, to, 1)).toBe(10);
        expect(evaluateTemporalSpeed(from, to, 0)).toBeCloseTo(-4, 4);
        expect(evaluateTemporalSpeed(from, to, 1)).toBeCloseTo(22, 4);
    });

    it("allows signed velocity and value overshoot", () => {
        const track = temporalTrack(60, -30);
        const samples = Array.from({ length: 41 }, (_unused, index) => Number(evaluateTrack(track, index / 40)));
        expect(Math.max(...samples)).toBeGreaterThan(10);
    });

    it("keeps preset easing exact when temporal data is absent", () => {
        const track: AnimationTrack = {
            id: "preset", targetId: "shape", property: "opacity", valueType: "number",
            keyframes: [{ id: "a", time: 0, value: 0, easing: { type: "ease-in" } }, { id: "b", time: 1, value: 1 }],
        };
        expect(evaluateTrack(track, 0.5)).toBeCloseTo(0.25, 8);
    });

    it("sorts keys and deterministically lets the later collision win", () => {
        const keys = normalizedKeyframes([
            { id: "late-time", time: 2, value: 2 },
            { id: "first", time: 1, value: 1 },
            { id: "replacement", time: 1, value: 3 },
        ]);
        expect(keys.map((key) => key.id)).toEqual(["replacement", "late-time"]);
    });

    it("loads animation v1 as v2 without adding temporal data", () => {
        const restored = restoreAnimation({ version: 1, duration: 2, tracks: [temporalTrack(1, 1)], markers: [] } as any);
        expect(restored.version).toBe(2);
        expect(restored.tracks[0].keyframes[0].id).toBe("a");
    });
});
