import { Injectable } from "@angular/core";

export type EditorDialog = "new-project" | "export";

/** Ephemeral state shared by editor shell surfaces. */
@Injectable()
export class EditorUiStateService {
    activeDialog?: EditorDialog;

    openDialog(dialog: EditorDialog): void { this.activeDialog = dialog; }
    closeDialog(dialog?: EditorDialog): void {
        if(!dialog || this.activeDialog === dialog) this.activeDialog = undefined;
    }
    isDialogOpen(dialog: EditorDialog): boolean { return this.activeDialog === dialog; }
}
