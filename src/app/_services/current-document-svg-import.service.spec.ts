import { SVGImporterService } from "../editor/import/svg-importer.service";
import { Group } from "../editor/objects/elements/group.object";
import { Point } from "../editor/objects/point.object";
import { SVG } from "../editor/objects/svg.object";
import { EditorService } from "./editor.service";
import { CurrentDocumentSVGImportService } from "./current-document-svg-import.service";

describe("CurrentDocumentSVGImportService", () => {
    it("adds a centered import group and preserved source in one artwork mutation", () => {
        const { editor, target, service, mutate, selectLayer } = setup();
        const result = service.import(`
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">
                <rect id="tile" x="0" y="0" width="40" height="20" fill="red"/>
                <image id="preview" width="1" height="1" href="data:image/png;base64,AA=="/>
            </svg>
        `, "Tile.svg");

        expect(mutate).toHaveBeenCalledTimes(1);
        expect(mutate.calls.mostRecent().args[1]).toBe("artwork");
        expect(target.elements).toEqual([result.layer]);
        expect(result.layer).toBeInstanceOf(Group);
        expect(result.layer.name).toBe("Tile");
        expect(result.layer.transform.translateX).toBe(80);
        expect(result.layer.transform.translateY).toBe(40);
        expect(result.layer.elements.length).toBe(1);
        expect(target.importedSourceNodes.length).toBe(1);
        expect(target.importedSourceNodes[0].parentId).toBe(result.layer.id);
        expect(target.importedSourceNodes[0].markup).toContain("-preview");
        expect(selectLayer).toHaveBeenCalledOnceWith(result.layer);
    });

    it("can import the same source repeatedly without ID collisions", () => {
        const { service, target } = setup();
        const source = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect id="shape" width="20" height="20"/></svg>';

        const first = service.import(source, "Shape.svg");
        const second = service.import(source, "Shape.svg");
        const ids = collectIds(target.elements as Group[]);

        expect(first.layer.id).not.toBe(second.layer.id);
        expect(first.layer.elements[0].id).not.toBe(second.layer.elements[0].id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    function setup() {
        let id = 0;
        const editor = {
            get ID() { id += 1; return `id-${id}`; },
            selectedPathLines: [],
        } as unknown as EditorService;
        const target = new SVG(editor, {
            width: 200,
            height: 100,
            name: "Target",
            pos: new Point(0, 0),
        });
        editor.selectedSVG = target;
        const mutate = jasmine.createSpy("mutate").and.callFake((change: () => unknown) => change());
        const selectLayer = jasmine.createSpy("selectLayer");
        const service = new CurrentDocumentSVGImportService(
            editor,
            new SVGImporterService(),
            { withBaseState: (change: () => unknown) => change() } as any,
            { mutate } as any,
            { selectLayer } as any,
        );
        return { editor, target, service, mutate, selectLayer };
    }
});

function collectIds(elements: Group[]): string[] {
    const ids: string[] = [];
    const visit = (element: Group | Group["elements"][number]) => {
        ids.push(element.id);
        if(element instanceof Group) element.elements.forEach(visit);
    };
    elements.forEach(visit);
    return ids;
}
