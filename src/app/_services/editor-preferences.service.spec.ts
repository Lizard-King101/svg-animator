import { EditorPreferencesService } from "./editor-preferences.service";

describe("EditorPreferencesService panel layout", () => {
    const storageKey = "svg-animator.editor-preferences.v1";

    afterEach(() => localStorage.removeItem(storageKey));

    it("loads defaults for panel sizes saved before the fields existed", () => {
        localStorage.setItem(storageKey, JSON.stringify({
            version: 1, tool: "select", zoom: 1, mode: "edit", timelineHeight: 310,
        }));

        const preferences = new EditorPreferencesService();

        expect(preferences.sidePanelWidth).toBe(272);
        expect(preferences.propertiesPanelRatio).toBe(0.5);
    });

    it("persists clamped panel dimensions", () => {
        const preferences = new EditorPreferencesService();
        preferences.setSidePanelWidth(900);
        preferences.setPropertiesPanelRatio(0.05);

        const restored = new EditorPreferencesService();
        expect(restored.sidePanelWidth).toBe(640);
        expect(restored.propertiesPanelRatio).toBe(0.2);
    });
});
