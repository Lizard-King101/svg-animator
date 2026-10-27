import { remapLoopSeam, loopEndpoints } from '../editor/animation/loop-seam';
import { Injectable, Optional } from '@angular/core';
import { AnimationAction, ActionPlacement, cloneAnimation, compositionHasOverlap, createDefaultAnimation, makeAnimationId, placementTiming, validPlacementTiming } from '../editor/objects/animation.object';
import { AnyElement } from '../editor/objects/svg.object';
import { Group } from '../editor/objects/elements/group.object';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { EditorService } from './editor.service';
import { RigEditingService } from './rig-editing.service';

export type ActionSelectionScope = 'selection' | 'rig';

/** Persistent action/source commands. Playback owns the session editing context. */
@Injectable()
export class ActionCompositionService {
    message = '';
    constructor(public editor: EditorService, public playback: AnimationPlaybackService, private mutations: DocumentMutationService,
        @Optional() private rigs?: RigEditingService) {}
    get actions() { return this.editor.selectedSVG?.animation.composition?.actions ?? []; }
    get placements() { return this.editor.selectedSVG?.animation.composition?.placements ?? []; }
    action(id: string) { return this.actions.find(action => action.id === id); }

    get selectedRig() { return this.rigs?.visible ? this.rigs.active : undefined; }
    canCreate(scope: ActionSelectionScope): boolean { return scope === 'rig' ? !!this.selectedRig : this.editor.selectedElements.length > 0; }

    create(name: string, extract = false, scope: ActionSelectionScope = 'selection'): AnimationAction | undefined {
        const svg = this.editor.selectedSVG;
        if(!svg || !this.canCreate(scope)) { this.message = scope === 'rig' ? 'Select an armature or bone for the action first.' : 'Select artwork for the action first.'; return; }
        const targetIds: string[] = [];
        const visit = (elements: readonly AnyElement[]) => elements.forEach(element => {
            if(!targetIds.includes(element.id)) targetIds.push(element.id);
            if(element instanceof Group) visit(element.elements);
        });
        if(scope === 'rig') targetIds.push(this.selectedRig!.id);
        else visit(this.editor.selectedElements);
        this.playback.editAction();
        const animation = createDefaultAnimation();
        animation.duration = extract ? svg.animation.duration : 1;
        animation.workArea = { start: 0, end: animation.duration };
        const action: AnimationAction = { id: makeAnimationId('action'), name: name.trim() || 'Action', targetIds, animation };
        this.change(() => {
            const composition = svg.animation.composition ??= { version: 1, actions: [], placements: [] };
            if(extract) {
                animation.tracks = svg.animation.tracks.filter(track => targetIds.includes(track.targetId));
                svg.animation.tracks = svg.animation.tracks.filter(track => !targetIds.includes(track.targetId));
            }
            composition.actions.push(action);
        });
        this.playback.editAction(action.id);
        return action;
    }

