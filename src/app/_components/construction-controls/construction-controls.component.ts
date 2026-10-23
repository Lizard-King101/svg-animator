import { Component, DoCheck, HostListener, Input, OnDestroy } from '@angular/core';
import { NgIf } from '@angular/common';
import { ConstructionDrawingService } from '../../_services/construction-drawing.service';
import { ConstructionTool } from '../../_services/tools/construction.tool';
import { EditorService } from '../../_services/editor.service';
import { CanvasWorkspaceComponent } from '../canvas-workspace/canvas-workspace.component';
import { canvasToWorkspaceProjection } from '../../editor/canvas-workspace-projection';
import { applyMatrix } from '../../editor/objects/transform.object';
import { bindToolKeyboard } from '../../editor/tool-keyboard';

@Component({
    selector: 'app-construction-controls', standalone: true, imports: [NgIf],
    template: `
      <svg *ngIf="guide as points" class="construction-guide" aria-hidden="true">
        <line [attr.x1]="points.origin.x" [attr.y1]="points.origin.y" [attr.x2]="points.end.x" [attr.y2]="points.end.y" stroke="var(--accent)" stroke-dasharray="3 4" />
        <circle [attr.cx]="points.origin.x" [attr.cy]="points.origin.y" r="4" fill="var(--bg-surface)" stroke="var(--accent)" />
      </svg>
      <div *ngIf="selected" class="construction-status" (mousedown)="$event.stopPropagation()" (click)="$event.stopPropagation()">
        <span>{{ drawing.hint }}</span>
        <button *ngIf="drawing.active" class="btn btn-sm btn-secondary" (click)="drawing.cancel()">Cancel</button>
      </div>`,
    styles: `:host { display:contents; } .construction-guide { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:2; }
      .construction-status { position:absolute; left:32px; bottom:12px; z-index:15; max-width:calc(100% - 48px); display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--border); border-radius:var(--radius-md); color:var(--text-secondary); background:var(--bg-surface); font-size:11px; }`,
})
export class ConstructionControlsComponent implements DoCheck, OnDestroy {
    @Input({ required: true }) artwork!: SVGElement;
    @Input({ required: true }) workspace!: CanvasWorkspaceComponent;
    private tools: ConstructionTool[];
    private unbindKeys: () => void;
    get selected(): boolean { return this.editor.selectedTool?.selectedChild instanceof ConstructionTool; }
    constructor(public drawing: ConstructionDrawingService, private editor: EditorService) {
        this.tools = editor.tools.flatMap(tool => tool.children).filter((tool): tool is ConstructionTool => tool instanceof ConstructionTool);
        this.tools.forEach(tool => tool.drawing = drawing);
        this.unbindKeys = bindToolKeyboard(() => drawing.active, key => drawing.key(key), () => drawing.cancel());
    }
    get guide() {
        const guide = this.drawing.guide, svg = this.editor.selectedSVG;
        if(!guide || !svg || !this.artwork || !this.workspace) return undefined;
        const matrix = canvasToWorkspaceProjection(this.artwork.getBoundingClientRect(), this.workspace.element.getBoundingClientRect(), svg.canvasBounds).canvasToWorkspace;
        return { origin: applyMatrix(matrix, guide.origin.x, guide.origin.y), end: applyMatrix(matrix, guide.end.x, guide.end.y) };
    }
    ngDoCheck(): void { if(!this.selected) this.drawing.cancel(); else this.drawing.validate(); }
    @HostListener('window:blur') blur(): void { this.drawing.cancel(); }
    ngOnDestroy(): void {
        this.unbindKeys(); this.drawing.cancel(); this.tools.forEach(tool => tool.drawing = undefined);
    }
}
