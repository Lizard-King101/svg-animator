import { Component, DoCheck, Optional } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { EditorService } from '../../_services/editor.service';
import { Color } from '../../editor/objects/color.object';
import { DrawingPaint, drawingColorVisible } from '../../editor/objects/drawing-paint';
import { ColorAttribute } from '../attributes/color/color.component';
import { ProjectColorsComponent } from '../project-colors/project-colors.component';
import { ProjectColorsService } from '../../_services/project-colors.service';

@Component({
    selector: 'app-drawing-colors', standalone: true,
    imports: [NgIf, FormsModule, ColorAttribute, ProjectColorsComponent],
    templateUrl: './drawing-colors.component.html',
    styleUrl: './drawing-colors.component.scss',
})
export class DrawingColorsComponent implements DoCheck {
    target?: keyof DrawingPaint;
    activeTarget: keyof DrawingPaint = 'fill';
    draft = new Color('#2dd4bf');
    none = false;
    private trigger?: HTMLElement;
    private context?: { document: unknown; tool: unknown };

    constructor(public preferences: EditorPreferencesService, private editor: EditorService,
        @Optional() private palette: ProjectColorsService | null = null) {}
    get paint(): DrawingPaint { return this.preferences.drawingPaint; }
    get warning(): string {
        if(!drawingColorVisible(this.paint.stroke)) return drawingColorVisible(this.paint.fill)
            ? 'Open paths, lines, and arcs will be invisible without a visible stroke.'
            : 'New artwork will be invisible. Choose a visible fill or stroke.';
        return '';
    }
    begin(target: keyof DrawingPaint, trigger: HTMLElement): void {
        if(this.target === target) { this.cancel(); return; }
        this.target = target; this.activeTarget = target; this.trigger = trigger;
        const value = this.paint[target]; this.none = value === null;
        this.draft = new Color(value ?? '#2dd4bf');
        this.context = { document: this.editor.selectedSVG, tool: this.currentTool };
    }
    setColor(color: Color): void { this.draft = color; this.none = false; }
    apply(): void {
        if(this.target) this.commitColor(this.target, this.none ? null : this.draft.serialized);
        this.cancel();
    }
    chooseColor(value: string): void {
        if(this.target) this.setColor(new Color(value));
        else this.commitColor(this.activeTarget, value);
    }
    private commitColor(target: keyof DrawingPaint, value: string | null): void {
        this.preferences.setDrawingPaint({ ...this.paint, [target]: value });
        if(value) this.palette?.remember(value);
    }
    swap(): void {
        this.cancel(false);
        this.preferences.setDrawingPaint({ fill: this.paint.stroke, stroke: this.paint.fill });
        this.palette?.remember([this.paint.fill, this.paint.stroke].filter((color): color is string => color !== null));
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
    ngDoCheck(): void {
        if(this.context && (this.context.document !== this.editor.selectedSVG || this.context.tool !== this.currentTool)) this.cancel(false);
    }
    private get currentTool() { return this.editor.selectedTool?.selectedChild ?? this.editor.selectedTool; }
}
