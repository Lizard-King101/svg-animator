import { ElementFactory } from "./element-factory.service";
import { LayerCommandService } from "./layer-command.service";
import { LayerOperationsService } from "./layer-operations.service";
import { DocumentMutationService } from "./document-mutation.service";
import { ObjectClipboardCommandService } from "./object-clipboard-command.service";
import { EditorContextMenuItem, EditorService } from "./editor.service";
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
        commands.finishLayerRename("  ");
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

    it("adds clipboard actions to the layer menu and offers paste over empty canvas", () => {
        const editor = editorDouble() as EditorService & { contextMenu?: { items: { label: string; action?: () => void }[] } };
        editor.openContextMenu = (x: number, y: number, items) => { editor.contextMenu = { x, y, items } as never; };
        editor.closeContextMenu = jasmine.createSpy("closeContextMenu");
        const svg = new SVG(editor, { width: 100, height: 100, pos: new Point(0, 0) });
        const shape = new Shape(editor, { type: "rectangle", position: new Point(0, 0) });
        svg.elements = [shape];
        editor.selectedSVG = svg;
        editor.selectedElements = [shape];
        const clipboard = { canCopy: true, canPaste: false, copy: jasmine.createSpy("copy"), paste: jasmine.createSpy("paste") };
        const commands = new LayerCommandService(editor, new LayerOperationsService(editor, new ElementFactory(editor)),
            {} as DocumentMutationService, clipboard as unknown as ObjectClipboardCommandService);
        const labels = () => editor.contextMenu!.items.map((item) => item.label);
        const event = () => new MouseEvent("contextmenu", { clientX: 4, clientY: 4 });

        commands.openCanvasContextMenu(event(), shape);
        expect(labels().slice(0, 2)).toEqual(["Copy", "Rename layer"]);
        editor.contextMenu!.items[0].action!();
        expect(clipboard.copy).toHaveBeenCalledTimes(1);

        clipboard.canCopy = false;
        editor.contextMenu = undefined;
        commands.openCanvasContextMenu(event());
        expect(editor.contextMenu).toBeUndefined();
        expect(editor.closeContextMenu).toHaveBeenCalled();

        clipboard.canPaste = true;
        commands.openCanvasContextMenu(event());
        expect(labels()).toEqual(["Paste", "Paste in place"]);
        editor.contextMenu!.items[1].action!();
        expect(clipboard.paste).toHaveBeenCalledOnceWith(true);
    });

    it("groups single-layer commands, disables impossible ordering, and limits multi-selection menus to selection commands", () => {
        const editor = editorDouble() as EditorService & { contextMenu?: { items: EditorContextMenuItem[]; infoLines?: string[] } };
        editor.openContextMenu = (x: number, y: number, items) => { editor.contextMenu = { x, y, items } as never; };
        const svg = new SVG(editor, { width: 100, height: 100, pos: new Point(0, 0) });
        const bottom = new Shape(editor, { type: "rectangle", position: new Point(0, 0) });
        const top = new Shape(editor, { type: "ellipse", position: new Point(10, 10) });
        svg.elements = [bottom, top];
        editor.selectedSVG = svg;
        editor.selectedElements = [];
        const operations = new LayerOperationsService(editor, new ElementFactory(editor));
        const commands = new LayerCommandService(editor, operations, { commit: () => true } as unknown as DocumentMutationService);
        const open = (element: Shape) => commands.openLayerContextMenu(new MouseEvent("contextmenu"), element);
        const item = (label: string) => editor.contextMenu!.items.find((candidate) => candidate.label === label)!;

        open(top);
        expect(editor.contextMenu!.items.map((candidate) => candidate.label)).toEqual([
            "Rename layer", "Duplicate", "Group with layer below", "Clip with layer below",
            "Bring to front", "Bring forward", "Send backward", "Send to back", "Delete layer",
        ]);
        expect(editor.contextMenu!.items.filter((candidate) => candidate.separatorBefore).map((candidate) => candidate.label))
            .toEqual(["Group with layer below", "Clip with layer below", "Bring to front", "Delete layer"]);
        expect(editor.contextMenu!.infoLines).toBeUndefined();
        expect([item("Bring to front").disabled, item("Send to back").disabled]).toEqual([true, false]);
        expect(item("Delete layer").danger).toBeTrue();
        item("Send to back").action!();
        expect(svg.elements).toEqual([top, bottom]);
        open(top);
        expect([item("Bring to front").disabled, item("Send to back").disabled]).toEqual([false, true]);
        item("Bring to front").action!();
        expect(svg.elements).toEqual([bottom, top]);

        editor.selectedElements = [bottom, top];
        open(top);
        expect(editor.contextMenu!.items.map((candidate) => candidate.label)).toEqual(["Duplicate selection", "Group selection", "Delete selection"]);
    });
});

function editorDouble(): EditorService {
    let id = 0;
    return {
        get ID() { return `id-${++id}`; },
        selectedPathLines: [],
    } as unknown as EditorService;
}
