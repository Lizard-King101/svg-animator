import { EditorUiStateService } from "./editor-ui-state.service";

describe("EditorUiStateService", () => {
    it("does not let one dialog close another", () => {
        const state = new EditorUiStateService();
        state.openDialog("export");
        state.closeDialog("new-project");
        expect(state.activeDialog).toBe("export");
        state.closeDialog("export");
        expect(state.activeDialog).toBeUndefined();
    });
});
