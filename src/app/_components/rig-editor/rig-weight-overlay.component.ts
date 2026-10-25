import { AfterViewChecked, Component, DoCheck, ElementRef, HostListener, Input, OnDestroy } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { RigEditingService } from '../../_services/rig-editing.service';
import { RigBindingSessionService, WEIGHT_TOOLS } from '../../_services/rig-binding-session.service';
import { weightHeatColor } from '../../editor/rig-weight-colors';
import { isEditableEventTarget } from '../../editor/editable-event-target';
import { DocumentMutationService } from '../../_services/document-mutation.service';
import { CanvasWorkspaceComponent } from '../canvas-workspace/canvas-workspace.component';
import { canvasToWorkspaceProjection } from '../../editor/canvas-workspace-projection';
import { applyMatrix } from '../../editor/objects/transform.object';
import { combinedMotionAdjustedMatrixFor } from '../../editor/objects/motion-path.object';
import { BoneWeight, WeightPointRef, weightOwner } from '../../editor/objects/armature';
import { BrushPosition, WeightBrushPoint, WeightBrushStroke } from '../../editor/rig-weight-brush';
import { pointWeightState } from '../../editor/rig-weight-editing';

interface ProjectedWeightPoint extends BrushPosition {
    id: string; pathId: string; pointId: string; ownerKey: string; ownerPathId: string; ownerPointId: string;
    handle: boolean; inherited: boolean; anchor: BrushPosition; label: string; pathName: string;
    weights: BoneWeight[]; boneIds: string[]; lockedBoneIds: string[]; editable: boolean; color: string; percent: number;
}
interface WeightCluster extends BrushPosition { id: string; points: ProjectedWeightPoint[]; groups: ProjectedWeightPoint[][]; color: string; handle: boolean; }
interface WeightGestureContext {
    pointerId: number; capture: HTMLElement; context: string; revision: number; tool: unknown; projection: string; selection: string;
}
interface WeightPaintGesture extends WeightGestureContext { kind: 'paint'; stroke: WeightBrushStroke; previous: BrushPosition; }
interface WeightSelectGesture extends WeightGestureContext { kind: 'select'; start: BrushPosition; current: BrushPosition; additive: boolean; points: ProjectedWeightPoint[]; }

