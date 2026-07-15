import { EditorService } from "../../_services/editor.service";
import { CanvasGuidesComponent } from "./canvas-guides.component";

describe("canvas guides workspace projection", () => {
    it("aligns vertical and horizontal guides with the rendered artwork frame", () => {
        const editor = {
            selectedSVG: { width: 100, height: 50, zoom: 99, pos: { x: -500, y: -500 } },
        } as unknown as EditorService;
        const guides = new CanvasGuidesComponent(editor, {} as any);
        const canvas = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const workspace = document.createElement("div");
        spyOn(canvas, "getBoundingClientRect").and.returnValue(rect(120, 80, 200, 100));
        spyOn(workspace, "getBoundingClientRect").and.returnValue(rect(20, 30, 600, 400));
        guides.canvas = canvas;
        guides.workspace = { element: workspace } as any;

        expect(guides.screenPosition({ id: "x", axis: "x", value: 25 })).toBe(150);
        expect(guides.screenPosition({ id: "y", axis: "y", value: 10 })).toBe(70);
    });
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}
