import { CanvasCropService } from "./canvas-crop.service";

describe("canvas crop service", () => {
    it("stages bounds and applies one canvas mutation without changing artwork coordinates", () => {
        const element = { position: { x: 40, y: 25 } };
        const svg: any = {
            id: "doc", viewBoxX: 0, viewBoxY: 0, width: 100, height: 80, zoom: 2,
            pos: { x: 10, y: 20 }, elements: [element],
            get canvasBounds() { return { x: this.viewBoxX, y: this.viewBoxY, width: this.width, height: this.height }; },
        };
        const editor = { selectedSVG: svg, rememberCanvasView: jasmine.createSpy("remember") } as any;
        const mutations = { commit: jasmine.createSpy("commit").and.returnValue(true) } as any;
        const crop = new CanvasCropService(editor, mutations);
        crop.begin();
        crop.setField("x", 10); crop.setField("y", -5); crop.setField("width", 60); crop.setField("height", 50);

        expect(crop.apply({ x: 100, y: 70, width: 200, height: 160 })).toBeTrue();
        expect(svg.canvasBounds).toEqual({ x: 10, y: -5, width: 60, height: 50 });
        expect(element.position).toEqual({ x: 40, y: 25 });
        expect(mutations.commit).toHaveBeenCalledOnceWith("canvas");
        expect(editor.rememberCanvasView).toHaveBeenCalledWith(svg);
    });

    it("enforces minimum dimensions and restores a canceled draft", () => {
        const svg: any = { id: "doc", viewBoxX: 4, viewBoxY: 5, width: 20, height: 30,
            get canvasBounds() { return { x: this.viewBoxX, y: this.viewBoxY, width: this.width, height: this.height }; } };
        const crop = new CanvasCropService({ selectedSVG: svg } as any, {} as any);
        crop.begin(); crop.setField("width", -10); crop.setField("x", 99);
        expect(crop.draft?.width).toBe(1);
        crop.cancel();
        expect(crop.draft).toEqual({ x: 4, y: 5, width: 20, height: 30 });
    });
});
