import { Injectable } from "@angular/core";
import { AnimationTrack } from "../editor/objects/animation.object";
import { findAnimationTarget } from "../editor/objects/animation-targets";
import { SVG } from "../editor/objects/svg.object";
import { AnimationPlaybackService } from "./animation-playback.service";
import { DocumentMutationService } from "./document-mutation.service";
import { EditorService } from "./editor.service";

/** Repair operations for animation tracks whose persisted targets are no longer present. */
@Injectable()
export class AnimationTrackCleanupService {
    constructor(
        private editor: EditorService,
        private animation: AnimationPlaybackService,
        private mutations: DocumentMutationService,
    ) {}

    orphanedTracks(svg = this.editor.selectedSVG): AnimationTrack[] {
        return svg ? findOrphanedAnimationTracks(svg) : [];
    }

    removeOrphanedTracks(): number {
        const svg = this.editor.selectedSVG;
        if(!svg) return 0;
        const orphaned = this.orphanedTracks(svg);
        if(orphaned.length === 0) return 0;
        const removed = new Set(orphaned);

        this.mutations.mutate(() => {
            svg.animation.tracks = svg.animation.tracks.filter((track) => !removed.has(track));
            this.animation.invalidate();
            if(this.animation.mode === "animate") this.animation.previewAt(this.animation.currentTime);
        }, "animation");
        return orphaned.length;
    }
}

export function findOrphanedAnimationTracks(svg: SVG): AnimationTrack[] {
    return svg.animation.tracks.filter((track) => !findAnimationTarget(svg.elements, track.targetId));
}
