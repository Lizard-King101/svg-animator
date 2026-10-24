import { EditorService } from './editor.service';
import { EditorPreferencesService } from "./editor-preferences.service";

describe("EditorPreferencesService panel layout", () => {
    const storageKey = "svg-animator.editor-preferences.v1";

    afterEach(() => localStorage.removeItem(storageKey));

    it('normalizes persisted drawing colors, preserves no paint and rejects malformed values', () => {
        localStorage.setItem(storageKey, JSON.stringify({ drawingPaint: { fill: null, stroke: '#abcd' } }));
        const preferences = new EditorPreferencesService();
        expect(preferences.drawingPaint).toEqual({ fill: null, stroke: '#aabbccdd', strokeWidth: 2 });
        const copy = preferences.drawingPaint; copy.stroke = '#000000';
        expect(preferences.drawingPaint.stroke).toBe('#aabbccdd');
        localStorage.setItem(storageKey, JSON.stringify({ drawingPaint: { fill: 'garbage', stroke: 123, strokeWidth: 'wide' } }));
        expect(new EditorPreferencesService().drawingPaint).toEqual({ fill: '#2dd4bf', stroke: '#2dd4bf', strokeWidth: 2 });
        localStorage.setItem(storageKey, JSON.stringify({ drawingPaint: { fill: null, stroke: null, strokeWidth: -4 } }));
        expect(new EditorPreferencesService().drawingPaint.strokeWidth).toBe(0);
    });

    it('merges partial drawing default updates and persists the stroke width', () => {
        const preferences = new EditorPreferencesService();
        preferences.setDrawingPaint({ fill: '#ff0000', stroke: '#00ff00', strokeWidth: 2 });
        preferences.setDrawingPaint({ strokeWidth: 6.5 });
        expect(new EditorPreferencesService().drawingPaint).toEqual({ fill: '#ff0000', stroke: '#00ff00', strokeWidth: 6.5 });
    });

    it("loads defaults for panel sizes saved before the fields existed", () => {
        localStorage.setItem(storageKey, JSON.stringify({
            version: 1, tool: "select", zoom: 1, mode: "edit", timelineHeight: 310,
        }));

        const preferences = new EditorPreferencesService();

        expect(preferences.sidePanelWidth).toBe(272);
        expect(preferences.propertiesPanelRatio).toBe(0.5);
        expect(preferences.objectSnapping).toBeTrue();
    });

    it('remembers disabled object snapping independently of document data', () => {
        const preferences = new EditorPreferencesService();
        preferences.setObjectSnapping(false);
        expect(new EditorPreferencesService().objectSnapping).toBeFalse();
    });

    for(const [saved, group, child] of [['pen', 'paths', 'pen'], ['line', 'paths', 'line'], ['circle', 'shapes', 'ellipse']]) {
        it(`restores saved ${saved} into its current group`, () => {
            const preferences = new EditorPreferencesService(); preferences.setTool(saved);
            const editor = new EditorService(preferences);
            expect(editor.selectedTool?.preferenceKey).toBe(group);
            expect(editor.selectedTool?.selectedChild?.preferenceKey).toBe(child);
            expect(editor.selectedTool?.selectedChild?.selected).toBeTrue();
            expect(preferences.tool).toBe(child);
        });
    }

    it("persists clamped panel dimensions", () => {
        const preferences = new EditorPreferencesService();
        preferences.setSidePanelWidth(900);
        preferences.setPropertiesPanelRatio(0.05);

        const restored = new EditorPreferencesService();
        expect(restored.sidePanelWidth).toBe(640);
        expect(restored.propertiesPanelRatio).toBe(0.2);
    });
});
