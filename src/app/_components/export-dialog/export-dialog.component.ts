import { NgFor, NgIf } from "@angular/common";
import { Component, DoCheck, HostListener } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { AnimationPlaybackService } from "../../_services/animation-playback.service";
import { AnimationTrackCleanupService } from "../../_services/animation-track-cleanup.service";
import { EditorService } from "../../_services/editor.service";
import { EditorUiStateService } from "../../_services/editor-ui-state.service";
import {
    RuntimeExportError,
    RuntimeExportKind,
    RuntimeExportProgress,
    RuntimeExportService,
} from "../../_services/runtime-export.service";
import { RuntimeCompileDiagnostic } from "../../../../packages/runtime/src/contracts";

@Component({
    selector: "app-export-dialog",
    standalone: true,
    imports: [FormsModule, NgIf, NgFor, FaIconComponent],
    template: `
      <div class="dialog-overlay" *ngIf="open" (click)="cancel()">
        <div class="dialog export-dialog" (click)="$event.stopPropagation()">
          <div class="dialog-header">Export</div>
          <div class="dialog-body">
            <div class="export-sections">
              <section class="export-section artwork-section">
                <div class="export-section-heading">
                  <div><strong>Artwork</strong><small>A clean snapshot for design tools, documents, and the web.</small></div>
                </div>
                <label class="export-option" [class.selected]="kind === 'static-svg'">
                  <input type="radio" name="export-kind" value="static-svg" [(ngModel)]="kind" />
                  <span class="export-format-badge">SVG</span>
                  <span class="export-option-copy"><strong>Static SVG</strong><small>Script-free base artwork with no animation hooks.</small></span>
                </label>
              </section>

              <section class="export-section animation-section">
                <div class="export-section-heading">
                  <div><strong>Animation</strong><small>Choose how the artwork and runtime are delivered.</small></div>
                  <span class="animation-status" [class.ready]="canExportAnimation">{{ canExportAnimation ? validTrackCount + ' valid tracks' : 'Needs animation' }}</span>
                </div>
                <div class="animation-export-grid">
                  <label class="export-option" [class.selected]="kind === 'embedded-animation-svg'" [class.disabled]="!canExportAnimation">
                    <input type="radio" name="export-kind" value="embedded-animation-svg" [(ngModel)]="kind" [disabled]="!canExportAnimation" />
                    <span class="export-format-badge">SVG</span>
                    <span class="export-option-copy"><strong>Embedded Animation</strong><small>Artwork + animation data for one shared external player.</small></span>
                  </label>
                  <label class="export-option" [class.selected]="kind === 'animated-svg'" [class.disabled]="!canExportAnimation">
                    <input type="radio" name="export-kind" value="animated-svg" [(ngModel)]="kind" [disabled]="!canExportAnimation" />
                    <span class="export-format-badge">SVG</span>
                    <span class="export-option-copy"><strong>Self-contained</strong><small>One animated file with its matching player included.</small></span>
                  </label>
                  <label class="export-option" [class.selected]="kind === 'runtime-assets-zip'" [class.disabled]="!canExportAnimation">
                    <input type="radio" name="export-kind" value="runtime-assets-zip" [(ngModel)]="kind" [disabled]="!canExportAnimation" />
                    <span class="export-format-badge">ZIP</span>
                    <span class="export-option-copy"><strong>Runtime Assets</strong><small>Separate artwork.svg and animation.json files.</small></span>
                  </label>
                  <label class="export-option" [class.selected]="kind === 'web-bundle-zip'" [class.disabled]="!canExportAnimation">
                    <input type="radio" name="export-kind" value="web-bundle-zip" [(ngModel)]="kind" [disabled]="!canExportAnimation" />
                    <span class="export-format-badge">ZIP</span>
                    <span class="export-option-copy"><strong>Web Bundle</strong><small>Ready-to-run page, runtime files, controls, and guide.</small></span>
                  </label>
                </div>
              </section>
            </div>
            <label class="export-check"><input type="checkbox" [(ngModel)]="bakeRoundedCorners" (ngModelChange)="refreshInspection()" /><span>Bake rounded corners into exported path data</span></label>
            <p class="export-note" *ngIf="validTrackCount === 0">Add at least one valid enabled animation track to use animated exports.</p>
            <div class="export-errors" *ngIf="diagnostics.length || orphanedTrackCount">
              <div class="export-errors-heading">
                <strong>Animation needs attention</strong>
                <button type="button" *ngIf="orphanedTrackCount" (click)="removeOrphanedTracks()" [disabled]="busy">Remove {{ orphanedTrackCount }} orphaned {{ orphanedTrackCount === 1 ? 'track' : 'tracks' }}</button>
              </div>
              <div *ngFor="let diagnostic of diagnostics">
                <span>{{ diagnostic.layerName || diagnostic.targetId }} · {{ diagnostic.property }}</span>
                <small>{{ diagnostic.message }} {{ diagnostic.correction }}</small>
              </div>
            </div>
            <p class="export-status" *ngIf="cleanupMessage">{{ cleanupMessage }}</p>
            <p class="export-status" *ngIf="busy">{{ progressLabel }}</p>
            <p class="export-error" *ngIf="errorMessage">{{ errorMessage }}</p>
          </div>
          <div class="dialog-footer">
            <button class="btn-cancel" (click)="cancel()" [disabled]="busy">Cancel</button>
            <button class="btn-create" (click)="confirm()" [disabled]="busy || (requiresAnimation && !canExportAnimation)"><fa-icon icon="download"></fa-icon>{{ busy ? 'Building…' : 'Export' }}</button>
          </div>
        </div>
      </div>
    `,
})
export class ExportDialogComponent implements DoCheck {
    bakeRoundedCorners = true;
    kind: RuntimeExportKind = "static-svg";
    busy = false;
    progress?: RuntimeExportProgress;
    errorMessage = "";
    diagnostics: RuntimeCompileDiagnostic[] = [];
    validTrackCount = 0;
    orphanedTrackCount = 0;
    cleanupMessage = "";
    private wasOpen = false;

