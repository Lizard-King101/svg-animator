import { trimPlacement, PlacementTrimEdge, PlacementTrimChange } from '../../editor/animation/placement-trimming';
import { Component, ElementRef, HostListener, Input, OnDestroy } from '@angular/core';
import { ActionCompositionService } from '../../_services/action-composition.service';
import { DocumentMutationService } from '../../_services/document-mutation.service';
import { snapTimelineTime, timelineXToTime } from '../../_services/timeline-editing.service';
import { ActionPlacement, placementTiming } from '../../editor/objects/animation.object';

/** Align either block edge to a scene landmark without changing its duration. */
export function snapPlacementStart(start: number, duration: number, landmarks: readonly number[], threshold: number): number {
    let result = snapTimelineTime(start), distance = threshold;
    for(const landmark of landmarks) for(const edge of [0, duration]) {
        const candidate = landmark - edge, delta = Math.abs(candidate - start);
        if(candidate >= 0 && delta <= distance) { result = candidate; distance = delta; }
    }
    return Math.max(0, result);
}

@Component({
    selector: 'app-action-placement-block', standalone: true,
    template: `<button type="button" [style.left.px]="padding + (start - domainStart) * scale" [style.width.px]="duration * scale"
        [attr.aria-label]="name + ', starts at ' + start + ' seconds'"
        title="Drag to move; Alt bypasses snapping. Arrow keys move 0.01s, Shift moves 0.1s. Enter previews."
        (pointerdown)="begin($event)" (pointermove)="update($event)" (pointerup)="finish($event)"
        (pointercancel)="cancel()" (lostpointercapture)="cancel()" (keydown)="key($event)" (click)="preview()">{{name}}</button>
        <button class="trim-handle" [style.left.px]="padding + (start - domainStart) * scale - 8"
          [attr.aria-label]="'Trim start of ' + name" title="Trim source In; opposite scene edge stays fixed. Arrow keys adjust; Alt bypasses snapping."
          (pointerdown)="begin($event, 'in')" (pointermove)="update($event)" (pointerup)="finish($event)" (pointercancel)="cancel()" (lostpointercapture)="cancel()" (keydown)="key($event, 'in')">‹</button>
        <button class="trim-handle" [style.left.px]="padding + (start + duration - domainStart) * scale"
          [attr.aria-label]="'Trim end of ' + name" title="Trim source Out; opposite scene edge stays fixed. Arrow keys adjust; Alt bypasses snapping."
          (pointerdown)="begin($event, 'out')" (pointermove)="update($event)" (pointerup)="finish($event)" (pointercancel)="cancel()" (lostpointercapture)="cancel()" (keydown)="key($event, 'out')">›</button>`,
    styles: [`:host { display:block; position:relative; height:24px; background:var(--bg-base); overflow:hidden; }
        button { position:absolute; height:24px; min-width:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
            color:inherit; background:var(--bg-base); border:1px solid var(--accent); border-radius:var(--radius-sm);
            padding:3px 6px; font:inherit; touch-action:none; cursor:grab; }
        .trim-handle { width:8px; padding:0; z-index:1; cursor:ew-resize; border-radius:0; }
        button:active { cursor:grabbing; } .trim-handle:active { cursor:ew-resize; } button:focus-visible { outline:2px solid var(--accent); outline-offset:-3px; }`],
})
export class ActionPlacementBlockComponent implements OnDestroy {
    @Input({ required: true }) placement!: ActionPlacement;
    @Input() pixelsPerSecond?: number;
    @Input() padding = 0;
    @Input() domainStart = 0;
    get scale(): number { return this.pixelsPerSecond ?? this.host.nativeElement.getBoundingClientRect().width / this.sceneDuration; }
    private trimDraft?: PlacementTrimChange;
    private drag?: { kind: 'move' | PlacementTrimEdge; original: ActionPlacement; sourceDuration: number; pointer: number; x: number; start: number; scale: number; revision: number; document: unknown; moved: boolean; button: HTMLElement };
    private draft?: number;
    private suppressClick = false;
    private contextSubscription = this.actions.playback.contextChanging.subscribe(() => this.cancel());
    constructor(public actions: ActionCompositionService, private host: ElementRef<HTMLElement>, private mutations: DocumentMutationService) {}
    get start(): number { return this.trimDraft?.start ?? this.draft ?? this.placement.start; }
    get duration(): number { return placementTiming({ ...this.placement, ...this.trimDraft }, this.actions.action(this.placement.actionId)?.animation.duration ?? 1).duration; }
    get sceneDuration(): number { return this.actions.editor.selectedSVG?.animation.duration ?? 1; }
    get name(): string { return this.actions.action(this.placement.actionId)?.name ?? 'Action'; }
    begin(event: PointerEvent, kind: 'move' | PlacementTrimEdge = 'move'): void {
        if(event.button !== 0 || this.drag) return;
        const scale = this.scale;
        if(scale <= 0) return;
        event.stopPropagation(); this.actions.playback.pause(); this.suppressClick = false;
        const button = event.currentTarget as HTMLElement;
        this.drag = { kind, original: { ...this.placement }, sourceDuration: this.actions.action(this.placement.actionId)?.animation.duration ?? 1, pointer: event.pointerId, x: event.clientX, start: this.placement.start, scale,
            revision: this.mutations.revision, document: this.actions.editor.selectedSVG, moved: false, button };
        button.setPointerCapture(event.pointerId);
    }
    update(event: PointerEvent): void {
        const drag = this.drag;
        if(!drag || drag.pointer !== event.pointerId) return;
        if(drag.revision !== this.mutations.revision || drag.document !== this.actions.editor.selectedSVG) { this.cancel(); return; }
        if(!drag.moved && Math.abs(event.clientX - drag.x) < 3) return;
        drag.moved = true;
        const proposed = drag.start + timelineXToTime(event.clientX - drag.x, 0, drag.scale);
        const landmarks = [0, this.actions.playback.currentTime, ...this.actions.placements.filter(p => p.id !== this.placement.id)
            .flatMap(p => [p.start, p.start + placementTiming(p, this.actions.action(p.actionId)?.animation.duration ?? 1).duration])];
        if(drag.kind === 'move') this.draft = event.altKey ? Math.max(0, proposed) : snapPlacementStart(proposed, this.duration, landmarks, 8 / drag.scale);
        else {
            const endOffset = drag.kind === 'out' ? placementTiming(drag.original, drag.sourceDuration).duration : 0;
            const edge = proposed + endOffset;
            this.trimDraft = trimPlacement(drag.original, drag.sourceDuration, drag.kind,
                event.altKey ? edge : snapPlacementStart(edge, 0, landmarks, 8 / drag.scale));
        }
    }
    finish(event: PointerEvent): void {
        if(this.drag?.pointer !== event.pointerId) return;
        this.update(event);
        const moved = this.drag?.moved, start = this.draft, trim = this.trimDraft;
        this.cancel(); this.suppressClick = !!moved;
        if(moved && trim) this.actions.retime(this.placement, trim);
        else if(moved && start != null) this.actions.move(this.placement, start);
    }
    @HostListener('window:blur') cancel(): void {
        const drag = this.drag; this.drag = undefined; this.draft = undefined; this.trimDraft = undefined;
        if(drag) { this.suppressClick = true; if(drag.button.hasPointerCapture(drag.pointer)) drag.button.releasePointerCapture(drag.pointer); }
    }
    key(event: KeyboardEvent, edge?: PlacementTrimEdge): void {
        if(event.key === 'Enter' || event.key === ' ') this.suppressClick = false;
        if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancel(); return; }
        if(event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); event.stopPropagation();
        if(this.drag) return;
        const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? .1 : .01);
        if(edge) {
            const edgeTime = this.placement.start + (edge === 'out' ? this.duration : 0);
            const changes = trimPlacement(this.placement, this.actions.action(this.placement.actionId)?.animation.duration ?? 1, edge, edgeTime + delta);
            if(changes) this.actions.retime(this.placement, changes);
        } else this.actions.move(this.placement, Math.max(0, snapTimelineTime(this.placement.start + delta)));
    }
    preview(): void { if(!this.suppressClick) this.actions.playback.seek(this.placement.start); this.suppressClick = false; }
    ngOnDestroy(): void { this.cancel(); this.contextSubscription.unsubscribe(); }
}
