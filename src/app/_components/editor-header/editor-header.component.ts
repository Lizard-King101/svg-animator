import { NgClass, NgFor, NgIf, NgSwitch, NgSwitchCase } from "@angular/common";
import { Component } from "@angular/core";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { RouterLink } from "@angular/router";
import { AnimationPlaybackService } from "../../_services/animation-playback.service";
import { DocumentMutationService } from "../../_services/document-mutation.service";
import { EditorService } from "../../_services/editor.service";
import { EditorUiStateService } from "../../_services/editor-ui-state.service";
import { CurrentDocumentSVGImportService } from "../../_services/current-document-svg-import.service";
import { MAX_SVG_IMPORT_BYTES } from "../../editor/import/svg-importer.service";
import { ObjectSnapToggleComponent } from '../object-snap-toggle/object-snap-toggle.component';
import { DrawingColorsComponent } from '../drawing-colors/drawing-colors.component';
import { ReferencePanelComponent } from '../reference-image/reference-panel.component';
import { SelectionActionsComponent } from '../selection-actions/selection-actions.component';

@Component({
    selector: "app-editor-header",
    standalone: true,
    imports: [NgClass, NgFor, NgIf, NgSwitch, NgSwitchCase, FaIconComponent, RouterLink, ObjectSnapToggleComponent, DrawingColorsComponent, ReferencePanelComponent, SelectionActionsComponent],
    template: `
      <div class="header">
        <div class="function-bar">
          <a class="btn-icon" routerLink="/home" title="Home" aria-label="Home"><fa-icon icon="house"></fa-icon></a>
          <div class="function-bar-sep"></div>
          <button class="btn-new" (click)="ui.openDialog('new-project')"><fa-icon icon="plus"></fa-icon><span>New</span></button>
          <input #importFileInput class="file-input" type="file" accept=".svg,image/svg+xml" (change)="importSVG($event)" />
          <button class="btn-import" (click)="importFileInput.click()" [disabled]="!editor.selectedSVG || importing" title="Import SVG into the current project">
            <fa-icon [icon]="importing ? 'spinner' : 'file-import'" [animation]="importing ? 'spin' : undefined"></fa-icon><span>{{ importing ? 'Importing…' : 'Import' }}</span>
          </button>
          <div class="function-bar-sep"></div>
          <button class="btn-icon" (click)="mutations.undo()" [disabled]="!editor.selectedSVG?.canUndo" title="Undo (Ctrl+Z)"><fa-icon icon="rotate-left"></fa-icon></button>
          <button class="btn-icon" (click)="mutations.redo()" [disabled]="!editor.selectedSVG?.canRedo" title="Redo (Ctrl+Y)"><fa-icon icon="rotate-right"></fa-icon></button>
          <app-object-snap-toggle *ngIf="editor.selectedSVG" />
          <app-reference-panel *ngIf="editor.selectedSVG && animation.mode == 'edit'" />
          <ng-container [ngSwitch]="contextControls">
            <div class="function-bar-sep" *ngIf="contextControls"></div>
            <app-drawing-colors *ngSwitchCase="'drawing'" />
            <app-selection-actions *ngSwitchCase="'arrange'" />
          </ng-container>
          <div class="function-bar-spacer"></div>
          <div class="mode-toggle" role="group" aria-label="Editor mode" *ngIf="editor.selectedSVG">
            <button type="button" [ngClass]="{'active': animation.mode == 'edit'}" [attr.aria-pressed]="animation.mode == 'edit'" (click)="animation.setMode('edit')">Edit</button>
            <button type="button" [ngClass]="{'active': animation.mode == 'animate'}" [attr.aria-pressed]="animation.mode == 'animate'" (click)="animation.setMode('animate')">Animate</button>
          </div>
          <button class="btn-export" (click)="openExport()" [disabled]="!editor.selectedSVG" title="Export SVG"><fa-icon icon="download"></fa-icon><span>Export</span></button>
        </div>
        <div class="header-notice" *ngIf="importMessage || importError" [ngClass]="{'error': importError}">
          <fa-icon [icon]="importError ? 'triangle-exclamation' : 'circle-check'"></fa-icon>
          <span>{{ importError || importMessage }}</span>
          <button (click)="clearImportNotice()" title="Dismiss"><fa-icon icon="times"></fa-icon></button>
        </div>
        <div class="tabs" role="tablist" aria-label="Open projects">
          <div class="svg-tab" *ngFor="let svg of editor.svgs"
               role="tab" [attr.aria-selected]="editor.selectedSVG == svg" [attr.tabindex]="editor.selectedSVG == svg ? 0 : -1"
               [ngClass]="{'selected': editor.selectedSVG == svg}"
               (click)="select(svg.id)" (keydown)="handleTabKey($event, svg.id)">
            <span class="tab-name">{{ svg.name }}</span>
            <button type="button" class="tab-close" tabindex="-1" [attr.aria-label]="'Close ' + svg.name" [title]="'Close ' + svg.name"
                    (click)="$event.stopPropagation(); close(svg.id)"><fa-icon icon="times"></fa-icon></button>
          </div>
        </div>
      </div>
    `,
    styles: `
      .mode-toggle button:focus-visible,
      .svg-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    `,
})
export class EditorHeaderComponent {
    importing = false;
    importMessage?: string;
    importError?: string;

