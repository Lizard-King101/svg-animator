import { AnimationPlaybackService } from "./animation-playback.service";
import { createDefaultAnimation, evaluateTrack, restoreAnimation } from "../editor/objects/animation.object";

describe("animation work area", () => {
    function service() {
        const animation = createDefaultAnimation();
        animation.duration = 6;
        animation.workArea = { start: 0, end: 6 };
        const editor = { selectedSVG: { animation, elements: [] } } as any;
        const zone = { run: (callback: () => unknown) => callback(), runOutsideAngular: (callback: () => unknown) => callback() } as any;
        const playback = new AnimationPlaybackService(editor, zone, { mode: "edit", setMode: () => {} } as any);
        return { playback, animation };
    }

    it("restores saved ranges and defaults legacy documents to the full duration", () => {
        expect(restoreAnimation({ version: 2, duration: 5 }).workArea).toEqual({ start: 0, end: 5 });
        expect(restoreAnimation({ version: 2, duration: 5, workArea: { start: 1, end: 4 } }).workArea)
            .toEqual({ start: 1, end: 4 });
    });

    it("follows duration while full-range and clamps a customized range", () => {
        const { playback, animation } = service();
        playback.setDuration(8);
        expect(animation.workArea).toEqual({ start: 0, end: 8 });
        playback.setWorkArea(2, 7);
        playback.setDuration(5);
        expect(animation.workArea).toEqual({ start: 2, end: 5 });
    });

    it("re-zeros trim while retaining outside keys and temporal data exactly", () => {
        const { playback, animation } = service();
        const track = {
            id: "track", targetId: "shape", property: "opacity", valueType: "number" as const,
            keyframes: [
                { id: "before", time: 1, value: 0, easing: { type: "linear" as const } },
                { id: "inside", time: 3, value: 1, easing: { type: "linear" as const }, temporal: { linked: false, in: { speed: 0.5, influence: 0.2 }, out: { speed: -0.2, influence: 0.4 } } },
                { id: "after", time: 6, value: 0, easing: { type: "linear" as const } },
            ],
        };
        animation.tracks = [track];
        animation.markers = [{ id: "marker", name: "outside", time: 5.5 }];
        playback.setWorkArea(2, 5);
        const samples = [0, 0.5, 1.5, 3].map((time) => evaluateTrack(track, time + 2));
        const temporal = JSON.stringify(track.keyframes[1].temporal);

        expect(playback.trimToWorkArea()).toBeTrue();
        expect(animation.duration).toBe(3);
        expect(animation.workArea).toEqual({ start: 0, end: 3 });
        expect(track.keyframes.map((key) => key.time)).toEqual([-1, 1, 4]);
        expect(animation.markers[0].time).toBe(3.5);
        expect(JSON.stringify(track.keyframes[1].temporal)).toBe(temporal);
        [0, 0.5, 1.5, 3].forEach((time, index) => {
            expect(Number(evaluateTrack(track, time))).toBeCloseTo(Number(samples[index]), 10);
        });
    });

    it("wraps and stops inside the work area instead of the full duration", () => {
        const { playback } = service();
        playback.setWorkArea(2, 4);
        playback.currentTime = 3.75;
        playback.setLoop(true);
        (playback as any).advance(0.5);
        expect(playback.currentTime).toBe(2.25);
        playback.setLoop(false);
        playback.currentTime = 3.75;
        (playback as any).advance(0.5);
        expect(playback.currentTime).toBe(4);
        expect(playback.playing).toBeFalse();
        playback.stop();
        expect(playback.currentTime).toBe(2);
    });
});
