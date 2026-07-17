import showcaseEnvelope from "../../../../fixtures/runtime-showcase-v1/document-v5.json";
import goldenBundle from "../../../../fixtures/runtime-showcase-v1/runtime-bundle-v1.json";
import { RuntimeBundleV1 } from "../../../../packages/runtime/src/contracts";
import { SVGSave } from "../objects/svg.object";
import { SVG } from "../objects/svg.object";
import { Color } from "../objects/color.object";
import { compileRuntimeAnimation, evaluateCompiledRuntimeTrack } from "./runtime-animation-compiler";
import { evaluateTrack } from "../objects/animation.object";
import { expectRuntimeDomParity } from "./runtime-dom-parity.spec-support";

describe("runtime-showcase-v1 immutable fixture", () => {
    const source = SVG.fromSave(showcaseEnvelope.data as SVGSave, { ID: "fixture-id" } as never).save();

    it("matches the checked-in RuntimeBundleV1 golden without diagnostics", () => {
        const result = compileRuntimeAnimation(source);
        expect(result.diagnostics).toEqual([]);
        expect(result.bundle).toEqual(goldenBundle as RuntimeBundleV1);
        expect(JSON.stringify(result.bundle)).not.toContain("workArea");
        expect(result.bundle.requiredCapabilities).toContain("render.clipping-v1");
        expect(result.bundle.requiredCapabilities).toContain("render.gradient-v1");
        expect(result.bundle.requiredCapabilities).toContain("render.motion-path-v1");
    });

    it("matches authoring evaluation across representative sampled times", () => {
        const result = compileRuntimeAnimation(source).bundle.animation;
        const samples = [-0.5, 0, 0.25, 1, 2, 3.75, 4, 4.5];
        source.animation!.tracks.filter((track) => track.enabled !== false).forEach((authoringTrack) => {
            const target = result.targets.indexOf(authoringTrack.targetId);
            const property = result.properties.indexOf(authoringTrack.property);
            const runtimeTrack = result.tracks.find((track) => track.target === target && track.property === property)!;
            expect(runtimeTrack).withContext(authoringTrack.id).toBeDefined();
            samples.forEach((time) => {
                const authoring = evaluateTrack(authoringTrack, time);
                const runtime = evaluateCompiledRuntimeTrack(runtimeTrack, time);
                if(authoringTrack.valueType === "color" && typeof runtime === "number") expect(colorDistance(runtime, packedColor(authoring))).withContext(`${authoringTrack.id}@${time}`).toBeLessThanOrEqual(2);
                else if(typeof authoring === "number" && typeof runtime === "number") expect(runtime).withContext(`${authoringTrack.id}@${time}`).toBeCloseTo(authoring, 3);
                else expect(runtime).withContext(`${authoringTrack.id}@${time}`).toEqual(authoring as never);
            });
        });
    });

    it("matches editor-preview and exported-runtime SVG DOM at sampled playable times", () => {
        const samples = [0, 0.25, 1, 2, 3.75, 4];
        expectRuntimeDomParity(source, samples, ({ time, editorRoot, runtimeRoot }) => {
            expect(Number(runtimeRoot.querySelector('#stroke-draw-compound-path [data-render-role~="reveal"]')?.getAttribute("stroke-dashoffset")))
                .withContext(`dashed path reveal at ${time}s`)
                .toBeCloseTo(Number(editorRoot.querySelector('#stroke-draw-compound-path [data-render-role~="reveal"]')?.getAttribute("stroke-dashoffset")), 3);
            expect(Number(runtimeRoot.querySelector("#path-stop-a")?.getAttribute("stop-opacity") ?? 1))
                .withContext(`animated gradient alpha at ${time}s`)
                .toBeCloseTo(Number(editorRoot.querySelector("#path-stop-a")?.getAttribute("stop-opacity") ?? 1), 2);
        });
    });
});

function packedColor(value: unknown): number {
    const input = typeof value === "string" ? { hex: value, alpha: undefined } : value as { hex: string; alpha?: number };
    const color = new Color(input.hex);
    if(input.alpha != null) color.alpha = input.alpha;
    return ((color.rgb.r << 24) | (color.rgb.g << 16) | (color.rgb.b << 8) | Math.round(color.alpha * 255)) >>> 0;
}

function colorDistance(a: number, b: number): number {
    return Math.max(...[24, 16, 8, 0].map((shift) => Math.abs(((a >>> shift) & 255) - ((b >>> shift) & 255))));
}
