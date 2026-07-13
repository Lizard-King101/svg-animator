import { ElementFactory } from "./element-factory.service";
import { LayerCommandService } from "./layer-command.service";
import { LayerOperationsService } from "./layer-operations.service";
import { DocumentMutationService } from "./document-mutation.service";
import { EditorService } from "./editor.service";
import { Shape } from "../editor/objects/elements/shape.object";
import { Point } from "../editor/objects/point.object";
import { SVG } from "../editor/objects/svg.object";

describe("LayerCommandService", () => {
    it("owns range and toggle selection independently from the layer panel lifetime", () => {
        const editor = editorDouble();
        const svg = new SVG(editor, { width: 100, height: 100, pos: new Point(0, 0) });
        const first = new Shape(editor, { type: "rectangle", position: new Point(0, 0) });
        const second = new Shape(editor, { type: "ellipse", position: new Point(10, 10) });
        const third = new Shape(editor, { type: "rectangle", position: new Point(20, 20) });
        svg.elements = [first, second, third];
        editor.selectedSVG = svg;
        const commits: string[] = [];
        const operations = new LayerOperationsService(editor, new ElementFactory(editor));
        const commands = new LayerCommandService(editor, operations, { commit: () => { commits.push("commit"); return true; } } as DocumentMutationService);

        commands.selectLayer(third);
        commands.selectLayer(first, { shiftKey: true } as MouseEvent);
        expect(commands.selectedLayers).toEqual([third, second, first]);
        expect(editor.selectedElement).toBeUndefined();

        commands.selectLayer(second, { ctrlKey: true } as MouseEvent);
        expect(commands.selectedLayers).toEqual([third, first]);
        commands.renamingLayer = first;
        first.name = "  ";
        commands.finishLayerRename();
        expect(first.name).toBe("Layer");
        expect(commits).toEqual(["commit"]);
    });
});

function editorDouble(): EditorService {
    let id = 0;
    return {
        get ID() { return `id-${++id}`; },
        selectedPathLines: [],
    } as unknown as EditorService;
}
