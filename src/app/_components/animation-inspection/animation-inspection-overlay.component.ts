import { NgFor, NgIf } from '@angular/common';
import { Component, Input } from '@angular/core';
import { AnimationInspectionService } from '../../_services/animation-inspection.service';
import { EditorService } from '../../_services/editor.service';
import { canvasToWorkspaceProjection } from '../../editor/canvas-workspace-projection';
import { applyMatrix } from '../../editor/objects/transform.object';
import { CanvasWorkspaceComponent } from '../canvas-workspace/canvas-workspace.component';

@Component({
    selector: 'svg[animationInspection]', standalone: true, imports: [NgFor, NgIf],
    host: { 'class': 'animation-inspection editor-overlay', 'aria-hidden': 'true', 'width': '100%', 'height': '100%' },
    styles: [`:host { position:absolute; inset:0; pointer-events:none !important; z-index:10 !important; overflow:hidden; }
        image { pointer-events:none; } .past { filter:sepia(1) saturate(2) hue-rotate(115deg); }
        .future { filter:sepia(1) saturate(3); }
        path { fill:none; stroke:var(--accent); stroke-width:1.5; stroke-dasharray:4 3; }
        circle { fill:var(--bg-panel, #14141a); stroke:var(--accent); stroke-width:1.5; }
        .current { fill:var(--accent); } text { fill:var(--text-primary, #dddde8); font:10px sans-serif; paint-order:stroke; stroke:var(--bg-panel, #14141a); stroke-width:3px; }`],
    template: `<ng-container *ngIf="view as v">
        <svg:image *ngFor="let skin of v.skins" [attr.href]="skin.image" [attr.x]="v.frame.x" [attr.y]="v.frame.y"
            [attr.width]="v.frame.width" [attr.height]="v.frame.height" [attr.opacity]="skin.opacity" [attr.class]="skin.direction" />
        <svg:g *ngFor="let trail of v.trails">
            <svg:path [attr.d]="trail.path" />
            <svg:g *ngFor="let tick of trail.ticks"><svg:circle [attr.cx]="tick.x" [attr.cy]="tick.y" r="3" />
                <svg:text *ngIf="tick.label" [attr.x]="tick.x + 6" [attr.y]="tick.y - 6">{{ tick.time }}s</svg:text></svg:g>
            <svg:circle *ngIf="trail.current as point" class="current" [attr.cx]="point.x" [attr.cy]="point.y" r="4" />
        </svg:g>
    </ng-container>`,
})
export class AnimationInspectionOverlayComponent {
    @Input({ required: true }) artwork?: SVGElement;
    @Input({ required: true }) workspace?: CanvasWorkspaceComponent;
    constructor(public inspection: AnimationInspectionService, private editor: EditorService) {}
    get view() {
        const display = this.inspection.display, svg = this.editor.selectedSVG;
        if(!display || !svg || !this.artwork || !this.workspace) return undefined;
        const projection = canvasToWorkspaceProjection(this.artwork.getBoundingClientRect(), this.workspace.element.getBoundingClientRect(), svg.canvasBounds);
        const project = (point: { x: number; y: number }) => applyMatrix(projection.canvasToWorkspace, point.x, point.y);
        const labels: { x: number; y: number }[] = [];
        return { frame: projection.canvasFrame, skins: display.skins, trails: display.trails.map(trail => {
            const current = display.current.get(trail.id);
            return { path: trail.segments.map(segment => segment.map((point, index) => {
                const p = project(point); return `${index ? 'L' : 'M'} ${p.x} ${p.y}`;
            }).join(' ')).join(' '), ticks: trail.ticks.map(point => {
                const p = project(point);
                const label = !labels.some(other => Math.abs(other.x - p.x) < 48 && Math.abs(other.y - p.y) < 16);
                if(label) labels.push(p);
                return { ...p, label, time: Number(point.time.toFixed(2)) };
            }),
                current: current ? project(current) : undefined };
        }) };
    }
}
