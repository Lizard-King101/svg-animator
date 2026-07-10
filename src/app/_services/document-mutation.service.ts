import { Injectable, OnDestroy } from "@angular/core";
import { buildSVGMarkup } from "../editor/svg-markup";
import { AnimationPlaybackService } from "./animation-playback.service";
import { EditorService } from "./editor.service";
import { HistoryService } from "./history.service";
import { ProjectService } from "./project.service";

/**
 * Single commit boundary for persistent document changes. It compares the
 * animation base state, creates one history entry, and performs one autosave.
 */
@Injectable()
export class DocumentMutationService implements OnDestroy {
    private baseline?: string;
    private timer?: ReturnType<typeof setTimeout>;
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
    }

    captureState(): string | undefined {
        const svg = this.editor.selectedSVG;
        return svg ? this.animation.withBaseState(() => {
            const save = svg.save();
            return JSON.stringify({
                elements: save.elements,
                animation: save.animation,
                guides: save.guides,
                guidesLocked: save.guidesLocked,
            });
        }) : undefined;
    }

    resetBaseline(): void {
        this.baseline = this.captureState();
    }

    commit(): boolean {
        const after = this.captureState();
        if(after == null || after === this.baseline) return false;

        this.animation.withBaseState(() => this.history.snapshot(this.editor));
        this.save();
        this.baseline = after;
        this._revision += 1;
        return true;
    }

    mutate<T>(change: () => T): T {
        if(this.baseline === undefined) this.resetBaseline();
        const result = change();
        this.commit();
        return result;
    }

    schedule(delay = 250): void {
        if(this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.commit();
        }, delay);
    }

    save(): void {
        const svg = this.editor.selectedSVG;
        if(!svg) return;
        this.animation.withBaseState(() => this.projects.upsert(svg.save(), buildSVGMarkup(svg)));
    }

    undo(): void {
        if(!this.history.canUndo) return;
        this.animation.withBaseState(() => this.history.undo(this.editor));
        this.resetBaseline();
        this.save();
    }

    redo(): void {
        if(!this.history.canRedo) return;
        this.animation.withBaseState(() => this.history.redo(this.editor));
        this.resetBaseline();
        this.save();
    }
}