    constructor(
        public editor: EditorService,
        public animation: AnimationPlaybackService,
        public mutations: DocumentMutationService,
        public ui: EditorUiStateService,
        private svgImport: CurrentDocumentSVGImportService,
    ) {}

    async importSVG(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if(!file || !this.editor.selectedSVG) return;
        this.clearImportNotice();
        if(file.size > MAX_SVG_IMPORT_BYTES) {
            this.importError = "SVG files must be smaller than 10 MB.";
            return;
        }

        this.importing = true;
        try {
            const result = this.svgImport.import(await file.text(), file.name);
            const editable = `${result.nativeElementCount} editable element${result.nativeElementCount === 1 ? "" : "s"}`;
            const preserved = result.preservedNodeCount
                ? `; ${result.preservedNodeCount} preserved non-editable node${result.preservedNodeCount === 1 ? "" : "s"}`
                : "";
            const removed = result.removedUnsafeCount
                ? `; ${result.removedUnsafeCount} unsafe item${result.removedUnsafeCount === 1 ? "" : "s"} removed`
                : "";
            this.importMessage = `Imported “${result.layer.name}” as a layer group: ${editable}${preserved}${removed}.`;
        } catch(error) {
            this.importError = error instanceof Error ? error.message : "Unable to import this SVG.";
        } finally {
            this.importing = false;
        }
    }

    /** The contextual header group: new-artwork defaults while drawing, otherwise arrangement for an edit-mode selection. */
    get contextControls(): "drawing" | "arrange" | null {
        if(!this.editor.selectedSVG) return null;
        if(this.editor.activeTool?.usesDrawingPaint) return "drawing";
        return this.animation.mode === "edit" && this.editor.selectedElements.length ? "arrange" : null;
    }

    clearImportNotice(): void {
        this.importMessage = undefined;
        this.importError = undefined;
    }

    openExport(): void {
        if(this.editor.selectedSVG) this.ui.openDialog("export");
    }

    /** Roving tablist keys: arrows, Home, and End move between open projects; Enter/Space selects. */
    handleTabKey(event: KeyboardEvent, id: string): void {
        if(event.target !== event.currentTarget) return;
        const ids = this.editor.svgs.map((svg) => svg.id);
        const index = ids.indexOf(id);
        const target = event.key === "ArrowRight" ? ids[(index + 1) % ids.length]
            : event.key === "ArrowLeft" ? ids[(index - 1 + ids.length) % ids.length]
            : event.key === "Home" ? ids[0]
            : event.key === "End" ? ids[ids.length - 1]
            : event.key === "Enter" || event.key === " " ? id
            : undefined;
        if(!target) return;
        event.preventDefault();
        if(target !== this.editor.selectedSVG?.id) this.select(target);
        const tabs = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>("[role=tab]");
        tabs?.[ids.indexOf(target)]?.focus();
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
