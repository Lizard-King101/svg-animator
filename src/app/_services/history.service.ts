import { Injectable } from "@angular/core";
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
        const selectedId = editor.selectedElement?.id;
        svg.undo();
        this._clearSelection(editor, selectedId);
    }

    redo(editor: EditorService) {
        const svg = editor.selectedSVG;
        if (!svg?.canRedo) return;
        const selectedId = editor.selectedElement?.id;
        svg.redo();
        this._clearSelection(editor, selectedId);
    }

    private _clearSelection(editor: EditorService, selectedId: string | undefined) {
        editor.selectedPathAnchor = undefined;
        editor.selectedPathLine = undefined;
        editor.selectedElement = selectedId
            ? editor.selectedSVG?.elements.find((e) => e.id === selectedId)
            : undefined;
    }
}
