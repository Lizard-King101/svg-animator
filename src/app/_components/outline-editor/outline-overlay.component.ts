import { Component, DoCheck, HostListener, Input, OnDestroy } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { closestOutlinePosition, outlineContourSegments, outlinePositionPoint, outlineSectionPathData } from '../../../../packages/runtime/src/outline';
import { OutlineEditingService } from '../../_services/outline-editing.service';
import { CanvasWorkspaceComponent } from '../canvas-workspace/canvas-workspace.component';
import { canvasToWorkspaceProjection } from '../../editor/canvas-workspace-projection';
import { combinedMotionAdjustedMatrixFor } from '../../editor/objects/motion-path.object';
import { applyMatrix, invertMatrix, Matrix, matrixToSvg, multiplyMatrix } from '../../editor/objects/transform.object';
import { pathOutlineContours } from '../../editor/path-outline';
import { outlinePositionFromValue, outlinePositionValue } from '../../editor/outline-editing';

@Component({
    selector: 'app-outline-overlay', standalone: true, imports: [NgFor, NgIf],
    template: `<ng-container *ngIf="outline.path as path">
      <svg aria-label="Outline editing">
        <rect class="background" width="100%" height="100%" aria-label="Exit outline editing" (pointerdown)="shieldBackground($event)" (click)="dismissBackground($event)" />
        <g [attr.transform]="transform">
        <path class="source" [attr.d]="path.raw" />
        <path *ngFor="let segment of segments; trackBy: track" class="segment" [class.selected]="outline.picking === 'segments' && outline.selectedSegmentIds.includes(segment.id)" [class.pickable]="outline.picking === 'segments'" [attr.d]="segment.data" tabindex="0" role="button" [attr.aria-label]="'Select source segment ' + segment.index" (click)="outline.selectSegment(segment.id, $event.shiftKey)" (keydown)="chooseKey($event, segment.id, true)" />
        <path *ngFor="let section of sections; index as i; trackBy: track" class="section" [class.selected]="outline.selectedIds.includes(section.id)" [class.pickable]="outline.picking === 'sections'" [attr.d]="section.data" tabindex="0" role="button" [attr.aria-label]="'Select outline section ' + (i + 1)" (click)="outline.select(section.id, $event.shiftKey)" (keydown)="chooseKey($event, section.id, false)" />
      </g></svg>
      <button *ngFor="let marker of markers; trackBy: track" class="endpoint" [class.end]="marker.end === 'end'" [style.left.px]="marker.x" [style.top.px]="marker.y" [attr.aria-label]="marker.label" [title]="marker.label + ' · Drag along contour · Arrow keys adjust · Shift: larger step'" (pointerdown)="begin($event, marker.sectionId, marker.end)" (pointermove)="move($event)" (pointerup)="finish($event)" (pointercancel)="cancel()" (lostpointercapture)="cancel()" (blur)="cancel()" (keydown)="key($event, marker.sectionId, marker.end)">{{marker.end === 'start' ? 'S' : 'E'}}</button>
    </ng-container>`,
    styles: `:host {display:contents;} svg {position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:25; overflow:visible;} .background {fill:transparent; pointer-events:all;} path {fill:none; vector-effect:non-scaling-stroke;} .source {stroke:var(--text-secondary); opacity:.4; stroke-width:2; stroke-dasharray:4 4;} .segment {stroke:transparent; stroke-width:12;} .section {stroke:var(--accent); opacity:.4; stroke-width:3;} .section.selected {opacity:1; stroke-width:4;} .segment.selected {stroke:var(--accent); opacity:.5; stroke-width:6;} .pickable {pointer-events:stroke; cursor:pointer;} path:focus-visible {stroke:var(--text-primary); opacity:1; outline:none;} .endpoint {position:absolute; z-index:26; transform:translate(-50%,-110%); width:20px; height:20px; padding:0; background:var(--bg-base); color:var(--accent); border:2px solid var(--accent); border-radius:var(--radius-sm); font-size:10px; font-weight:700; cursor:ew-resize; touch-action:none;} .endpoint.end {transform:translate(-50%,10%); border-radius:50%;} .endpoint:focus-visible {outline:2px solid var(--text-primary); outline-offset:2px;}`,
})
export class OutlineOverlayComponent implements DoCheck, OnDestroy {
    @Input({required: true}) artwork!: SVGElement;
    @Input({required: true}) workspace!: CanvasWorkspaceComponent;
    private drag?: { pointer: number; capture: HTMLElement; sectionId: string; end: 'start' | 'end'; inverse: Matrix; left: number; top: number; x: number; y: number; origin: {x: number; y: number} };
    constructor(public outline: OutlineEditingService) {}
    @HostListener('mousedown', ['$event']) stop(event: MouseEvent): void { if(event.button !== 1) event.stopPropagation(); }
    @HostListener('click', ['$event']) stopClick(event: MouseEvent): void { event.stopPropagation(); }
    @HostListener('dblclick', ['$event']) stopDoubleClick(event: MouseEvent): void { event.stopPropagation(); }
    @HostListener('contextmenu', ['$event']) stopMenu(event: MouseEvent): void { event.preventDefault(); event.stopPropagation(); }
    shieldBackground(event: PointerEvent): void { if(event.button === 0) event.stopPropagation(); }
    dismissBackground(event: MouseEvent): void {
        event.stopPropagation();
        if(event.button !== 0) return;
        event.preventDefault(); this.cancel(); this.outline.end();
    }
    private get matrix(): Matrix | undefined {
        const svg = this.outline.editor.selectedSVG, path = this.outline.path;
        if(!svg || !path || !this.artwork || !this.workspace) return undefined;
        const projection = canvasToWorkspaceProjection(this.artwork.getBoundingClientRect(), this.workspace.element.getBoundingClientRect(), svg.canvasBounds).canvasToWorkspace;
        return multiplyMatrix(projection, combinedMotionAdjustedMatrixFor(svg, path));
    }
    get transform(): string | null { const matrix = this.matrix; return matrix ? matrixToSvg(matrix) : null; }
    get segments() {
        const path = this.outline.path; if(!path) return [];
        return pathOutlineContours(path).flatMap(contour => outlineContourSegments(contour).map((line, i) => ({ id: line.id, index: i + 1,
            data: outlineSectionPathData(contour, {id: line.id, contourId: contour.id, start: {segmentId: line.id, t: 0}, end: {segmentId: line.id, t: 1}}) })));
    }
    get sections() {
        const path = this.outline.path; if(!path) return [];
        const contours = pathOutlineContours(path);
        return this.outline.sections.flatMap(section => { const contour = contours.find(contour => contour.id === section.contourId); return contour ? [{id: section.id, data: outlineSectionPathData(contour, section)}] : []; });
    }
    get markers() {
        const path = this.outline.path, matrix = this.matrix; if(!path || !matrix || this.outline.picking !== 'sections') return [];
        const contours = pathOutlineContours(path);
        return this.outline.selected.flatMap(section => {
            const contour = contours.find(contour => contour.id === section.contourId); if(!contour) return [];
            return (['start', 'end'] as const).flatMap(end => {
                const point = outlinePositionPoint(contour, section[end]);
                return point ? [{ id: `${section.id}:${end}`, sectionId: section.id, end, label: `${end === 'start' ? 'Start' : 'End'} of outline section ${this.outline.sections.findIndex(item => item.id === section.id) + 1}`, ...applyMatrix(matrix, point.x, point.y) }] : [];
            });
        });
    }
    track(_index: number, value: { id: string }): string { return value.id; }
    begin(event: PointerEvent, sectionId: string, end: 'start' | 'end'): void {
        event.stopPropagation(); if(event.button !== 0 || !this.matrix) return;
        event.preventDefault(); this.cancel();
        const capture = event.currentTarget as HTMLElement, rect = this.workspace.element.getBoundingClientRect(); capture.focus();
        const section = this.outline.sections.find(section => section.id === sectionId), path = this.outline.path;
        const contour = path && pathOutlineContours(path).find(contour => contour.id === section?.contourId);
        const origin = contour && section && outlinePositionPoint(contour, section[end]);
        if(!origin) return;
        if(!this.outline.startPreview()) return;
        this.drag = { pointer: event.pointerId, capture, sectionId, end, inverse: invertMatrix(this.matrix), left: rect.left, top: rect.top, x: event.clientX, y: event.clientY, origin };
        capture.setPointerCapture(event.pointerId);
    }
    move(event: PointerEvent): void {
        this.ngDoCheck(); const drag = this.drag, path = this.outline.path;
        if(!drag || !path || event.pointerId !== drag.pointer) return;
        event.stopPropagation(); event.preventDefault();
        if(Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) { this.outline.resetPreview(); return; }
        const section = this.outline.sections.find(section => section.id === drag.sectionId), contour = pathOutlineContours(path).find(contour => contour.id === section?.contourId);
        const start = applyMatrix(drag.inverse, drag.x - drag.left, drag.y - drag.top), current = applyMatrix(drag.inverse, event.clientX - drag.left, event.clientY - drag.top);
        const local = {x: drag.origin.x + current.x - start.x, y: drag.origin.y + current.y - start.y};
        const position = contour && closestOutlinePosition(contour, local);
        if(position) this.outline.previewEndpoint(drag.sectionId, drag.end, position);
    }
    finish(event: PointerEvent): void {
        if(this.drag?.pointer !== event.pointerId) return;
        this.move(event); if(!this.drag) return;
        const drag = this.drag; this.drag = undefined; this.outline.commit();
        if(drag.capture.hasPointerCapture(drag.pointer)) drag.capture.releasePointerCapture(drag.pointer);
    }
    chooseKey(event: KeyboardEvent, id: string, segment: boolean): void {
        if(event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault(); event.stopPropagation();
        if(segment) this.outline.selectSegment(id, event.shiftKey); else this.outline.select(id, event.shiftKey);
    }
    key(event: KeyboardEvent, sectionId: string, end: 'start' | 'end'): void {
        if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancel(); return; }
        if(!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); this.cancel();
        const section = this.outline.sections.find(section => section.id === sectionId), contour = this.outline.path?.contours.find(contour => contour.id === section?.contourId);
        if(!section || !contour) return;
        const step = (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1) * (event.shiftKey ? .1 : .01);
        this.outline.previewEndpoint(sectionId, end, outlinePositionFromValue(contour, outlinePositionValue(contour, section[end]) + step)); this.outline.commit();
    }
    @HostListener('window:blur') cancel(): void {
        const drag = this.drag; this.drag = undefined; this.outline.cancel();
        if(drag?.capture.hasPointerCapture(drag.pointer)) drag.capture.releasePointerCapture(drag.pointer);
    }
    @HostListener('document:keydown', ['$event']) escape(event: KeyboardEvent): void {
        if(event.key !== 'Escape' || !this.outline.active || event.defaultPrevented) return;
        event.preventDefault(); event.stopPropagation(); if(this.outline.previewing) this.cancel(); else this.outline.end();
    }
    ngDoCheck(): void { this.outline.validate(); if(this.drag && !this.outline.previewing) this.cancel(); }
    ngOnDestroy(): void { this.cancel(); }
}
