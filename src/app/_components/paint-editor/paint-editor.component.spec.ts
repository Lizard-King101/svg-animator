import { TestBed } from "@angular/core/testing";
import { Color } from "../../editor/objects/color.object";
import { createDefaultGradient } from "../../editor/objects/paint.object";
import { PaintEditorComponent } from "./paint-editor.component";
import { GRADIENT_STOPS_PAINT_EDITOR_CAPABILITIES } from "./paint-editor.types";

describe("PaintEditorComponent", () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [PaintEditorComponent] }).compileComponents();
    });

    it("places the segmented mode control in the header and renders a selectable ramp", () => {
        const fixture = TestBed.createComponent(PaintEditorComponent);
        const gradient = createDefaultGradient("gradient");
        fixture.componentRef.setInput("label", "Fill Color");
        fixture.componentRef.setInput("paint", gradient);
        fixture.detectChanges();

        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector(".paint-editor-header strong")?.textContent).toContain("Fill Color");
        expect(root.querySelectorAll(".paint-mode-toggle button").length).toBe(2);
        expect(root.querySelector(".paint-ramp")).not.toBeNull();
        expect(root.querySelectorAll(".paint-stop-marker").length).toBe(2);
        expect(root.querySelector(".paint-stop-marker.selected")).not.toBeNull();
    });

    it("hides structural and metadata controls for timeline stop editing", () => {
        const fixture = TestBed.createComponent(PaintEditorComponent);
        fixture.componentRef.setInput("paint", createDefaultGradient("gradient"));
        fixture.componentRef.setInput("capabilities", GRADIENT_STOPS_PAINT_EDITOR_CAPABILITIES);
        fixture.detectChanges();

        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector(".paint-mode-toggle")).toBeNull();
        expect(root.querySelector(".paint-kind-toggle")).toBeNull();
        expect(root.querySelector(".paint-add-stop")).toBeNull();
        expect(root.querySelector(".paint-remove-stop")).toBeNull();
        expect(root.querySelector(".paint-presets")).toBeNull();
        expect(root.querySelector(".paint-advanced")).toBeNull();
        expect(root.querySelector(".paint-selected-stop color")).not.toBeNull();
    });

    it("renders a legacy in-memory stop without an opacity field", async () => {
        const fixture = TestBed.createComponent(PaintEditorComponent);
        const gradient = createDefaultGradient("legacy-gradient");
        gradient.stops[0].color.alpha = 0.4;
        delete (gradient.stops[0] as Partial<typeof gradient.stops[number]>).opacity;

        fixture.componentRef.setInput("paint", gradient);
        expect(() => fixture.detectChanges()).not.toThrow();
        await fixture.whenStable();
        fixture.detectChanges();

        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector(".paint-alpha-field")).toBeNull();
        expect(root.querySelector(".paint-selected-stop color")?.textContent).toContain("Alpha 40%");
        expect(fixture.componentInstance.stopOpacity(gradient.stops[0])).toBe(0.4);
    });

    it("exposes metadata only after opening Advanced", () => {
        const fixture = TestBed.createComponent(PaintEditorComponent);
        fixture.componentRef.setInput("paint", createDefaultGradient("gradient"));
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;

        expect(root.querySelector(".paint-advanced-body")).toBeNull();
        (root.querySelector(".paint-advanced-toggle") as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(root.querySelectorAll(".paint-advanced-body select").length).toBe(2);
        expect(root.querySelector(".paint-advanced-body")?.textContent).toContain("amber handles");
    });

    it("moves stops by keyboard and keeps solid changes typed", () => {
        const fixture = TestBed.createComponent(PaintEditorComponent);
        const component = fixture.componentInstance;
        const gradient = createDefaultGradient("gradient");
        component.paint = gradient;
        component.ngOnChanges({ paint: {} as any });
        const changes: unknown[] = [];
        component.paintChange.subscribe((change) => changes.push(change));
        const event = { key: "ArrowRight", shiftKey: true, preventDefault: jasmine.createSpy("preventDefault") } as unknown as KeyboardEvent;

        component.handleStopKey(gradient.stops[0], event);
        component.paint = new Color("#000000");
        component.setSolidColor(new Color("#abcdef80"));

        expect(changes[0]).toEqual({ type: "stop", stopId: gradient.stops[0].id, field: "offset", value: 0.1 });
        expect(changes[1]).toEqual(jasmine.objectContaining({ type: "solid-color" }));
    });

    it("keeps the empty solid value stable across change detection", () => {
        const fixture = TestBed.createComponent(PaintEditorComponent);
        fixture.componentRef.setInput("paint", null);
        fixture.detectChanges();
        const first = fixture.componentInstance.solid;

        for(let index = 0; index < 25; index += 1) fixture.detectChanges();

        expect(fixture.componentInstance.solid).toBe(first);
    });

    it("projects pointer dragging into a clamped ramp offset", () => {
        const fixture = TestBed.createComponent(PaintEditorComponent);
        const component = fixture.componentInstance;
        const gradient = createDefaultGradient("gradient");
        component.paint = gradient;
        const changes: unknown[] = [];
        component.paintChange.subscribe((change) => changes.push(change));
        (component as any).stopDrag = {
            pointerId: 7,
            stopId: gradient.stops[0].id,
            startOffset: 0,
            ramp: { getBoundingClientRect: () => ({ left: 20, width: 200 }) },
        };

        component.updateStopDrag({ pointerId: 7, clientX: 270, preventDefault: () => undefined } as PointerEvent);

        expect(changes).toEqual([{ type: "stop", stopId: gradient.stops[0].id, field: "offset", value: 1 }]);
    });
});
