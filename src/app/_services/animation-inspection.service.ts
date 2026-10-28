import { Injectable } from '@angular/core';
import { AnimationInspectionSnapshot, InspectionPoint, MotionTrail, OnionSkin } from '../editor/animation/animation-inspection';
import { SVG } from '../editor/objects/svg.object';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { EditorService } from './editor.service';
import { ElementFactory } from './element-factory.service';

/** Session-only inspection settings and bounded caches, shared by toolbar and canvas. */
@Injectable()
export class AnimationInspectionService {
    onions = false;
    // Loop controls seam wrapping and graph continuations; onion visibility is independent.
    get loopGhosts(): boolean { return this.animation.loop; }
    get onionSkinsEnabled(): boolean { return this.onions; }
    motionTrails = false;
    step = 0.1;
    private source?: SVG;
    private revision = '';
    private snapshot?: AnimationInspectionSnapshot;
    private skinKey = '';
    private trailKey = '';
    private currentKey = '';
    private cachedSkins: OnionSkin[] = [];
    private cachedTrails: MotionTrail[] = [];
    private cachedCurrent = new Map<string, InspectionPoint>();

    constructor(private editor: EditorService, public animation: AnimationPlaybackService,
        private mutations: DocumentMutationService, private factory: ElementFactory) {}

    setStep(value: number): void {
        if(Number.isFinite(value)) this.step = Math.max(0.01, Math.min(10, value));
    }

    get display() {
        const source = this.editor.selectedSVG;
        if(!source || this.animation.mode !== 'animate' || this.animation.playing || (!this.onionSkinsEnabled && !this.motionTrails)) return undefined;
        const revision = `${this.mutations.revision}:${this.animation.revision}`;
        if(source !== this.source || revision !== this.revision) {
            const copy = this.factory.restoreDocument(source.save());
            this.animation.restoreSamplingBase(copy);
            if(this.animation.activeAction) {
                copy.animation = copy.animation.composition!.actions.find(action => action.id === this.animation.activeAction!.id)!.animation;
                for(const rig of copy.rigs.armatures) if(!this.animation.allowsTarget(rig.id)) delete rig.springs;
            }
            this.snapshot = new AnimationInspectionSnapshot(copy);
            this.source = source; this.revision = revision;
            this.skinKey = this.trailKey = this.currentKey = '';
        }
        const time = this.animation.currentTime;
        const selectedIds = this.editor.selectedElements.map(element => element.id);
        const range = this.loopGhosts ? this.animation.workArea : undefined;
        const skinKey = `${time}:${this.step}:${JSON.stringify(selectedIds)}:${JSON.stringify(range)}`;
        if(this.onionSkinsEnabled && skinKey !== this.skinKey) {
            this.cachedSkins = this.snapshot!.skins(time, this.step, selectedIds, range); this.skinKey = skinKey;
        }
        const ids = selectedIds.slice(0, 8);
        const trailKey = JSON.stringify(ids);
        if(this.motionTrails && trailKey !== this.trailKey) {
            this.cachedTrails = this.snapshot!.trails(ids); this.trailKey = trailKey;
        }
        const currentKey = `${time}:${trailKey}`;
        if(this.motionTrails && currentKey !== this.currentKey) {
            this.cachedCurrent = this.snapshot!.origins(time, ids); this.currentKey = currentKey;
        }
        return { skins: this.onionSkinsEnabled ? this.cachedSkins : [], trails: this.motionTrails ? this.cachedTrails : [],
            current: this.cachedCurrent };
    }
}
