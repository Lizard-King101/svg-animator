import { NgClass, NgFor, NgIf } from "@angular/common";
import { Component } from "@angular/core";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { AnimationPlaybackService } from "../../_services/animation-playback.service";
import { DocumentMutationService } from "../../_services/document-mutation.service";
import { EditorService } from "../../_services/editor.service";
import { EditorUiStateService } from "../../_services/editor-ui-state.service";

@Component({
    selector: "app-editor-header",
    standalone: true,
    imports: [NgClass, NgFor, NgIf, FaIconComponent],
    template: `
      <div class="header">
        <div class="function-bar">
          <button class="btn-new" (click)="ui.openDialog('new-project')"><fa-icon icon="plus"></fa-icon><span>New</span></button>
          <div class="function-bar-sep"></div>
          <button class="btn-icon" (click)="mutations.undo()" [disabled]="!editor.selectedSVG?.canUndo" title="Undo (Ctrl+Z)"><fa-icon icon="rotate-left"></fa-icon></button>
          <button class="btn-icon" (click)="mutations.redo()" [disabled]="!editor.selectedSVG?.canRedo" title="Redo (Ctrl+Y)"><fa-icon icon="rotate-right"></fa-icon></button>
          <div class="function-bar-spacer"></div>
          <div class="mode-toggle" *ngIf="editor.selectedSVG">
            <button [ngClass]="{'active': animation.mode == 'edit'}" (click)="animation.setMode('edit')">Edit</button>
            <button [ngClass]="{'active': animation.mode == 'animate'}" (click)="animation.setMode('animate')">Animate</button>
          </div>
          <button class="btn-export" (click)="openExport()" [disabled]="!editor.selectedSVG" title="Export SVG"><fa-icon icon="download"></fa-icon><span>Export</span></button>
        </div>
        <div class="tabs">
          <div class="svg-tab" *ngFor="let svg of editor.svgs" [ngClass]="{'selected': editor.selectedSVG == svg}" (click)="select(svg.id)">
            <span class="tab-name">{{ svg.name }}</span>
            <button class="tab-close" (click)="$event.stopPropagation(); close(svg.id)"><fa-icon icon="times"></fa-icon></button>
          </div>
        </div>
      </div>
    `,
})
export class EditorHeaderComponent {
    constructor(
        public editor: EditorService,
        public animation: AnimationPlaybackService,
        public mutations: DocumentMutationService,
        public ui: EditorUiStateService,
    ) {}

    openExport(): void {
        if(this.editor.selectedSVG) this.ui.openDialog("export");
    }

    select(id: string): void {
        this.animation.pause();
        this.animation.restorePreview();
        this.editor.selectSVG(id);
        if(this.animation.mode === "animate") this.animation.seek(0);
        this.mutations.resetBaseline();
    }

    close(id: string): void {
        this.animation.pause();
        this.animation.restorePreview();
        this.editor.closeSVG(id);
        if(this.animation.mode === "animate") this.animation.seek(0);
        this.mutations.resetBaseline();
    }
}
