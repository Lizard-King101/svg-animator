import { AnimationEvaluationPlan, evaluateCompiledTrack } from "./animation-evaluation-plan";
import { compileRuntimeAnimation, evaluateCompiledRuntimeTrack } from "./runtime-animation-compiler";
import { evaluateTrack } from "../objects/animation.object";
import { AnimationDocument } from "../objects/animation.object";
import { SVGSave } from "../objects/svg.object";

describe("runtime animation compiler", () => {
    const document = (): SVGSave => ({
        id: "doc", name: "Compiler", width: 100, height: 100,
        elements: [{ type: "shape", id: "shape", name: "Shape", visible: true, locked: false, shapeType: "rectangle", position: { id: "p", x: 0, y: 0 }, settings: { width: 10, height: 10 } } as any],
        animation: {
            version: 2, duration: 1, loop: false, markers: [], variables: [], tracks: [{
                id: "x", targetId: "shape", property: "transform.translateX", valueType: "number",
                keyframes: [
                    { id: "a", time: 0, value: 0, temporal: { linked: true, out: { speed: -5, influence: 0.4 } } },
                    { id: "b", time: 1, value: 20, temporal: { linked: true, in: { speed: 30, influence: 0.2 } } },
                ],
            }],
        },
    });

    it("is deterministic and interns target/property tables", () => {
        const first = compileRuntimeAnimation(document());
        const second = compileRuntimeAnimation(document());
        expect(first).toEqual(second);
        expect(first.bundle.animation.targets).toEqual(["shape"]);
        expect(first.bundle.animation.properties).toEqual(["transform.translateX"]);
        expect(first.bundle.animation.tracks[0].kind).toBe("number");
        expect(first.bundle.artwork.signature).toMatch(/^fnv1a32-/);
        expect(first.bundle.generator.version).toBe("1.0.0");
    });

    it("emits diagnostics and skips orphaned tracks", () => {
        const input = document();
        input.animation!.tracks[0].targetId = "missing";
        const compiled = compileRuntimeAnimation(input);
        expect(compiled.bundle.animation.tracks.length).toBe(0);
        expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["orphaned-target", "skipped-track"]);
    });

    it("compiles sorted arrays once and uses cursor then binary search", () => {
        const animation: AnimationDocument = document().animation!;
        const plan = new AnimationEvaluationPlan(animation, []);
        const track = plan.tracks[0];
        expect(Array.from(track.times)).toEqual([0, 1]);
        evaluateCompiledTrack(track, 0.75);
        expect(track.lastTime).toBe(0.75);
        evaluateCompiledTrack(track, 0.25);
        expect(track.lastTime).toBe(0.25);
        expect(Number.isFinite(Number(evaluateCompiledTrack(track, 0.5)))).toBeTrue();
    });

    it("matches authoring evaluation at boundaries and intermediate samples", () => {
        const input = document();
        const runtime = compileRuntimeAnimation(input).bundle.animation.tracks[0];
        const authoring = input.animation!.tracks[0];
        [0, 0.1, 0.35, 0.5, 0.8, 1].forEach((time) => {
            expect(Number(evaluateCompiledRuntimeTrack(runtime, time))).toBeCloseTo(Number(evaluateTrack(authoring, time)), 3);
        });
    });

    it("selects the next temporal segment exactly at an internal keyframe", () => {
        const input = document();
        input.animation!.tracks[0].keyframes = [
            { id: "a", time: 0, value: 0, temporal: { linked: false, out: { speed: 80, influence: 1 / 3 } } },
            { id: "b", time: 0.5, value: 25, temporal: { linked: false, in: { speed: -20, influence: 1 / 3 }, out: { speed: 120, influence: 1 / 3 } } },
            { id: "c", time: 1, value: 50, temporal: { linked: false, in: { speed: 10, influence: 1 / 3 } } },
        ];
        const plan = new AnimationEvaluationPlan(input.animation!, []);
        const runtime = compileRuntimeAnimation(input).bundle.animation.tracks[0];

        expect(evaluateCompiledTrack(plan.tracks[0], 0.5)).toBe(25);
        expect(evaluateCompiledRuntimeTrack(runtime, 0.5)).toBe(25);
    });

    it("compiles text color tracks for exported playback", () => {
        const input = document();
        input.elements[0] = {
            type: "text", id: "shape", name: "Text", visible: true, locked: false,
            position: { id: "text-position", x: 0, y: 0 },
            settings: { content: "Hello", text_align: "start", font_family: "Arial", font_size: 16, font_weight: "400", color: "#000000" },
        };
        input.animation!.tracks[0] = {
            id: "text-color", targetId: "shape", property: "settings.color", valueType: "color",
            keyframes: [
                { id: "a", time: 0, value: "#ff0000" },
                { id: "b", time: 1, value: "#0000ff" },
            ],
        };

        const compiled = compileRuntimeAnimation(input);
        expect(compiled.bundle.animation.properties).toEqual(["settings.color"]);
        expect(compiled.bundle.animation.tracks[0].kind).toBe("color");
        expect(compiled.diagnostics).toEqual([]);
    });

    it("accepts additive geometry frame channels without changing the runtime format", () => {
        const input = document();
        input.animation!.tracks[0].property = "geometry.width";
        const compiled = compileRuntimeAnimation(input);
        expect(compiled.bundle.animation.properties).toEqual(["geometry.width"]);
        expect(compiled.bundle.animation.tracks[0].kind).toBe("number");
        expect(compiled.diagnostics).toEqual([]);
    });
});
