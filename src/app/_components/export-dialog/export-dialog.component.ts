import { NgIf } from "@angular/common";
import { Component, DoCheck, HostListener } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { AnimationPlaybackService } from "../../_services/animation-playback.service";
import { EditorService } from "../../_services/editor.service";
import { EditorUiStateService } from "../../_services/editor-ui-state.service";
import { buildSVGMarkup } from "../../editor/svg-markup";

@Component({
    selector: "app-export-dialog",
    standalone: true,
    imports: [FormsModule, NgIf, FaIconComponent],
    template: `
      <div class="dialog-overlay" *ngIf="open" (click)="cancel()">
        <div class="dialog export-dialog" (click)="$event.stopPropagation()">
          <div class="dialog-header">Export</div>
          <div class="dialog-body">
            <div class="export-options">
              <label class="export-option"><input type="radio" checked /><span><strong>Static SVG</strong></span></label>
              <label class="export-option disabled"><input type="radio" disabled /><span><strong>Animated SVG</strong><small>Planned</small></span></label>
              <label class="export-option disabled"><input type="radio" disabled /><span><strong>Embedded Animation JSON</strong><small>Planned</small></span></label>
            </div>
            <label class="export-check"><input type="checkbox" [(ngModel)]="bakeRoundedCorners" /><span>Bake rounded corners into path data</span></label>
          </div>
          <div class="dialog-footer"><button class="btn-cancel" (click)="cancel()">Cancel</button><button class="btn-create" (click)="confirm()"><fa-icon icon="download"></fa-icon>Export</button></div>
        </div>
      </div>
    `,
})
export class ExportDialogComponent implements DoCheck {
    bakeRoundedCorners = true;
    private wasOpen = false;
    get open(): boolean { return this.ui.isDialogOpen("export"); }

    constructor(private ui: EditorUiStateService, private editor: EditorService, private animation: AnimationPlaybackService) {}

    ngDoCheck(): void {
        if(this.open && !this.wasOpen) this.bakeRoundedCorners = true;
        this.wasOpen = this.open;
    }

    @HostListener("document:keydown.escape") onEscape(): void { if(this.open) this.cancel(); }
    cancel(): void { this.ui.closeDialog("export"); }
    confirm(): void {
        const svg = this.editor.selectedSVG;
        if(!svg) return;
        const render = () => buildSVGMarkup(svg, { bakeRoundedCorners: this.bakeRoundedCorners });
        const markup = this.animation.mode === "animate" ? render() : this.animation.withBaseState(render);
        const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${svg.name ?? "drawing"}.svg`;
        anchor.click();
        URL.revokeObjectURL(url);
        this.cancel();
    }
}
