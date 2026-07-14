import { EditorPage } from "./editor.page";

describe("editor page keyboard shortcuts", () => {
    function setup() {
        const selectedElement = {};
        const editor = {
            selectedElement,
            selectedPathAnchor: undefined,
            contextMenu: undefined,
            keyPressed: jasmine.createSpy("keyPressed"),
            keyReleased: jasmine.createSpy("keyReleased"),
        };
        const layers: {
            renamingLayer: object | undefined;
            selectedLayers: object[];
            deleteLayer: jasmine.Spy;
            deleteSelectedLayers: jasmine.Spy;
        } = {
            renamingLayer: undefined,
            selectedLayers: [selectedElement],
            deleteLayer: jasmine.createSpy("deleteLayer"),
            deleteSelectedLayers: jasmine.createSpy("deleteSelectedLayers"),
        };
        const page = new EditorPage(
            editor as any,
            { mode: "edit" } as any,
            {} as any,
            {} as any,
            layers as any,
            { activeDialog: undefined } as any,
            {} as any,
            {} as any,
        );
        return { editor, layers, page, selectedElement };
    }

    function keyEvent(key: string, target: Element): KeyboardEvent {
        return {
            key,
            target,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            preventDefault: jasmine.createSpy("preventDefault"),
        } as unknown as KeyboardEvent;
    }

    it("leaves Backspace and Delete with focused property editors", () => {
        const { editor, layers, page } = setup();

        page.handleKeyDown(keyEvent("Backspace", document.createElement("textarea")));
        page.handleKeyDown(keyEvent("Delete", document.createElement("input")));

        expect(layers.deleteLayer).not.toHaveBeenCalled();
        expect(layers.deleteSelectedLayers).not.toHaveBeenCalled();
        expect(editor.keyPressed).not.toHaveBeenCalled();
    });

    it("leaves editing keys with the layer rename input", () => {
        const { editor, layers, page, selectedElement } = setup();
        layers.renamingLayer = selectedElement;
        const input = document.createElement("input");

        page.handleKeyDown(keyEvent("Backspace", input));
        page.handleKeyDown(keyEvent("Enter", input));

        expect(layers.deleteLayer).not.toHaveBeenCalled();
        expect(layers.renamingLayer).toBe(selectedElement);
        expect(editor.keyPressed).not.toHaveBeenCalled();
    });

    it("retains Delete as a canvas-level layer shortcut", () => {
        const { layers, page, selectedElement } = setup();
        const event = keyEvent("Delete", document.createElement("div"));

        page.handleKeyDown(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(layers.deleteLayer).toHaveBeenCalledOnceWith(selectedElement);
    });
});
