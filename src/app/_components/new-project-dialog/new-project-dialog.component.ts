import { NgClass, NgFor, NgIf } from "@angular/common";
import { Component, DoCheck, HostListener } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { AnimationPlaybackService } from "../../_services/animation-playback.service";
import { DocumentMutationService } from "../../_services/document-mutation.service";
import { EditorService } from "../../_services/editor.service";
import { EditorUiStateService } from "../../_services/editor-ui-state.service";

interface CanvasPreset { label: string; sublabel: string; width: number; height: number }

@Component({
    selector: "app-new-project-dialog",
    standalone: true,
    imports: [FormsModule, NgClass, NgFor, NgIf, FaIconComponent],
    template: `
      <div class="dialog-overlay" *ngIf="open" (click)="cancel()">
        <div class="dialog" (click)="$event.stopPropagation()">
          <div class="dialog-header">New Project</div>
          <div class="dialog-body">
            <div class="dialog-field"><label>Name</label><input type="text" [(ngModel)]="name" placeholder="Untitled" (keydown.enter)="confirm()" autofocus /></div>
            <div class="dialog-row">
              <div class="dialog-field"><label>Width</label><div class="input-unit"><input type="number" [(ngModel)]="width" min="1" max="8000" /><span>px</span></div></div>
              <div class="dialog-field"><label>Height</label><div class="input-unit"><input type="number" [(ngModel)]="height" min="1" max="8000" /><span>px</span></div></div>
            </div>
            <div class="dialog-field"><label>Presets</label><div class="preset-grid">
              <button *ngFor="let preset of presets" class="preset-btn" [ngClass]="{'active': selected(preset)}" (click)="pick(preset)">
                <span class="preset-size">{{ preset.label }}</span><span class="preset-sub">{{ preset.sublabel }}</span>
              </button>
            </div></div>
          </div>
          <div class="dialog-footer"><button class="btn-cancel" (click)="cancel()">Cancel</button><button class="btn-create" (click)="confirm()"><fa-icon icon="plus"></fa-icon>Create</button></div>
        </div>
      </div>
    `,
})
export class NewProjectDialogComponent implements DoCheck {
    name = "Untitled";
    width = 800;
    height = 600;
    readonly presets: readonly CanvasPreset[] = [
        { label: "1920×1080", sublabel: "16:9 HD", width: 1920, height: 1080 },
        { label: "1280×720", sublabel: "16:9 720p", width: 1280, height: 720 },
        { label: "800×800", sublabel: "Square", width: 800, height: 800 },
        { label: "800×600", sublabel: "4:3", width: 800, height: 600 },
        { label: "595×842", sublabel: "A4 Portrait", width: 595, height: 842 },
        { label: "1080×1920", sublabel: "Story 9:16", width: 1080, height: 1920 },
    ];
    private wasOpen = false;

    get open(): boolean { return this.ui.isDialogOpen("new-project"); }

    constructor(
        private ui: EditorUiStateService,
        private editor: EditorService,
        private animation: AnimationPlaybackService,
        private mutations: DocumentMutationService,
    ) {}

    ngDoCheck(): void {
        if(this.open && !this.wasOpen) {
            this.name = "Untitled";
            this.width = 800;
            this.height = 600;
        }
        this.wasOpen = this.open;
    }

    @HostListener("document:keydown.escape") onEscape(): void { if(this.open) this.cancel(); }

    pick(preset: CanvasPreset): void { this.width = preset.width; this.height = preset.height; }
    selected(preset: CanvasPreset): boolean { return this.width === preset.width && this.height === preset.height; }
    cancel(): void { this.ui.closeDialog("new-project"); }
    confirm(): void {
        this.editor.newSVG(this.width, this.height, this.name.trim() || "Untitled");
        if(this.animation.mode === "animate") this.animation.seek(this.animation.currentTime);
        this.ui.closeDialog("new-project");
        this.mutations.resetBaseline();
        this.mutations.save();
    }
}
