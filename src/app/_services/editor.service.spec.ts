import { EditorService } from "./editor.service";

describe("EditorService viewport coordinates", () => {
    it("locates svg[display] when the editor overlay precedes the artwork", () => {
        const editor = Object.create(EditorService.prototype) as EditorService;
        editor.selectedSVG = { width: 100, height: 50 } as any;
        const workspace = document.createElement("div");
        const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const artwork = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        overlay.classList.add("editor-overlay");
        artwork.setAttribute("display", "");
        workspace.append(overlay, artwork);
        spyOn(workspace, "getBoundingClientRect").and.returnValue(rect(20, 30, 600, 400));
        spyOn(overlay, "getBoundingClientRect").and.returnValue(rect(20, 30, 600, 400));
        spyOn(artwork, "getBoundingClientRect").and.returnValue(rect(120, 80, 200, 100));
        editor.setViewPort(workspace);

        const canvasPoint = editor.toCanvasPoint(220, 130);
        const viewportPoint = editor.toViewportPoint(220, 130);
        expect({ x: canvasPoint.x, y: canvasPoint.y }).toEqual({ x: 50, y: 25 });
        expect({ x: viewportPoint.x, y: viewportPoint.y }).toEqual({ x: 200, y: 100 });
    });
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}
