import { Component, DoCheck, ElementRef, HostListener, Optional, ViewChild } from '@angular/core';
import { NgIf, NgStyle } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { EditorService } from '../../_services/editor.service';
import { Color } from '../../editor/objects/color.object';
import { DrawingPaint, drawingColorVisible } from '../../editor/objects/drawing-paint';
import { ColorAttribute } from '../attributes/color/color.component';
import { NumberFieldDirective } from '../attributes/number/number-field.directive';
import { floatingPopoverStyle, positionFloatingPopover } from '../floating-popover';
import { ProjectColorsComponent } from '../project-colors/project-colors.component';
import { ProjectColorsService } from '../../_services/project-colors.service';

type DrawingColorTarget = 'fill' | 'stroke';

const POPOVER_WIDTH = 264;
const POPOVER_HEIGHT = 520;

/** Header controls for new-artwork fill, stroke, and stroke width, with a staged color popover. */
@Component({
    selector: 'app-drawing-colors', standalone: true,
    imports: [NgIf, NgStyle, FormsModule, FaIconComponent, ColorAttribute, NumberFieldDirective, ProjectColorsComponent],
    templateUrl: './drawing-colors.component.html',
    styleUrl: './drawing-colors.component.scss',
})
export class DrawingColorsComponent implements DoCheck {
    target?: DrawingColorTarget;
    draft = new Color('#2dd4bf');
    none = false;
    popoverStyle: Record<string, string> = {};
    private trigger?: HTMLElement;
    private context?: { document: unknown; tool: unknown };

    @ViewChild('popover') set popover(ref: ElementRef<HTMLElement> | undefined) {
        if(ref && ref.nativeElement !== this.popoverElement) ref.nativeElement.focus({ preventScroll: true });
        this.popoverElement = ref?.nativeElement;
    }
    private popoverElement?: HTMLElement;

    constructor(public preferences: EditorPreferencesService, private editor: EditorService, private host: ElementRef<HTMLElement>,
        @Optional() private palette: ProjectColorsService | null = null) {}
    get paint(): DrawingPaint { return this.preferences.drawingPaint; }
    get warning(): string {
        const paint = this.paint;
        if(!drawingColorVisible(paint.stroke) || paint.strokeWidth <= 0) return drawingColorVisible(paint.fill)
            ? 'Open paths, lines, and arcs will be invisible without a visible stroke.'
            : 'New artwork will be invisible. Choose a visible fill or stroke.';
        return '';
    }
    begin(target: DrawingColorTarget, trigger: HTMLElement): void {
        if(this.target === target) { this.cancel(); return; }
        this.target = target; this.trigger = trigger;
        const value = this.paint[target]; this.none = value === null;
        this.draft = new Color(value ?? '#2dd4bf');
        this.context = { document: this.editor.selectedSVG, tool: this.editor.activeTool };
        this.position();
    }
    setColor(color: Color): void { this.draft = color; this.none = false; }
    apply(): void {
        if(this.target) this.commitColor(this.target, this.none ? null : this.draft.serialized);
        this.cancel();
    }
    chooseColor(value: string): void {
        if(this.target) this.setColor(new Color(value));
    }
    setStrokeWidth(value: number): void { this.preferences.setDrawingPaint({ strokeWidth: value }); }
    private commitColor(target: DrawingColorTarget, value: string | null): void {
        this.preferences.setDrawingPaint({ [target]: value });
        if(value) this.palette?.remember(value);
    }
    swap(): void {
        this.cancel(false);
        const { fill, stroke } = this.paint;
        this.preferences.setDrawingPaint({ fill: stroke, stroke: fill });
        this.palette?.remember([fill, stroke].filter((color): color is string => color !== null));
    }
    cancel(returnFocus = true): void {
        this.target = undefined; this.context = undefined;
        if(returnFocus) this.trigger?.focus({ preventScroll: true });
        this.trigger = undefined;
    }
    key(event: KeyboardEvent): void {
        if(event.key !== 'Escape' || !this.target) return;
        event.preventDefault(); event.stopPropagation(); this.cancel();
    }
    /** Pointer presses outside the controls discard the draft; the eyedropper shield stops propagation. */
    @HostListener('document:pointerdown', ['$event']) outsidePointer(event: PointerEvent): void {
        if(this.target && event.target instanceof Node && !this.host.nativeElement.contains(event.target)) this.cancel(false);
    }
    @HostListener('window:resize') position(): void {
        if(!this.trigger) return;
        this.popoverStyle = floatingPopoverStyle(positionFloatingPopover(this.trigger.getBoundingClientRect(),
            { width: POPOVER_WIDTH, preferredHeight: POPOVER_HEIGHT }));
    }
    ngDoCheck(): void {
        if(this.context && (this.context.document !== this.editor.selectedSVG || this.context.tool !== this.editor.activeTool)) this.cancel(false);
    }
}
