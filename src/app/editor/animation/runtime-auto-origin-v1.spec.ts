import autoOriginEnvelope from "../../../../fixtures/runtime-auto-origin-v1/document-v5.json";
import { SVG, SVGSave } from "../objects/svg.object";
import { compileRuntimeAnimation } from "./runtime-animation-compiler";
import { expectRuntimeDomParity, runtimeParitySampleTimes } from "./runtime-dom-parity.spec-support";

describe("runtime-auto-origin-v1 immutable regression fixture", () => {
    const source = SVG.fromSave(autoOriginEnvelope.data as SVGSave, { ID: "fixture-id" } as never).save();

    it("keeps an automatic transform origin attached while path geometry and scale animate", () => {
        const compile = compileRuntimeAnimation(source);
        const target = compile.bundle.artwork.targets.find((candidate) => candidate.id === "moving-scaled-path")!;
        expect(target.transform.autoOrigin).toBeTrue();

        expect(runtimeParitySampleTimes(source)).toEqual([0, 0.5, 1]);
        expectRuntimeDomParity(source, runtimeParitySampleTimes(source), ({ time, runtimeRoot }) => {
            if(time === 1) expect(matrixValues(runtimeRoot.querySelector<SVGElement>("#moving-scaled-path")!.getAttribute("transform"))).toEqual([2, 0, 0, 2, -60, -20]);
        });
    });
});

function matrixValues(value: string | null): number[] {
    const match = /^matrix\(([^)]+)\)$/.exec(value ?? "");
    if(!match) throw new Error(`Expected an SVG matrix, received ${String(value)}.`);
    return match[1].trim().split(/[ ,]+/).map(Number);
}
