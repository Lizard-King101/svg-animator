import {
    AnimationTrack,
    applyEasingPresetToKeyframe,
    applyEasingPresetToSelection,
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

    it("materializes easing presets into stable speed-graph tangents", () => {
        const track: AnimationTrack = {
            id: "preset", targetId: "shape", property: "transform.scaleX", valueType: "number",
            keyframes: [{ id: "a", time: 0, value: 0 }, { id: "b", time: 1, value: 10 }],
        };

        applyEasingPresetToKeyframe(track, track.keyframes[0], "ease-in-out");

        expect(track.keyframes[0].temporal?.out?.speed).toBe(0);
        expect(track.keyframes[1].temporal?.in?.speed).toBe(0);
        expect(evaluateTemporalSpeed(track.keyframes[0], track.keyframes[1], 0)).toBeCloseTo(0, 8);
        expect(evaluateTemporalSpeed(track.keyframes[0], track.keyframes[1], 0.5)).toBeCloseTo(15, 8);
        expect(evaluateTemporalSpeed(track.keyframes[0], track.keyframes[1], 1)).toBeCloseTo(0, 8);
        expect(evaluateTrack(track, 0.5)).toBeCloseTo(5, 8);
    });

    it("applies ease out to the segment arriving at the selected end keyframe", () => {
        const track = temporalTrack(10, 10);
        track.keyframes.forEach((keyframe) => keyframe.temporal = undefined);

        applyEasingPresetToSelection(track, new Set(["b"]), "ease-out");

        expect(track.keyframes[0].easing?.type).toBe("ease-out");
        expect(track.keyframes[0].temporal?.out?.speed).toBe(20);
        expect(track.keyframes[1].temporal?.in?.speed).toBe(0);
        expect(evaluateTemporalSpeed(track.keyframes[0], track.keyframes[1], 1)).toBeCloseTo(0, 8);
    });

    it("combines selected start and end boundaries into ease in out", () => {
        const track = temporalTrack(10, 10);
        track.keyframes.forEach((keyframe) => keyframe.temporal = undefined);

        applyEasingPresetToSelection(track, new Set(["a", "b"]), "ease-in-out");

        expect(track.keyframes[0].easing?.type).toBe("ease-in-out");
        expect(track.keyframes[0].temporal?.out?.speed).toBe(0);
        expect(track.keyframes[1].temporal?.in?.speed).toBe(0);
    });

    it("preserves separately applied entry and exit easing on one segment", () => {
        const track = temporalTrack(10, 10);
        track.keyframes.forEach((keyframe) => keyframe.temporal = undefined);

        applyEasingPresetToSelection(track, new Set(["a"]), "ease-in");
        applyEasingPresetToSelection(track, new Set(["b"]), "ease-out");

        expect(track.keyframes[0].easing?.type).toBe("ease-in-out");
        expect(track.keyframes[0].temporal?.out?.speed).toBe(0);
        expect(track.keyframes[1].temporal?.in?.speed).toBe(0);
        expect(evaluateTemporalSpeed(track.keyframes[0], track.keyframes[1], 0)).toBeCloseTo(0, 8);
        expect(evaluateTemporalSpeed(track.keyframes[0], track.keyframes[1], 1)).toBeCloseTo(0, 8);
    });

    it("eases both sides of one selected middle keyframe", () => {
        const track: AnimationTrack = {
            id: "middle", targetId: "shape", property: "transform.translateX", valueType: "number",
            keyframes: [
                { id: "a", time: 0, value: 0 },
                { id: "b", time: 1, value: 10 },
                { id: "c", time: 2, value: 20 },
            ],
        };

        applyEasingPresetToSelection(track, new Set(["b"]), "ease-in-out");

        expect(track.keyframes[0].easing?.type).toBe("ease-out");
        expect(track.keyframes[1].temporal?.in?.speed).toBe(0);
        expect(track.keyframes[1].easing?.type).toBe("ease-in");
        expect(track.keyframes[1].temporal?.out?.speed).toBe(0);
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
