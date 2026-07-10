import { Injectable } from "@angular/core";
import { Group } from "../editor/objects/elements/group.object";
import { Path } from "../editor/objects/elements/path.object";
import { AnyElement } from "../editor/objects/svg.object";
import { EditorService } from "./editor.service";

@Injectable()
export class HistoryService {

    get canUndo() { return this._editor?.selectedSVG?.canUndo ?? false; }
    get canRedo() { return this._editor?.selectedSVG?.canRedo ?? false; }

    private _editor?: EditorService;

    /** Call once after injection so the getters have access to the editor. */
    init(editor: EditorService) {
        this._editor = editor;
    }

    snapshot(editor: EditorService) {
        editor.selectedSVG?.snapshot();
    }

    undo(editor: EditorService) {
        const svg = editor.selectedSVG;
        if (!svg?.canUndo) return;
        const selection = this.captureSelection(editor);
        svg.undo();
        this.restoreSelection(editor, selection);
    }

    redo(editor: EditorService) {
        const svg = editor.selectedSVG;
        if (!svg?.canRedo) return;
        const selection = this.captureSelection(editor);
        svg.redo();
        this.restoreSelection(editor, selection);
    }

    private captureSelection(editor: EditorService): HistorySelection {
        return {
            elementId: editor.selectedElement?.id,
            anchorId: editor.selectedPathAnchor?.id,
            lineId: editor.selectedPathLine?.id,
            lineIds: editor.selectedPathLines.map((line) => line.id),
        };
    }

    private restoreSelection(editor: EditorService, selection: HistorySelection) {
        const element = selection.elementId
            ? this.findElement(editor.selectedSVG?.elements ?? [], selection.elementId)
            : undefined;
        editor.selectedElement = element;
        editor.activeElement = undefined;
        if(element instanceof Path) {
            const lines = element.contours.flatMap((contour) => contour.lines);
            editor.selectedPathAnchor = selection.anchorId ? element.findPointById(selection.anchorId) : undefined;
            editor.selectedPathLine = selection.lineId ? lines.find((line) => line.id === selection.lineId) : undefined;
            editor.selectedPathLines = lines.filter((line) => selection.lineIds.includes(line.id));
        } else {
            editor.selectedPathAnchor = undefined;
            editor.selectedPathLine = undefined;
            editor.selectedPathLines = [];
        }
    }

    private findElement(elements: AnyElement[], id: string): AnyElement | undefined {
        for(const element of elements) {
            if(element.id === id) return element;
            if(element instanceof Group) {
                const nested = this.findElement(element.elements, id);
                if(nested) return nested;
            }
        }
        return undefined;
    }
}

interface HistorySelection {
    elementId?: string;
    anchorId?: string;
    lineId?: string;
    lineIds: string[];
}
