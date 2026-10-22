import { SVG, SVGSave } from "../objects/svg.object";
import { Path } from "../objects/elements/path.object";
import { buildSVGMarkup } from "../svg-markup";
import { expectRuntimeDomParity } from "./runtime-dom-parity.spec-support";

describe("ImperativeSvgRenderer", () => {
    it("preserves open-path draw progress while stroke color animates", () => {
        const source: SVGSave = {
            id: "document",
            name: "Draw and color",
            width: 120,
            height: 40,
            elements: [{
                type: "path",
                id: "open-path",
                name: "Open path",
                visible: true,
                locked: false,
                closed: false,
                settings: {
                    stroke_width: 4,
                    fill_enabled: false,
                    fill: null,
                    stroke: "#ff0000",
                    line_cap: "round",
                    line_join: null,
                    stroke_alignment: "center",
                    stroke_dasharray: [],
                    stroke_dashoffset: 0,
                    stroke_miterlimit: 4,
                },
                lines: [{
                    id: "line",
                    type: "line",
                    points: [
                        { id: "start", x: 10, y: 20 },
                        { id: "end", x: 110, y: 20 },
                    ],
                }],
            }],
            animation: {
                version: 2,
                duration: 1,
                markers: [],
                variables: [],
                tracks: [{
                    id: "draw",
                    targetId: "open-path",
                    property: "path.drawProgress",
                    valueType: "number",
                    keyframes: [
                        { id: "draw-start", time: 0, value: 0 },
                        { id: "draw-end", time: 1, value: 1 },
                    ],
                }, {
                    id: "color",
                    targetId: "open-path",
                    property: "settings.stroke",
                    valueType: "color",
                    keyframes: [
                        { id: "color-start", time: 0, value: "#ff0000" },
                        { id: "color-end", time: 1, value: "#0000ff" },
                    ],
                }],
            },
        };

        const staticSvg = SVG.fromSave(source, { ID: "static-fixture" } as never);
        (staticSvg.elements[0] as Path).drawProgress = 0;
        const staticRoot = new DOMParser().parseFromString(buildSVGMarkup(staticSvg), "image/svg+xml");
        expect(staticRoot.querySelector("#open-path")?.getAttribute("stroke-opacity")).toBe("0");

        expectRuntimeDomParity(source, [0, 0.0001, 0.0003, 0.5], ({ time, editorRoot, runtimeRoot }) => {
            const expectedOpacity = time <= 0.0002 ? "0" : null;
            expect(editorRoot.querySelector("#open-path")?.getAttribute("stroke-opacity")).toBe(expectedOpacity);
            expect(runtimeRoot.querySelector("#open-path")?.getAttribute("stroke-opacity")).toBe(expectedOpacity);
            if(time !== 0.5) return;
            expect(editorRoot.querySelector("#open-path")?.getAttribute("stroke-dasharray")).toBe("1 2");
            expect(runtimeRoot.querySelector("#open-path")?.getAttribute("stroke-dasharray")).toBe("1 2");
            expect(editorRoot.querySelector("#open-path")?.getAttribute("stroke-dashoffset")).toBe("0.5");
            expect(runtimeRoot.querySelector("#open-path")?.getAttribute("stroke-dashoffset")).toBe("0.5");
        });
    });
});