    rename(action: AnimationAction, name: string): void {
        if(name.trim() && name.trim() !== action.name) this.change(() => action.name = name.trim());
    }
    duplicate(action: AnimationAction): void {
        const animation = cloneAnimation(action.animation);
        animation.tracks.forEach(track => {
            track.id = makeAnimationId('track');
            const ids = new Map<string, string>();
            track.keyframes.forEach(key => { const id = makeAnimationId('key'); ids.set(key.id, id); key.id = id; });
            remapLoopSeam(track, ids);
        });
        animation.markers.forEach(marker => marker.id = makeAnimationId('marker'));
        const copy = { ...action, id: makeAnimationId('action'), name: `${action.name} Copy`, targetIds: [...action.targetIds], animation };
        this.change(() => this.editor.selectedSVG!.animation.composition!.actions.push(copy));
        this.playback.editAction(copy.id);
    }
    removeAction(action: AnimationAction): void {
        if(this.playback.activeAction?.id === action.id) this.playback.editAction();
        const composition = this.editor.selectedSVG?.animation.composition;
        if(composition) this.change(() => {
            composition.actions = composition.actions.filter(value => value.id !== action.id);
            composition.placements = composition.placements.filter(value => value.actionId !== action.id);
        });
    }
    place(actionId: string, start: number): ActionPlacement | undefined {
        const action = this.action(actionId);
        if(!action || !this.validStart(action, start)) return;
        const placement = { id: makeAnimationId('placement'), actionId, start };
        this.change(() => {
            this.editor.selectedSVG!.animation.composition!.placements.push(placement);
            this.extendScene(start + this.duration(placement));
        });
        return placement;
    }
    move(placement: ActionPlacement, start: number): void {
        const action = this.action(placement.actionId);
        if(!action || start === placement.start || !this.validStart(action, start, placement.id, placement)) return;
        this.change(() => { placement.start = start; this.extendScene(start + this.duration(placement)); });
    }
    duration(placement: ActionPlacement): number {
        return placementTiming(placement, this.action(placement.actionId)?.animation.duration ?? 1).duration;
    }
    retime(placement: ActionPlacement, changes: Partial<Pick<ActionPlacement, 'start' | 'sourceStart' | 'sourceEnd' | 'rate' | 'repeat'>>): void {
        const action = this.action(placement.actionId);
        const candidate = { ...placement, ...changes };
        if(!action) return;
        if(!validPlacementTiming(candidate, action.animation.duration)) {
            this.message = 'Use a source range inside the action, rate 0.01–100, and 1–10000 whole repeats.'; return;
        }
        if(!this.validStart(action, candidate.start, placement.id, candidate)) return;
        if(JSON.stringify(candidate) === JSON.stringify(placement)) return;
        this.change(() => { Object.assign(placement, changes); this.extendScene(placement.start + this.duration(placement)); });
    }
    repeatPlacement(placement: ActionPlacement): void {
        const action = this.action(placement.actionId), start = placement.start + this.duration(placement);
        if(!action || !this.validStart(action, start, undefined, placement)) return;
        this.change(() => {
            const copy = { ...placement, id: makeAnimationId('placement'), start };
            this.editor.selectedSVG!.animation.composition!.placements.push(copy);
            this.extendScene(start + this.duration(copy));
        });
    }
    removePlacement(placement: ActionPlacement): void {
        const composition = this.editor.selectedSVG?.animation.composition;
        if(composition) this.change(() => composition.placements = composition.placements.filter(value => value.id !== placement.id));
    }
    loopWarning(placement: ActionPlacement): string {
        const action = this.action(placement.actionId);
        if(!action) return '';
        const timing = placementTiming(placement, action.animation.duration);
        return action.animation.tracks.some(track => {
            const seam = loopEndpoints(track);
            return seam && (Math.abs(seam.start.time - timing.sourceStart) > .0005 || Math.abs(seam.end.time - timing.sourceEnd) > .0005);
        }) ? 'This source range differs from its linked loop endpoints; the trimmed seam may jump.' : '';
    }
    private validStart(action: AnimationAction, start: number, ignore?: string, timing?: ActionPlacement): boolean {
        if(!Number.isFinite(start) || start < 0) { this.message = 'Start time must be zero or greater.'; return false; }
        const collision = compositionHasOverlap({ version: 1, actions: this.actions,
            placements: [...this.placements.filter(placement => placement.id !== ignore), { ...timing, id: ignore ?? 'candidate', actionId: action.id, start }] });
        if(collision) this.message = 'These actions write the same channel, or repeat the same source. Their placements cannot overlap.';
        return !collision;
    }
    private extendScene(end: number): void {
        const scene = this.editor.selectedSVG!.animation;
        if(end <= scene.duration) return;
        if(scene.workArea?.end === scene.duration) scene.workArea.end = end;
        scene.duration = end;
    }
    private change(operation: () => void): void {
        this.message = '';
        this.playback.pause();
        this.mutations.mutate(() => {
            this.playback.restorePreview();
            operation();
            this.playback.invalidate();
        }, 'animation');
        if(this.playback.mode === 'animate') this.playback.previewAt(this.playback.currentTime);
    }
}
