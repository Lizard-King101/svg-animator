import { NgIf, NgStyle } from "@angular/common";
import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, ViewChild } from "@angular/core";
import { Color } from "../../editor/objects/color.object";
import { gradientPreviewCss, isGradientPaint, Paint } from "../../editor/objects/paint.object";
import { floatingPopoverStyle, positionSidePopover } from "../floating-popover";
import { PaintEditorComponent } from "../paint-editor/paint-editor.component";
import { FULL_PAINT_EDITOR_CAPABILITIES, PaintEditorCapabilities, PaintEditorChange } from "../paint-editor/paint-editor.types";

const POPOVER_WIDTH = 280;
const POPOVER_HEIGHT = 620;
/** Clears the side panel's horizontal padding so the popover sits beside the panel, not over it. */
const PANEL_INSET = 12;

/**
 * Compact paint row (swatch, value, opacity) that opens the full paint editor in a popover beside the
 * panel. Edits apply live through `paintChange`; Escape, the row, or an outside press closes it, and a
 * new `owner` (selection change) closes it without returning focus.
 */
@Component({
    selector: "app-paint-field",
    standalone: true,
    imports: [NgIf, NgStyle, PaintEditorComponent],
    templateUrl: "paint-field.component.html",
    styleUrl: "paint-field.component.scss",
})
export class PaintFieldComponent implements OnChanges {
    @Input({ required: true }) label!: string;
    @Input() paint: Paint | null = null;
    @Input() capabilities: PaintEditorCapabilities = FULL_PAINT_EDITOR_CAPABILITIES;
    /** The object being edited; a different owner closes the popover. */
    @Input() owner: unknown;
    @Output() readonly paintChange = new EventEmitter<PaintEditorChange>();

    open = false;
    popoverStyle: Record<string, string> = {};
    @ViewChild("trigger", { static: true }) private trigger!: ElementRef<HTMLButtonElement>;
    @ViewChild("popover") set popover(ref: ElementRef<HTMLElement> | undefined) {
        if(ref && !this.popoverElement) ref.nativeElement.focus({ preventScroll: true });
        this.popoverElement = ref?.nativeElement;
    }
    private popoverElement?: HTMLElement;

    constructor(private host: ElementRef<HTMLElement>) {}

    ngOnChanges(changes: SimpleChanges): void {
        if(changes["owner"] && !changes["owner"].firstChange) this.close(false);
    }

    get preview(): string {
        if(isGradientPaint(this.paint)) return gradientPreviewCss(this.paint);
        return this.paint instanceof Color ? this.paint.serialized : "transparent";
    }

    get summary(): string {
        if(isGradientPaint(this.paint)) return this.paint.type === "radial-gradient" ? "Radial gradient" : "Linear gradient";
        return this.paint instanceof Color ? this.paint.hex.toUpperCase() : "None";
    }

    get opacity(): string {
        return this.paint instanceof Color ? `${Math.round(this.paint.alpha * 100)}%` : "";
    }

    toggle(): void {
        if(this.open) { this.close(); return; }
        this.open = true;
        this.position();
    }

    close(returnFocus = true): void {
        if(!this.open) return;
        this.open = false;
        if(returnFocus) this.trigger.nativeElement.focus({ preventScroll: true });
    }

    key(event: KeyboardEvent): void {
        if(event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        this.close();
    }

    /** The eyedropper shield stops propagation, so sampling a color keeps the popover open. */
    @HostListener("document:pointerdown", ["$event"]) outsidePointer(event: PointerEvent): void {
        if(this.open && event.target instanceof Node && !this.host.nativeElement.contains(event.target)) this.close(false);
    }

    @HostListener("window:resize") position(): void {
        if(!this.open) return;
        this.popoverStyle = floatingPopoverStyle(positionSidePopover(this.trigger.nativeElement.getBoundingClientRect(),
            { width: POPOVER_WIDTH, preferredHeight: POPOVER_HEIGHT, inset: PANEL_INSET }));
    }
}