/** Owns projected point inspection and a reversible, frozen-weight brush gesture. */
@Component({
    selector: 'app-rig-weight-overlay', standalone: true, imports: [NgFor, NgIf],
    template: `<ng-container *ngIf="enabled">
      <div class="paint-surface" [class.select-surface]="!painting" tabindex="0" [attr.aria-label]="painting ? 'Weight painting canvas' : 'Weight point selection canvas'" (pointerdown)="begin($event)" (pointermove)="move($event)" (pointerup)="end($event)" (pointercancel)="cancel()" (lostpointercapture)="cancel()" (pointerleave)="leave()" (blur)="captureBlur($event)" (mousedown)="$event.stopPropagation()"></div>
      <svg class="weight-handles" aria-hidden="true"><ng-container *ngFor="let point of points; trackBy: track"><line *ngIf="point.handle" [class.independent]="!point.inherited" [attr.x1]="point.x" [attr.y1]="point.y" [attr.x2]="point.anchor.x" [attr.y2]="point.anchor.y" /></ng-container>
        <g *ngIf="painting && cursor" class="brush" [attr.data-tool]="session.paintMode"><circle class="brush-ring" [attr.cx]="cursor.x" [attr.cy]="cursor.y" [attr.r]="session.brushRadius" /><circle class="brush-half" [attr.cx]="cursor.x" [attr.cy]="cursor.y" [attr.r]="session.brushRadius / 2" /><circle class="brush-center" [attr.cx]="cursor.x" [attr.cy]="cursor.y" r="1.5" /></g>
        <rect *ngIf="marquee as box" class="selection-box" [attr.x]="box.x" [attr.y]="box.y" [attr.width]="box.width" [attr.height]="box.height" />
      </svg>
      <button *ngFor="let cluster of clusters; trackBy: track" class="weight-point" [class.weight-handle]="cluster.handle" [class.overlapping]="cluster.groups.length > 1" [class.selected]="selected(cluster)" [style.left.px]="cluster.x" [style.top.px]="cluster.y" [style.background]="cluster.color" [attr.aria-label]="clusterLabel(cluster)" [title]="clusterLabel(cluster) + (painting ? ' · Drag to paint; Alt-click to inspect' : '')"
        (pointerdown)="pointDown($event, cluster)" (pointermove)="move($event)" (pointerup)="end($event)" (pointercancel)="cancel()" (lostpointercapture)="cancel()" (blur)="captureBlur($event)" (mousedown)="$event.stopPropagation()" (click)="choose($event, cluster)" (keydown)="pointKey($event, cluster)">{{cluster.groups.length > 1 ? cluster.groups.length : ''}}</button>
      <div class="rig-hud" role="status" aria-label="Weight brush">
        <span class="rig-hud-group"><span class="rig-swatch" [style.background]="rig.boneId ? session.color(rig.boneId) : null" aria-hidden="true"></span><strong>{{boneName}}</strong></span>
        <span>{{toolLabel}}<ng-container *ngIf="painting"> · {{session.brushRadius}}px · {{brushPercent(session.brushStrength)}}%<ng-container *ngIf="session.paintMode === 'set'"> → {{brushPercent(session.brushValue)}}%</ng-container></ng-container></span>
        <span class="rig-hud-group"><kbd>1</kbd>–<kbd>5</kbd> tools</span>
        <ng-container *ngIf="painting"><span class="rig-hud-group"><kbd>[</kbd><kbd>]</kbd> size</span><span class="rig-hud-group"><kbd>Shift</kbd><kbd>[</kbd><kbd>]</kbd> strength</span><span class="rig-hud-group"><kbd>Alt</kbd> click overlaps</span></ng-container>
        <span *ngIf="!painting" class="rig-hud-group"><kbd>Shift</kbd> add · <kbd>Ctrl</kbd><kbd>A</kbd> all</span>
      </div>
      <section *ngIf="popover as popover" class="overlap-popover" role="dialog" aria-label="Overlapping point weights" [style.left.px]="popover.x" [style.top.px]="popover.y" (pointerdown)="$event.stopPropagation()" (mousedown)="$event.stopPropagation()" (focusout)="popoverFocusOut($event)" (keydown.escape)="closePopover($event)">
        <header><strong>Overlapping points</strong><button aria-label="Close overlapping points" (click)="closePopover()">×</button></header>
        <p>Choose a group, or add several to the selection. Painting follows your selection.</p>
        <div *ngFor="let group of popover.groups; index as index" class="weight-group">
          <div class="group-heading"><button class="group-selection" [attr.aria-pressed]="session.isSelected(group[0])" (click)="selectMember(group[0], true)">{{session.isSelected(group[0]) ? 'Remove' : 'Add'}} group {{index + 1}}</button><label [title]="group[0].lockedBoneIds.includes(rig.boneId!) ? 'This influence is locked' : boneName"><input type="number" min="0" max="100" step="1" [attr.aria-label]="'Weight group ' + (index + 1) + ' ' + boneName + ' weight'" [value]="group[0].percent" [disabled]="!group[0].editable || !group[0].boneIds.includes(rig.boneId!) || group[0].lockedBoneIds.includes(rig.boneId!)" (blur)="groupWeight(group[0], $event)" (keydown)="fieldKey($event, group[0].percent)" />%</label></div>
          <button *ngFor="let point of group; trackBy: track" class="member" [attr.aria-pressed]="session.isSelected(point)" (click)="selectMember(point, $event.shiftKey)"><span class="swatch" [style.background]="point.color"></span>{{point.pathName}} · {{point.label}}<small *ngIf="point.inherited">inherits anchor</small></button>
        </div>
      </section>
    </ng-container>`,
    styleUrl: './rig-panel.scss',
    styles: `:host {display:contents;} .rig-hud {pointer-events:none;} .paint-surface {position:absolute; inset:0; z-index:22; cursor:crosshair; touch-action:none;} .select-surface {z-index:19; cursor:default;} .paint-surface:focus {outline:none;} .paint-surface:focus-visible {outline:2px solid var(--accent); outline-offset:-2px;} .weight-handles {position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:23; overflow:visible;} .weight-handles line {stroke:var(--text-secondary); stroke-width:1; stroke-dasharray:3 2;} .weight-handles line.independent {stroke:var(--accent); stroke-dasharray:none;} .brush {--tool:var(--accent);} .brush[data-tool=subtract] {--tool:var(--danger);} .brush[data-tool=set] {--tool:var(--text-primary);} .brush[data-tool=smooth] {--tool:var(--text-secondary);} .brush-ring {stroke:var(--tool); stroke-width:1.5; fill:var(--tool); fill-opacity:.07;} .brush-half {stroke:var(--tool); stroke-width:1; stroke-dasharray:3 3; stroke-opacity:.6; fill:var(--tool); fill-opacity:.07;} .brush-center {fill:var(--tool);} .selection-box {stroke:var(--accent); stroke-width:1; fill:var(--accent); fill-opacity:.12;}
      .weight-point {position:absolute; transform:translate(-50%,-50%); z-index:24; width:12px; height:12px; padding:0; border:1px solid var(--text-primary); border-radius:50%; touch-action:none; cursor:pointer; color:var(--bg-base); font-size:9px; font-weight:700; line-height:17px;} .weight-handle {width:9px; height:9px; border-radius:2px;} .overlapping {width:20px; height:20px;} .weight-point.selected,.weight-point:focus-visible {outline:2px solid var(--text-primary); outline-offset:2px;}
      .overlap-popover {position:absolute; z-index:40; width:288px; box-sizing:border-box; max-width:calc(100% - 16px); max-height:min(360px,calc(100% - 16px)); overflow:auto; padding:10px; background:var(--bg-elevated); color:var(--text-primary); border:1px solid var(--border-bright); border-radius:var(--radius-sm); box-shadow:0 8px 24px #0005; font-size:11px;} header,.group-heading {display:flex; align-items:center; justify-content:space-between; gap:8px;} header button {border:0; background:transparent; color:var(--text-secondary); font-size:18px; cursor:pointer;} p {margin:7px 0; color:var(--text-secondary); line-height:1.5;} .weight-group {padding:8px 0; border-top:1px solid var(--border);} .group-heading label {display:flex; align-items:center; gap:3px;} .group-selection {padding:3px; background:var(--bg-surface); color:var(--text-primary); border:1px solid var(--border); border-radius:var(--radius-sm); cursor:pointer; font:inherit;} .group-selection[aria-pressed=true] {border-color:var(--accent);} input {width:54px; color:var(--text-primary); background:var(--bg-input); border:1px solid var(--border); border-radius:var(--radius-sm); padding:3px;} .member {width:100%; display:flex; align-items:center; gap:6px; padding:5px 3px; text-align:left; color:var(--text-secondary); background:transparent; border:0; border-radius:var(--radius-sm); cursor:pointer; font:inherit;} .member[aria-pressed=true] {color:var(--text-primary); background:var(--bg-surface);} .member small {margin-left:auto; color:var(--text-secondary);} .swatch {width:10px; height:10px; flex:none; border:1px solid var(--border-bright); border-radius:50%;} .overlap-popover button:focus-visible,.overlap-popover input:focus-visible {outline:2px solid var(--accent); outline-offset:1px;}`,
})
export class RigWeightOverlayComponent implements AfterViewChecked, DoCheck, OnDestroy {
    @Input({ required: true }) artwork!: SVGElement;
    @Input({ required: true }) workspace!: CanvasWorkspaceComponent;
    cursor?: BrushPosition;
    popover?: { x: number; y: number; groups: ProjectedWeightPoint[][]; context: string; revision: number; tool: unknown; projection: string; trigger?: HTMLElement };
    private gesture?: WeightPaintGesture | WeightSelectGesture;
    private suppressClick = false;
    private focusPopoverPending = false;
    private shortcuts = new AbortController();
    constructor(public rig: RigEditingService, public session: RigBindingSessionService, private mutations: DocumentMutationService, private element: ElementRef<HTMLElement>) {
        // Capture before artwork shortcuts: while weights are open, [ and ] size the brush instead of reordering layers.
        document.addEventListener('keydown', event => this.shortcut(event), { capture: true, signal: this.shortcuts.signal });
    }
    get toolLabel(): string { return WEIGHT_TOOLS.find(tool => tool.mode === this.session.paintMode)?.label ?? 'Select'; }
    brushPercent(value: number): number { return Math.round(value * 100); }
    /** 1–5 choose tools; [ ] change size; Shift+[ ] change strength. Text fields and modified keys pass through. */
    shortcut(event: KeyboardEvent): void {
        if(!this.enabled || !this.element.nativeElement.isConnected || event.ctrlKey || event.metaKey || event.altKey || isEditableEventTarget(event.target)) return;
        const tool = WEIGHT_TOOLS.find(item => item.key === event.key), bracket = event.code === 'BracketLeft' || event.key === '[' || event.key === '{' ? -1 : event.code === 'BracketRight' || event.key === ']' || event.key === '}' ? 1 : 0;
        if(tool) this.session.setPaintMode(tool.mode);
        else if(bracket && event.shiftKey) this.session.stepBrushStrength(bracket);
        else if(bracket) this.session.stepBrushSize(bracket);
        else return;
        event.preventDefault(); event.stopImmediatePropagation();
    }
    get enabled(): boolean { return this.rig.visible && this.rig.canEdit && this.rig.workspace === 'weights' && !!this.session.weightRig && !this.session.pending; }
    get painting(): boolean { return this.enabled && this.session.weightRig?.id === this.rig.activeId && this.session.paintMode !== 'select'; }
    get boneName(): string { return this.rig.bone?.name ?? 'selected bone'; }
    track(_index: number, point: { id: string }): string { return point.id; }
    private get projection() {
        const svg = this.rig.editor.selectedSVG;
        return svg && this.artwork && this.workspace ? canvasToWorkspaceProjection(this.artwork.getBoundingClientRect(), this.workspace.element.getBoundingClientRect(), svg.canvasBounds).canvasToWorkspace : undefined;
    }
    private get context(): string { return this.session.scopeKey + ':' + this.session.paintMode + ':' + this.session.brushRadius + ':' + this.session.brushStrength + ':' + this.session.brushValue; }
    get points(): ProjectedWeightPoint[] {
        const svg = this.rig.editor.selectedSVG, source = this.session.weightRig, projection = this.projection;
        if(!svg || !source || !projection) return [];
        const paths = new Map(this.session.scopeBindings.map(entry => [entry.path.id, entry.path]));
        const preview = new Map(this.session.previewUpdates.map(entry => [pointKey(entry.pathId, entry.pointId), entry.weights]));
        return this.session.pointEntries.flatMap(entry => {
            const path = paths.get(entry.pathId), actual = path?.findPointById(entry.pointId), anchorPoint = path?.findPointById(entry.point.anchorId);
            if(!path || !actual || !anchorPoint) return [];
            const matrix = combinedMotionAdjustedMatrixFor(svg, path), world = applyMatrix(matrix, actual.x, actual.y), anchorWorld = applyMatrix(matrix, anchorPoint.x, anchorPoint.y);
            const owner = weightOwner(source, entry.pathId, entry.pointId), ownerKey = pointKey(owner.pathId, owner.pointId);
            const state = pointWeightState(source, entry), weights = preview.get(ownerKey) ?? state.weights;
            const weight = weights.find(value => value.boneId === this.rig.boneId)?.weight ?? 0, heat = this.session.weightDisplay === 'heat';
            let offset = 0;
            const stops = weights.map(value => { const start = offset; offset += value.weight*100; return `${this.session.color(value.boneId)} ${start}% ${offset}%`; });
            return [{ id: pointKey(entry.pathId, entry.pointId), pathId: entry.pathId, pointId: entry.pointId, ownerKey, ownerPathId: owner.pathId, ownerPointId: owner.pointId,
                ...applyMatrix(projection, world.x, world.y), anchor: applyMatrix(projection, anchorWorld.x, anchorWorld.y),
                handle: entry.point.id !== entry.point.anchorId, inherited: entry.point.id !== entry.point.anchorId && !entry.point.independent,
                label: entry.label.startsWith(entry.pathName + ' · ') ? entry.label.slice(entry.pathName.length + 3) : entry.label, pathName: entry.pathName, weights, boneIds: state.boneIds, lockedBoneIds: state.lockedBoneIds, editable: !state.rigid,
                color: heat ? (state.boneIds.includes(this.rig.boneId ?? '') ? weightHeatColor(weight) : 'var(--text-muted)') : stops.length ? `conic-gradient(${stops.join(',')})` : 'var(--bg-surface)', percent: Math.round(weight*10000)/100 }];
        });
    }
    get clusters(): WeightCluster[] { return clusterWeightPoints(this.points); }
    get marquee(): {x: number; y: number; width: number; height: number} | undefined {
        const gesture = this.gesture;
        if(gesture?.kind !== 'select' || Math.hypot(gesture.current.x-gesture.start.x, gesture.current.y-gesture.start.y) < 3) return undefined;
        return {x:Math.min(gesture.start.x,gesture.current.x), y:Math.min(gesture.start.y,gesture.current.y), width:Math.abs(gesture.current.x-gesture.start.x), height:Math.abs(gesture.current.y-gesture.start.y)};
    }
    private get marqueePoints(): ProjectedWeightPoint[] {
        const box = this.marquee;
        return this.gesture?.kind === 'select' && box ? this.gesture.points.filter(point => point.x >= box.x && point.x <= box.x+box.width && point.y >= box.y && point.y <= box.y+box.height) : [];
    }
    selected(cluster: WeightCluster): boolean {
        if(this.marquee && this.gesture?.kind === 'select') {
            const owners = new Set(this.marqueePoints.map(point => point.ownerKey));
            return cluster.points.some(point => owners.has(point.ownerKey) || (this.gesture?.kind === 'select' && this.gesture.additive && this.session.isSelected(point)));
        }
        return cluster.points.some(point => this.session.isSelected(point));
    }
    clusterLabel(cluster: WeightCluster): string { return cluster.groups.length > 1 ? `${cluster.groups.length} independent weight groups at this position` : `${cluster.points[0].pathName}, ${cluster.points[0].label}: ${cluster.points[0].percent}% ${this.boneName}`; }
    choose(event: MouseEvent, cluster: WeightCluster): void {
        event.stopPropagation();
        if(this.suppressClick) { this.suppressClick = false; return; }
        if(cluster.groups.length > 1) {
            this.cancel(); const rect = this.workspace.element.getBoundingClientRect();
            this.popover = { x: Math.max(8, Math.min(cluster.x+16, rect.width-312)), y: Math.max(24, Math.min(cluster.y+16, rect.height-320)), groups: cluster.groups, context: this.context, revision: this.mutations.revision, tool: this.rig.editor.activeTool, projection: JSON.stringify(this.projection), trigger: event.currentTarget as HTMLElement };
            this.focusPopoverPending = true;
        } else {
            this.dismissPopover(false);
            this.session.selectPoint({ pathId: cluster.points[0].pathId, pointId: cluster.points[0].pointId }, !!event.shiftKey);
        }
    }
    selectMember(point: ProjectedWeightPoint, additive = false): void { this.session.selectPoint({ pathId: point.pathId, pointId: point.pointId }, additive); }
    pointDown(event: PointerEvent, _cluster: WeightCluster): void {
        event.stopPropagation(); this.suppressClick = false;
        if(this.painting && !event.altKey && !event.shiftKey) this.begin(event);
    }
    pointKey(event: KeyboardEvent, cluster: WeightCluster): void {
        if(event.key === 'Enter') this.suppressClick = false;
        if(event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation();
            if(this.gesture) this.cancel(); else if(this.popover) this.closePopover(); else this.session.clearSelection();
            return;
        }
        if(event.key !== ' ' || !this.painting) return;
        event.preventDefault(); event.stopPropagation();
        this.session.cancelPreview();
        const stroke = this.createStroke(); stroke?.sample(cluster);
        const updates = stroke?.updates() ?? [];
        if(updates.length) this.rig.applyWeightUpdates(updates);
    }
    private createStroke(): WeightBrushStroke | undefined {
        if(!this.painting || !this.rig.boneId || this.rig.problem) return undefined;
        const selected = new Set(this.session.selectedRefs.map(ref => pointKey(ref.pathId, ref.pointId)));
        const points: WeightBrushPoint[] = this.points.filter(point => point.editable && (!selected.size || selected.has(pointKey(point.ownerPathId,point.ownerPointId))))
            .map(point => ({ key: point.ownerKey, pathId: point.ownerPathId, pointId: point.ownerPointId, x: point.x, y: point.y, weights: point.weights, boneIds: point.boneIds, lockedBoneIds: point.lockedBoneIds }));
        return new WeightBrushStroke(points, { mode: this.session.paintMode as 'add' | 'subtract' | 'set' | 'smooth', boneId: this.rig.boneId, radius: this.session.brushRadius, strength: this.session.brushStrength, value: this.session.brushValue });
    }
    begin(event: PointerEvent): void {
        event.stopPropagation(); if(event.button !== 0 || event.altKey || !this.enabled) return;
        this.cancel(); this.closePopover(); this.suppressClick = false;
        this.session.cancelPreview();
        event.preventDefault(); const capture = event.currentTarget as HTMLElement, point = this.local(event);
        // Settle the previous control's blur before installing the new gesture.
        capture.focus();
        const context: WeightGestureContext = { pointerId: event.pointerId, capture, context: this.context, revision: this.mutations.revision, tool: this.rig.editor.activeTool, projection: JSON.stringify(this.projection), selection: this.session.selectionKey };
        if(this.painting) {
            const stroke = this.createStroke(); if(!stroke) return;
            this.gesture = { ...context, kind:'paint', stroke, previous: point };
            this.cursor = point; stroke.sample(point); this.session.setBrushPreview(stroke.updates());
        } else this.gesture = { ...context, kind:'select', start:point, current:point, additive:!!event.shiftKey, points:this.points };
        capture.setPointerCapture(event.pointerId);
    }
    move(event: PointerEvent): void {
        this.ngDoCheck(); if(!this.enabled) return;
        const point = this.local(event); if(this.painting) this.cursor = point;
        const gesture = this.gesture; if(!gesture || gesture.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        if(gesture.kind === 'paint') { gesture.stroke.sample(gesture.previous, point); gesture.previous = point; this.session.setBrushPreview(gesture.stroke.updates()); }
        else gesture.current = point;
    }
    end(event: PointerEvent): void {
        if(this.gesture?.pointerId !== event.pointerId) return;
        this.move(event); const gesture = this.gesture; if(!gesture) return;
        event.stopPropagation();
        if(gesture.kind === 'paint') {
            const updates = gesture.stroke.updates(); this.cancel(); this.suppressClick = true;
            if(updates.length) this.rig.applyWeightUpdates(updates);
        } else {
            const refs: WeightPointRef[] = this.marqueePoints.map(point => ({pathId:point.pathId,pointId:point.pointId}));
            const additive = gesture.additive; this.cancel(); this.suppressClick = false;
            if(refs.length) this.session.selectPoints(refs, additive); else if(!additive) this.session.clearSelection();
        }
    }
    private local(event: PointerEvent): BrushPosition { const rect = this.workspace.element.getBoundingClientRect(); return { x: event.clientX-rect.left, y: event.clientY-rect.top }; }
    leave(): void { if(!this.gesture) this.cursor = undefined; }
    groupWeight(point: ProjectedWeightPoint, event: Event): void {
        const input = event.target as HTMLInputElement, value = input.valueAsNumber;
        if(!this.rig.boneId || !Number.isFinite(value) || value < 0 || value > 100 || value === point.percent) { input.value = String(point.percent); return; }
        if(!point.editable || point.lockedBoneIds.includes(this.rig.boneId)) { input.value = String(point.percent); return; }
        this.rig.setPointWeight({ pathId: point.ownerPathId, pointId: point.ownerPointId }, this.rig.boneId, value/100);
        this.closePopover();
    }
    fieldKey(event: KeyboardEvent, original: number): void {
        if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); (event.target as HTMLInputElement).value = String(original); (event.target as HTMLInputElement).blur(); this.closePopover(); }
        if(event.key === 'Enter') { event.preventDefault(); (event.target as HTMLInputElement).blur(); }
    }
    closePopover(event?: Event): void { event?.preventDefault(); event?.stopPropagation(); this.dismissPopover(true); }
    private dismissPopover(restoreFocus: boolean): void {
        const trigger = this.popover?.trigger; this.popover = undefined; this.focusPopoverPending = false;
        if(restoreFocus) trigger?.focus();
    }
    popoverFocusOut(event: FocusEvent): void {
        const panel = event.currentTarget as HTMLElement;
        if(event.relatedTarget && !panel.contains(event.relatedTarget as Node)) this.dismissPopover(false);
    }
    @HostListener('document:pointerdown', ['$event']) outside(event: PointerEvent): void { if(this.popover && !this.element.nativeElement.contains(event.target as Node)) this.closePopover(); }
    // Handle focused point commands before document-level artwork shortcuts.
    @HostListener('keydown', ['$event']) focusedKey(event: KeyboardEvent): void { this.key(event); }
    @HostListener('document:keydown', ['$event']) key(event: KeyboardEvent): void {
        if(event.key === 'Escape' && (this.gesture || this.popover)) { event.preventDefault(); event.stopPropagation(); this.cancel(); this.closePopover(); return; }
        const target = event.target;
        if(!this.enabled || !(target instanceof HTMLElement) || !this.element.nativeElement.contains(target) || target.matches('input,textarea,[contenteditable=true]')) return;
        if(event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); this.session.selectAll(); }
        if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.session.clearSelection(); }
    }
    @HostListener('window:blur') blur(): void { this.cancel(); this.closePopover(); }
    captureBlur(event: FocusEvent): void { if(event.target === this.gesture?.capture) this.cancel(); }
    cancel(): void {
        const gesture = this.gesture; this.gesture = undefined; this.cursor = undefined;
        if(gesture) this.suppressClick = true;
        if(gesture?.kind === 'paint') this.session.cancelPreview('brush');
        if(gesture?.capture.hasPointerCapture(gesture.pointerId)) gesture.capture.releasePointerCapture(gesture.pointerId);
    }
    ngDoCheck(): void {
        const gesture = this.gesture;
        if(gesture && (!this.enabled || (gesture.kind === 'paint' && !this.painting) || gesture.context !== this.context || gesture.selection !== this.session.selectionKey || gesture.revision !== this.mutations.revision || gesture.tool !== this.rig.editor.activeTool || gesture.projection !== JSON.stringify(this.projection))) this.cancel();
        if(this.popover && (!this.enabled || this.popover.context !== this.context || this.popover.revision !== this.mutations.revision || this.popover.tool !== this.rig.editor.activeTool || this.popover.projection !== JSON.stringify(this.projection))) this.dismissPopover(false);
    }
    ngAfterViewChecked(): void {
        if(!this.popover) return;
        const panel = this.element.nativeElement.querySelector<HTMLElement>('.overlap-popover');
        if(panel) {
            const bounds = this.workspace.element.getBoundingClientRect(), size = panel.getBoundingClientRect();
            panel.style.left = Math.max(8,Math.min(this.popover.x,bounds.width-size.width-8))+'px';
            panel.style.top = Math.max(8,Math.min(this.popover.y,bounds.height-size.height-8))+'px';
        }
        if(!this.focusPopoverPending) return;
        const control = this.element.nativeElement.querySelector<HTMLElement>('.overlap-popover button');
        if(control) { this.focusPopoverPending = false; control.focus(); }
    }
    ngOnDestroy(): void { this.shortcuts.abort(); this.cancel(); this.dismissPopover(false); }
}

function pointKey(pathId: string, pointId: string): string { return JSON.stringify([pathId, pointId]); }

/** Independent owners remain separately addressable even when their screen coordinates coincide. */
export function clusterWeightPoints(points: readonly ProjectedWeightPoint[]): WeightCluster[] {
    const positions = new Map<string, ProjectedWeightPoint[]>();
    for(const point of points) { const key = `${Math.round(point.x*1000)},${Math.round(point.y*1000)}`; const group = positions.get(key) ?? []; group.push(point); positions.set(key, group); }
    return [...positions].map(([id, points]) => {
        const owners = new Map<string, ProjectedWeightPoint[]>();
        for(const point of points) { const group = owners.get(point.ownerKey) ?? []; group.push(point); owners.set(point.ownerKey, group); }
        return { id, x: points[0].x, y: points[0].y, points, groups: [...owners.values()], color: points[0].color, handle: points.every(point => point.handle) };
    });
}
