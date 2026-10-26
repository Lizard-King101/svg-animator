import { Component } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TimelineEditorService } from '../../_services/timeline-editor.service';
import { DocumentMutationService } from '../../_services/document-mutation.service';
import { AnimationInspectionService } from '../../_services/animation-inspection.service';
import { linkLoopSeam, loopEndpoints } from '../../editor/animation/loop-seam';
import { AnimationTrack } from '../../editor/objects/animation.object';
import { Group } from '../../editor/objects/elements/group.object';
import { AnyElement } from '../../editor/objects/svg.object';
import { parseRigAnimationProperty } from '../../editor/rig-animation';

/** Loop authoring controls compose existing channel selection and mutation owners. */
@Component({
    selector: 'app-loop-seam-controls', standalone: true, imports: [NgIf, FormsModule],
    styles: [`:host { display:flex; flex:0 0 auto; align-items:center; flex-wrap:wrap; gap:8px; padding:4px 10px;
        border-bottom:1px solid var(--border); font-size:11px; }
        label { display:flex; gap:4px; align-items:center; margin:0; }
        select, button { color:inherit; background:var(--bg-base); border:1px solid var(--border); border-radius:var(--radius-sm); padding:3px 6px; }
        button:disabled { opacity:.45; } .hint { color:var(--text-muted); }`],
    template: `<strong>Loop seam</strong>
        <label>For <select aria-label="Loop link scope" [(ngModel)]="scope">
          <option value="channels">Selected keys / graph channels</option><option value="selection">Selected artwork / rig</option>
        </select></label>
        <label>Match <select aria-label="Loop endpoint value source" [(ngModel)]="source">
          <option value="start">Start pose → end</option><option value="end">End pose → start</option>
        </select></label>
        <label><input type="checkbox" [(ngModel)]="smooth" />Match seam speed</label>
        <button type="button" [disabled]="!tracks.length" (click)="link()" title="Create or update boundary keys at the work-area edges, then keep their values linked. Matching replaces the other endpoint's value.">Link endpoints</button>
        <button type="button" [disabled]="!linkedCount" (click)="unlink()">Unlink ({{linkedCount}})</button>
        <label title="Wrapped onion skins and a dashed graph continuation across the work-area seam. Preview only."><input type="checkbox" [(ngModel)]="inspection.loopGhosts" />Loop ghosts</label>
        <span class="hint">{{tracks.length}} channels · {{timeline.animation.workArea.start}}–{{timeline.animation.workArea.end}}s work area</span>
        <span *ngIf="message" role="status">{{message}}</span>`,
})
export class LoopSeamControlsComponent {
    scope: 'channels' | 'selection' = 'channels';
    source: 'start' | 'end' = 'start';
    smooth = false;
    message = '';
    constructor(public timeline: TimelineEditorService, private mutations: DocumentMutationService,
        public inspection: AnimationInspectionService) {}

    get tracks(): AnimationTrack[] {
        const animation = this.timeline.activeAnimation;
        if(!animation) return [];
        let tracks: AnimationTrack[];
        if(this.scope === 'channels') {
            tracks = this.timeline.selectedKeyframeIds.size
                ? animation.tracks.filter(track => track.keyframes.some(key => this.timeline.selectedKeyframeIds.has(key.id)))
                : this.timeline.graphTracks().map(item => item.track);
            // Uniform scale is presented as one curve but remains two linked channels.
            if(!this.timeline.selectedKeyframeIds.size && this.timeline.selectedGraphProperty === 'transform.scale') {
                const ids = new Set(tracks.map(track => track.targetId));
                tracks = animation.tracks.filter(track => ids.has(track.targetId) && ['transform.scaleX', 'transform.scaleY'].includes(track.property));
            }
        } else {
            const ids = new Set<string>();
            const visit = (elements: readonly AnyElement[]) => elements.forEach(element => {
                ids.add(element.id); if(element instanceof Group) visit(element.elements);
            });
            visit(this.timeline.editor.selectedElements);
            if(!ids.size && this.timeline.rig?.active) ids.add(this.timeline.rig.active.id);
            tracks = animation.tracks.filter(track => ids.has(track.targetId));
        }
        return tracks.filter(track => {
            if(track.enabled === false || !track.keyframes.length || !this.timeline.animation.allowsTarget(track.targetId)) return false;
            const parsed = parseRigAnimationProperty(track.property);
            const rig = parsed && this.timeline.editor.selectedSVG?.rigs.armatures.find(rig => rig.id === track.targetId);
            return !parsed || !rig?.constraints?.some(constraint => constraint.enabled
                && [constraint.upperBoneId, constraint.lowerBoneId].includes(parsed.boneId));
        });
    }
    get linkedCount(): number { return this.tracks.filter(track => loopEndpoints(track)).length; }
    link(): void {
        const tracks = this.tracks, range = this.timeline.animation.workArea;
        if(!tracks.length) return;
        this.timeline.animation.pause();
        this.mutations.mutate(() => {
            for(const track of tracks) linkLoopSeam(track, range.start, range.end, this.source, this.smooth);
        }, 'animation');
        this.refresh();
        this.message = `${tracks.length} channels linked. Edit either pose; unlink before retiming boundary keys.`;
    }
    unlink(): void {
        const tracks = this.tracks.filter(track => track.loopSeam);
        if(!tracks.length) return;
        this.mutations.mutate(() => tracks.forEach(track => delete track.loopSeam), 'animation');
        this.refresh(); this.message = 'Endpoints unlinked; existing motion is preserved.';
    }
    private refresh(): void {
        this.timeline.animation.invalidate();
        this.timeline.animation.previewAt(this.timeline.animation.currentTime);
    }
}