    get open(): boolean { return this.ui.isDialogOpen("export"); }
    get canExportAnimation(): boolean { return this.validTrackCount > 0 && this.diagnostics.length === 0; }
    get requiresAnimation(): boolean { return this.kind === "embedded-animation-svg" || this.kind === "animated-svg" || this.kind === "runtime-assets-zip" || this.kind === "web-bundle-zip"; }
    get progressLabel(): string {
        switch(this.progress) {
            case "compiling": return "Validating animation…";
            case "building-artwork": return "Building artwork…";
            case "loading-runtime": return "Loading player assets…";
            case "packaging": return "Packaging files…";
            default: return "Building export…";
        }
    }

    constructor(
        private ui: EditorUiStateService,
        private editor: EditorService,
        private animation: AnimationPlaybackService,
        private trackCleanup: AnimationTrackCleanupService,
        private exporter: RuntimeExportService,
    ) {}

    ngDoCheck(): void {
        if(this.open && !this.wasOpen) {
            this.bakeRoundedCorners = true;
            this.kind = "static-svg";
            this.busy = false;
            this.errorMessage = "";
            this.cleanupMessage = "";
            this.refreshInspection();
        }
        this.wasOpen = this.open;
    }

    removeOrphanedTracks(): void {
        if(this.busy) return;
        const removed = this.trackCleanup.removeOrphanedTracks();
        this.cleanupMessage = removed === 1 ? "Removed 1 orphaned animation track." : `Removed ${removed} orphaned animation tracks.`;
        this.errorMessage = "";
        this.refreshInspection();
    }

    refreshInspection(): void {
        const svg = this.editor.selectedSVG;
        if(!svg) { this.diagnostics = []; this.validTrackCount = 0; this.orphanedTrackCount = 0; return; }
        const inspection = this.animation.withBaseState(() => this.exporter.inspect(svg, this.bakeRoundedCorners));
        this.diagnostics = inspection.blockingDiagnostics;
        this.validTrackCount = inspection.validTrackCount;
        this.orphanedTrackCount = this.trackCleanup.orphanedTracks(svg).length;
        if(this.requiresAnimation && !inspection.canExportAnimation) this.kind = "static-svg";
    }

    @HostListener("document:keydown.escape") onEscape(): void { if(this.open && !this.busy) this.cancel(); }
    cancel(): void { if(!this.busy) this.ui.closeDialog("export"); }

    async confirm(): Promise<void> {
        const svg = this.editor.selectedSVG;
        if(!svg || this.busy) return;
        this.busy = true;
        this.errorMessage = "";
        try {
            const artifactPromise = this.animation.withBaseState(() => this.exporter.build(svg, {
                kind: this.kind,
                bakeRoundedCorners: this.bakeRoundedCorners,
                onProgress: (progress) => this.progress = progress,
            }));
            const artifact = await artifactPromise;
            this.exporter.download(artifact);
            this.ui.closeDialog("export");
        } catch(error) {
            if(error instanceof RuntimeExportError) {
                this.errorMessage = error.message;
                if(error.diagnostics.length) this.diagnostics = error.diagnostics;
            } else {
                this.errorMessage = error instanceof Error ? error.message : "Export failed unexpectedly.";
            }
        } finally {
            this.busy = false;
            this.progress = undefined;
        }
    }
}
