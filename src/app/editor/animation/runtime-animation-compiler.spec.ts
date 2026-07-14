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
        expect(first.targets).toEqual(["shape"]);
        expect(first.properties).toEqual(["transform.translateX"]);
        expect(first.tracks[0].kind).toBe("number");
    });

    it("emits diagnostics and skips orphaned tracks", () => {
        const input = document();
        input.animation!.tracks[0].targetId = "missing";
        const compiled = compileRuntimeAnimation(input);
        expect(compiled.tracks.length).toBe(0);
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
        const runtime = compileRuntimeAnimation(input).tracks[0];
        const authoring = input.animation!.tracks[0];
        [0, 0.1, 0.35, 0.5, 0.8, 1].forEach((time) => {
            expect(Number(evaluateCompiledRuntimeTrack(runtime, time))).toBeCloseTo(Number(evaluateTrack(authoring, time)), 3);
        });
    });

    it("compiles text color tracks for exported playback", () => {
        const input = document();
        input.animation!.tracks[0] = {
            id: "text-color", targetId: "shape", property: "settings.color", valueType: "color",
            keyframes: [
                { id: "a", time: 0, value: "#ff0000" },
                { id: "b", time: 1, value: "#0000ff" },
            ],
        };

        const compiled = compileRuntimeAnimation(input);
        expect(compiled.properties).toEqual(["settings.color"]);
        expect(compiled.tracks[0].kind).toBe("color");
        expect(compiled.diagnostics).toEqual([]);
    });
});
