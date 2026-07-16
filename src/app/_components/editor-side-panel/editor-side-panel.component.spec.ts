import { ElementRef } from "@angular/core";
import { EditorPreferencesService } from "../../_services/editor-preferences.service";
import { clampPanelRatio, clampPanelWidth, EditorSidePanelComponent } from "./editor-side-panel.component";

describe("EditorSidePanelComponent", () => {
    it("clamps sidebar and section sizes to usable bounds", () => {
        expect(clampPanelWidth(100)).toBe(220);
        expect(clampPanelWidth(900)).toBe(640);
        expect(clampPanelWidth(600, 480)).toBe(480);
        expect(clampPanelRatio(0.05, 600)).toBe(0.2);
        expect(clampPanelRatio(0.95, 600)).toBe(0.8);
    });

    it("resizes and persists the sidebar only when a drag completes", () => {
        const { panel, preferences, handle } = setup();
        panel.beginWidthResize(pointerEvent(handle, { pointerId: 3, clientX: 500 }));
        panel.updateResize(pointerEvent(handle, { pointerId: 3, clientX: 400 }));
        expect(panel.width).toBe(372);
        expect(preferences.setSidePanelWidth).not.toHaveBeenCalled();

        panel.endResize(pointerEvent(handle, { pointerId: 3, clientX: 400 }));
        expect(preferences.setSidePanelWidth).toHaveBeenCalledOnceWith(372);
    });

    it("restores the split when a pointer resize is cancelled", () => {
        const { panel, preferences, handle } = setup();
        panel.beginSplitResize(pointerEvent(handle, { pointerId: 5, clientY: 300 }));
        panel.updateResize(pointerEvent(handle, { pointerId: 5, clientY: 420 }));
        expect(panel.propertiesRatio).toBeCloseTo(0.7, 4);

        panel.cancelResize(pointerEvent(handle, { pointerId: 5, clientY: 420 }));
        expect(panel.propertiesRatio).toBe(0.5);
        expect(preferences.setPropertiesPanelRatio).not.toHaveBeenCalled();
    });
});

function setup() {
    const parent = document.createElement("div");
    const host = document.createElement("app-editor-side-panel");
    parent.appendChild(host);
    Object.defineProperties(parent, { clientWidth: { value: 1000 } });
    Object.defineProperties(host, { clientHeight: { value: 600 } });
    const preferences = {
        sidePanelWidth: 272,
        propertiesPanelRatio: 0.5,
        setSidePanelWidth: jasmine.createSpy("setSidePanelWidth"),
        setPropertiesPanelRatio: jasmine.createSpy("setPropertiesPanelRatio"),
    } as unknown as EditorPreferencesService;
    const panel = new EditorSidePanelComponent(new ElementRef(host), preferences);
    const handle = document.createElement("div");
    spyOn(handle, "setPointerCapture");
    spyOn(handle, "releasePointerCapture");
    return { panel, preferences: preferences as jasmine.SpyObj<EditorPreferencesService>, handle };
}

function pointerEvent(target: HTMLElement, values: Partial<PointerEvent>): PointerEvent {
    return {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        currentTarget: target,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
        ...values,
    } as unknown as PointerEvent;
}
