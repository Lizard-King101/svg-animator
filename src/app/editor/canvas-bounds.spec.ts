import { EditorService } from "../_services/editor.service";
import { buildSVGMarkup } from "./svg-markup";
import { SVG } from "./objects/svg.object";

describe("persisted canvas bounds", () => {
    const editor = { get ID() { return "id"; } } as EditorService;

    it("restores legacy documents at a zero origin and round-trips non-zero viewBoxes", () => {
        const legacy = SVG.fromSave({ id: "doc", name: "Doc", width: 100, height: 80, elements: [] }, editor);
        expect(legacy.canvasBounds).toEqual({ x: 0, y: 0, width: 100, height: 80 });
        legacy.viewBoxX = -20; legacy.viewBoxY = 15; legacy.width = 60; legacy.height = 40;
        const restored = SVG.fromSave(legacy.save(), editor);
        expect(restored.canvasBounds).toEqual({ x: -20, y: 15, width: 60, height: 40 });
        expect(buildSVGMarkup(restored)).toContain('viewBox="-20 15 60 40"');
    });
});
