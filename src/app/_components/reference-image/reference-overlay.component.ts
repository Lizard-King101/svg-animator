import { Component, HostListener, Input, OnDestroy } from '@angular/core';
import { NgIf, NgStyle } from '@angular/common';
import { ReferenceImageService } from '../../_services/reference-image.service';
import { EditorService } from '../../_services/editor.service';
import { CanvasWorkspaceComponent } from '../canvas-workspace/canvas-workspace.component';
import { canvasToWorkspaceProjection } from '../../editor/canvas-workspace-projection';
import { applyMatrix, Bounds } from '../../editor/objects/transform.object';

@Component({
    selector: 'app-reference-overlay', standalone: true, imports: [NgIf, NgStyle],
    template: `
      <div *ngIf="frame as box" class="reference-frame" [ngStyle]="box"
           (mousedown)="$event.stopPropagation()" (mousemove)="$event.stopPropagation()"
           (click)="$event.stopPropagation()" (dblclick)="$event.stopPropagation()"
           (contextmenu)="$event.preventDefault(); $event.stopPropagation()">
        <button class="move" aria-label="Move reference image" title="Drag to move · arrow keys to nudge · Escape to cancel"
          (pointerdown)="begin($event, false)" (pointermove)="move($event)" (pointerup)="end($event)"
          (pointercancel)="cancel()" (lostpointercapture)="cancel()" (keydown)="key($event, false)"></button>
        <button class="resize" aria-label="Resize reference image" title="Drag to scale · arrow keys to resize · Escape to cancel"
          (pointerdown)="begin($event, true)" (pointermove)="move($event)" (pointerup)="end($event)"
          (pointercancel)="cancel()" (lostpointercapture)="cancel()" (keydown)="key($event, true)"></button>
      </div>`,
    styles: `:host { display:contents; } .reference-frame { position:absolute; z-index:14; pointer-events:none; border:1px dashed var(--accent); }
      button { pointer-events:auto; position:absolute; background:transparent; border:0; padding:0; touch-action:none; }
      .move { inset:0; width:100%; height:100%; cursor:move; }
      .resize { width:14px; height:14px; right:-7px; bottom:-7px; border:2px solid var(--accent); background:var(--bg-surface); cursor:nwse-resize; }
      button:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }`,
})
export class ReferenceOverlayComponent implements OnDestroy {
    @Input({ required: true }) artwork!: SVGElement;
    @Input({ required: true }) workspace!: CanvasWorkspaceComponent;
    private drag?: { pointerId: number; target: HTMLElement; x: number; y: number; resize: boolean; original: Bounds; scale: number };
    constructor(public reference: ReferenceImageService, private editor: EditorService) {}

    get frame(): Record<string, string> | undefined {
        const image = this.reference.display, svg = this.editor.selectedSVG;
        if(!image || image.locked || !image.visible || !svg || !this.artwork || !this.workspace) return undefined;
        const projection = canvasToWorkspaceProjection(this.artwork.getBoundingClientRect(), this.workspace.element.getBoundingClientRect(), svg.canvasBounds);
        const point = applyMatrix(projection.canvasToWorkspace, image.x, image.y);
        return { left: `${point.x}px`, top: `${point.y}px`, width: `${image.width * projection.canvasToWorkspace.a}px`, height: `${image.height * projection.canvasToWorkspace.d}px` };
    }

    begin(event: PointerEvent, resize: boolean): void {
        if(event.button !== 0 || !this.reference.begin()) return;
        event.preventDefault(); event.stopPropagation();
        const target = event.currentTarget as HTMLElement;
        const svg = this.editor.selectedSVG!;
        this.drag = { pointerId: event.pointerId, target, x: event.clientX, y: event.clientY, resize, original: { ...this.reference.image! }, scale: this.artwork.getBoundingClientRect().width / svg.width };
        target.focus({ preventScroll: true });
        target.setPointerCapture(event.pointerId);
    }
    move(event: PointerEvent): void {
        const drag = this.drag;
        if(!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        const dx = (event.clientX - drag.x) / drag.scale, dy = (event.clientY - drag.y) / drag.scale;
        const original = drag.original;
        if(drag.resize) {
            const scale = Math.max(1 / Math.min(original.width, original.height), 1 + (dx * original.width + dy * original.height) / (original.width ** 2 + original.height ** 2));
            this.reference.preview({ ...original, width: original.width * scale, height: original.height * scale });
        } else this.reference.preview({ ...original, x: original.x + dx, y: original.y + dy });
    }
    end(event: PointerEvent): void {
        if(this.drag?.pointerId !== event.pointerId) return;
        this.move(event);
        const drag = this.drag;
        this.drag = undefined;
        this.reference.finish();
        drag.target.releasePointerCapture(drag.pointerId);
    }
    @HostListener('window:blur') cancel(): void {
        const drag = this.drag;
        this.drag = undefined;
        this.reference.cancel();
        if(drag?.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
    }
    key(event: KeyboardEvent, resize: boolean): void {
        if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancel(); return; }
        const image = this.reference.image;
        if(!image || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if(this.drag) return;
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        if(resize) this.reference.number('width', String(Math.max(1, image.width + dx + dy)));
        else this.reference.update({ x: image.x + dx, y: image.y + dy });
    }
    ngOnDestroy(): void { this.cancel(); }
}
