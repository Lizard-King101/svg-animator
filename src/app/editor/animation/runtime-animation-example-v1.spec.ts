import animationExampleEnvelope from "../../../../fixtures/runtime-animation-example-v1/document-v5.json";
import { SVG, SVGSave } from "../objects/svg.object";
import { expectRuntimeDomParity, runtimeParitySampleTimes } from "./runtime-dom-parity.spec-support";

describe("runtime-animation-example-v1 immutable user-project fixture", () => {
    const source = SVG.fromSave(animationExampleEnvelope.data as SVGSave, { ID: "fixture-id" } as never).save();

    it("keeps geometry-animated stars on their pinned origins and matches the full playable timeline", () => {
        expectRuntimeDomParity(source, runtimeParitySampleTimes(source), ({ time, runtimeRoot }) => {
            if(time !== 0) return;
            expect(runtimeRoot.querySelector<SVGElement>("#k5yv9nojm")!.getAttribute("transform")).toBe("matrix(0.1 0 0 0.1 267.332 212.046)");
            expect(runtimeRoot.querySelector<SVGElement>("#ez1xp5nv5")!.getAttribute("transform")).toBe("matrix(0.1 0 0 0.1 229.307 175.02)");
            expect(runtimeRoot.querySelector<SVGElement>('[id="6ajj9fjng"]')!.getAttribute("transform")).toBe("matrix(0.1 0 0 0.1 217.634 278.133)");
        });
    });
});
