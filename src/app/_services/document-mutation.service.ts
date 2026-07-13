import { Injectable, OnDestroy } from "@angular/core";
import { buildSVGMarkup } from "../editor/svg-markup";
import { AnimationPlaybackService } from "./animation-playback.service";
import { EditorService } from "./editor.service";
import { HistoryService } from "./history.service";
import { ProjectService } from "./project.service";
import { SVG, SVGSave } from "../editor/objects/svg.object";
import { Subject } from "rxjs";

export type MutationDomain = "artwork" | "animation" | "guides" | "metadata" | "thumbnail-artwork";

/**
 * Single commit boundary for persistent document changes. It compares the
 * animation base state, creates one history entry, and performs one autosave.
 */
@Injectable()
export class DocumentMutationService implements OnDestroy {
    readonly historyRestored = new Subject<void>();
    private baseline?: string;
    private timer?: ReturnType<typeof setTimeout>;
    private scheduledDomain: MutationDomain = "metadata";
    private _revision = 0;

    get revision(): number { return this._revision; }

    constructor(
        private editor: EditorService,
        private animation: AnimationPlaybackService,
        private history: HistoryService,
        private projects: ProjectService,
    ) {
        this.history.init(editor);
    }

    ngOnDestroy(): void {
        if(this.timer) clearTimeout(this.timer);
        this.historyRestored.complete();
    }

    captureState(): string | undefined {
        const save = this.captureSave();
        return save ? serializeMutationState(save) : undefined;
    }

    captureSave(): SVGSave | undefined {
        const svg = this.editor.selectedSVG;
        return svg ? this.animation.withBaseState(() => svg.save()) : undefined;
    }

    resetBaseline(): void {
        this.baseline = this.captureState();
    }

    commit(domain: MutationDomain = "artwork"): boolean {
        const save = this.captureSave();
        const after = save ? serializeMutationState(save) : undefined;
        if(after == null || after === this.baseline) return false;

        this.history.snapshot(this.editor, save);
        this.save(save, domain);
        this.baseline = after;
        this._revision += 1;
        if(domain === "artwork" || domain === "thumbnail-artwork") {
            if(typeof this.animation.invalidate === "function") this.animation.invalidate();
            if(this.animation.mode === "animate") this.animation.previewAt(this.animation.currentTime);
        }
        return true;
    }

    mutate<T>(change: () => T, domain: MutationDomain = "artwork"): T {
        if(this.baseline === undefined) this.resetBaseline();
        const result = change();
        this.commit(domain);
        return result;
    }

    schedule(delay = 250, domain: MutationDomain = "artwork"): void {
        if(this.timer) clearTimeout(this.timer);
        this.scheduledDomain = mergeDomain(this.scheduledDomain, domain);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const scheduledDomain = this.scheduledDomain;
            this.scheduledDomain = "metadata";
            this.commit(scheduledDomain);
        }, delay);
    }

    save(captured?: SVGSave, domain: MutationDomain = "thumbnail-artwork"): void {
        const svg = this.editor.selectedSVG;
        if(!svg) return;
        const save = captured ?? this.captureSave();
        if(!save) return;
        const thumbnailChanged = domain === "artwork" || domain === "thumbnail-artwork";
        const existingThumbnail = typeof this.projects.get === "function" ? this.projects.get(save.id)?.thumbnail ?? "" : "";
        this.projects.upsert(save, existingThumbnail, { thumbnailChanged: false });
        if(thumbnailChanged && typeof this.projects.updateThumbnail === "function") {
            const revision = this.projects.get(save.id)?.revision;
            const update = () => this.projects.updateThumbnail(save.id, buildSVGMarkup(SVG.fromSave(save, this.editor)), revision);
            if(typeof requestIdleCallback !== "undefined") requestIdleCallback(update, { timeout: 750 }); else update();
        }
    }

    undo(): void {
        if(!this.history.canUndo) return;
        const before = this.captureSave();
        this.animation.withBaseState(() => this.history.undo(this.editor));
        const after = this.captureSave();
        this.resetBaseline();
        this.save(after, artworkChanged(before, after) ? "artwork" : "animation");
        this.finishHistoryRestore();
    }

    redo(): void {
        if(!this.history.canRedo) return;
        const before = this.captureSave();
        this.animation.withBaseState(() => this.history.redo(this.editor));
        const after = this.captureSave();
        this.resetBaseline();
        this.save(after, artworkChanged(before, after) ? "artwork" : "animation");
        this.finishHistoryRestore();
    }

    private finishHistoryRestore(): void {
        this._revision += 1;
        if(typeof this.animation.invalidate === "function") this.animation.invalidate();
        if(this.animation.mode === "animate") this.animation.previewAt(this.animation.currentTime);
        this.historyRestored.next();
    }
}

function serializeMutationState(save: SVGSave): string {
    return JSON.stringify({
        id: save.id,
        name: save.name,
        width: save.width,
        height: save.height,
        elements: save.elements,
        animation: save.animation,
        guides: save.guides,
        guidesLocked: save.guidesLocked,
        importedSourceNodes: save.importedSourceNodes,
    });
}

function mergeDomain(current: MutationDomain, next: MutationDomain): MutationDomain {
    const rank: Record<MutationDomain, number> = { metadata: 0, guides: 1, animation: 2, artwork: 3, "thumbnail-artwork": 4 };
    return rank[next] > rank[current] ? next : current;
}

function artworkChanged(before?: SVGSave, after?: SVGSave): boolean {
    if(!before || !after) return true;
    return JSON.stringify([before.elements, before.importedSourceNodes]) !== JSON.stringify([after.elements, after.importedSourceNodes]);
}
