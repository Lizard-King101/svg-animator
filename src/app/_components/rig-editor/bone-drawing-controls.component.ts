import { Component, DoCheck, HostListener, Input, OnDestroy } from '@angular/core';
import { NgIf } from '@angular/common';
import { BoneDrawingService } from '../../_services/bone-drawing.service';
import { BoneTool } from '../../_services/tools/bone.tool';
import { CanvasWorkspaceComponent } from '../canvas-workspace/canvas-workspace.component';
import { canvasToWorkspaceProjection } from '../../editor/canvas-workspace-projection';
import { applyMatrix } from '../../editor/objects/transform.object';
import { boneDiamond } from '../../editor/bone-glyph';
import { bindToolKeyboard } from '../../editor/tool-keyboard';

@Component({
    selector: 'app-bone-drawing-controls', standalone: true, imports: [NgIf],
    template: `<ng-container *ngIf="drawing.selected && drawing.rigs.canEdit">
      <svg *ngIf="guide as guide" aria-hidden="true"><polygon *ngIf="drawing.draft?.kind === 'bone'" [attr.points]="guide.diamond"/><g *ngIf="drawing.draft?.kind === 'point'"><circle [attr.cx]="guide.x" [attr.cy]="guide.y" r="9"/><path [attr.d]="guide.cross"/></g></svg>
      <div class="rig-hud" role="status" aria-label="Bone tool">
        <span class="rig-hud-group">Parent <strong>{{drawing.rigs.bone?.name ?? 'New armature'}}</strong></span>
        <span class="rig-hud-group">Drag: bone · Click: point</span>
        <span class="rig-hud-group">Start on a tip to connect</span>
        <span class="rig-hud-group"><kbd>Shift</kbd> 15° steps</span>
        <span class="rig-hud-group"><kbd>Esc</kbd> cancel</span>
      </div></ng-container>`,
    styleUrl: './rig-panel.scss',
    styles: `:host {display:contents;} svg {position:absolute; inset:0; width:100%; height:100%; z-index:23; pointer-events:none;} polygon,circle,path {stroke:var(--accent); stroke-width:2; fill:var(--bg-surface); fill-opacity:.7;} .rig-hud {pointer-events:none;}`,
})
export class BoneDrawingControlsComponent implements DoCheck, OnDestroy {
    @Input({ required: true }) artwork!: SVGElement;
    @Input({ required: true }) workspace!: CanvasWorkspaceComponent;
    private tool?: BoneTool;
    private unbind: () => void;
    constructor(public drawing: BoneDrawingService) {
        this.tool = drawing.rigs.editor.tools.find((tool): tool is BoneTool => tool instanceof BoneTool);
        if(this.tool) this.tool.drawing = drawing;
        this.unbind = bindToolKeyboard(() => !!drawing.draft, key => { if(key === 'Escape') drawing.cancel(); }, () => drawing.cancel());
    }
    get guide() {
        const draft = this.drawing.draft, svg = this.drawing.rigs.editor.selectedSVG; if(!draft || !svg) return undefined;
        const matrix = canvasToWorkspaceProjection(this.artwork.getBoundingClientRect(), this.workspace.element.getBoundingClientRect(), svg.canvasBounds).canvasToWorkspace;
        const start = applyMatrix(matrix, draft.start.x, draft.start.y), end = applyMatrix(matrix, draft.end.x, draft.end.y);
        return { ...start, diamond: boneDiamond(start, end), cross: `M${start.x - 13} ${start.y}h26 M${start.x} ${start.y - 13}v26` };
    }
    ngDoCheck(): void { this.drawing.validate(); }
    @HostListener('window:blur') blur(): void { this.drawing.cancel(); }
    ngOnDestroy(): void { this.unbind(); this.drawing.cancel(); if(this.tool) this.tool.drawing = undefined; }
}
