import { ElementFactory } from "./element-factory.service";
import { LayerCommandService } from "./layer-command.service";
import { LayerOperationsService } from "./layer-operations.service";
import { DocumentMutationService } from "./document-mutation.service";
import { EditorService } from "./editor.service";
import { Group } from "../editor/objects/elements/group.object";
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

    it("navigates visible rows like a tree, expanding, collapsing, and extending the selection", () => {
        const editor = editorDouble();
        const svg = new SVG(editor, { width: 100, height: 100, pos: new Point(0, 0) });
        const background = new Shape(editor, { type: "rectangle", position: new Point(0, 0) });
        const child = new Shape(editor, { type: "ellipse", position: new Point(10, 10) });
        const group = new Group(editor); group.elements = [child];
        const label = new Shape(editor, { type: "rectangle", position: new Point(20, 20) });
        svg.elements = [background, group, label];
        editor.selectedSVG = svg;
        const commands = new LayerCommandService(editor, new LayerOperationsService(editor, new ElementFactory(editor)), {} as DocumentMutationService);
        const visible = () => commands.layerRows.map((row) => row.element);
        expect(visible()).toEqual([label, group, child, background]);

        commands.selectLayer(label);
        expect(commands.navigateLayers("ArrowDown", label)).toBe(group);
        expect(commands.selectedLayers).toEqual([group]);
        expect(commands.navigateLayers("ArrowLeft", group)).toBe(group);
        expect(visible()).toEqual([label, group, background]);
        expect(commands.navigateLayers("ArrowRight", group)).toBe(group);
        expect(commands.navigateLayers("ArrowRight", group)).toBe(child);
        expect(commands.navigateLayers("ArrowLeft", child)).toBe(group);
        expect(commands.navigateLayers("End", group, true)).toBe(background);
        expect(commands.selectedLayers).toEqual([group, child, background]);
        expect(commands.navigateLayers("Home", background)).toBe(label);
        expect(commands.selectedLayers).toEqual([label]);
        expect(commands.navigateLayers("ArrowUp", label)).toBe(label);
        expect(commands.navigateLayers("Enter", label)).toBeUndefined();
    });
});

function editorDouble(): EditorService {
    let id = 0;
    return {
        get ID() { return `id-${++id}`; },
        selectedPathLines: [],
    } as unknown as EditorService;
}
