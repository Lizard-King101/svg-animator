import { TestBed } from "@angular/core/testing";
import { Color } from "../../editor/objects/color.object";
import { createDefaultGradient } from "../../editor/objects/paint.object";
import { PaintFieldComponent } from "./paint-field.component";

describe("PaintFieldComponent", () => {
    afterEach(() => TestBed.resetTestingModule());

    async function create() {
        await TestBed.configureTestingModule({ imports: [PaintFieldComponent] }).compileComponents();
        const fixture = TestBed.createComponent(PaintFieldComponent);
        fixture.componentRef.setInput("label", "Fill");
        fixture.componentRef.setInput("owner", "first");
        fixture.componentRef.setInput("paint", new Color("#12345680"));
        document.body.appendChild(fixture.nativeElement);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const trigger = root.querySelector("button.paint-field") as HTMLButtonElement;
        return { fixture, root, trigger };
    }

    it("summarizes solid, gradient, and missing paints", async () => {
        const { fixture, root, trigger } = await create();
        expect(trigger.getAttribute("aria-label")).toBe("Fill: #123456, 50% opacity");
        expect(root.querySelector(".opacity")?.textContent).toBe("50%");
        fixture.componentRef.setInput("paint", createDefaultGradient("gradient")); fixture.detectChanges();
        expect(trigger.getAttribute("aria-label")).toBe("Fill: Linear gradient");
        expect(root.querySelector(".opacity")).toBeNull();
        expect((root.querySelector(".swatch span") as HTMLElement).style.background).toContain("linear-gradient");
        fixture.componentRef.setInput("paint", null); fixture.detectChanges();
        expect(trigger.getAttribute("aria-label")).toBe("Fill: None");
        fixture.nativeElement.remove();
    });

    it("opens a focused editor popover that relays edits and closes on Escape, outside presses, and owner changes", async () => {
        const { fixture, root, trigger } = await create();
        const changes: unknown[] = [];
        fixture.componentInstance.paintChange.subscribe((change) => changes.push(change));

        trigger.click(); fixture.detectChanges();
        const popover = root.querySelector("[role=dialog]") as HTMLElement;
        expect(popover).toBeTruthy();
        expect(document.activeElement).toBe(popover);
        expect(popover.style.maxHeight).not.toBe("");
        expect([...popover.querySelectorAll("input[type=range]")].map((slider) => slider.getAttribute("aria-label")))
            .toEqual(["Hue", "Saturation", "Lightness", "Opacity"]);
        root.querySelector<HTMLButtonElement>("app-project-colors button.swatch, .paint-mode-toggle button:last-child")?.click();
        expect(changes.length).toBe(1);

        popover.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); fixture.detectChanges();
        expect(root.querySelector("[role=dialog]")).toBeNull();
        expect(document.activeElement).toBe(trigger);

        trigger.click(); fixture.detectChanges();
        root.querySelector("[role=dialog]")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        expect(fixture.componentInstance.open).toBeTrue();
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); fixture.detectChanges();
        expect(root.querySelector("[role=dialog]")).toBeNull();

        trigger.click(); fixture.detectChanges();
        fixture.componentRef.setInput("owner", "second"); fixture.detectChanges();
        expect(root.querySelector("[role=dialog]")).toBeNull();
        fixture.nativeElement.remove();
    });
});
