import { Component, DoCheck, HostListener, OnDestroy } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { RigBindingSessionService } from '../../_services/rig-binding-session.service';
import { bindToolKeyboard } from '../../editor/tool-keyboard';
import { RigWeightsPanelComponent } from './rig-weights-panel.component';

@Component({
    selector: 'app-rig-binding-controls', standalone: true, imports: [NgFor, NgIf, RigWeightsPanelComponent],
    template: `<ng-container *ngIf="session.showsBindingControls">
    <section class="rig-section" aria-label="Binding and weights" (keydown)="$event.stopPropagation()">
      <div class="rig-section-title"><span>{{session.rigs.workspace === 'weights' && !session.pending ? 'Weights for' : 'Artwork'}}</span>
        <div *ngIf="!session.pending && session.rigs.workspace === 'weights'" class="rig-segmented scope" role="group" aria-label="Weight editing scope">
          <button type="button" [attr.aria-pressed]="session.scopeMode === 'artwork'" [disabled]="!session.target" title="Edit the selected artwork’s points across all its bones" (click)="session.setScopeMode('artwork')">Artwork</button>
          <button type="button" [attr.aria-pressed]="session.scopeMode === 'bone'" [disabled]="!session.rigs.bone" title="Edit every point the selected bone can influence" (click)="session.setScopeMode('bone')">Bone</button>
        </div>
      </div>
      <ng-container *ngIf="session.scopeMode === 'bone' && !session.pending; else artworkScope">
        <div class="rig-heading"><span class="rig-swatch" *ngIf="session.rigs.bone as bone" [style.background]="session.color(bone.id)" aria-hidden="true"></span><strong>{{session.rigs.bone?.name}}</strong>
          <span class="rig-chip">{{session.bindings.length}} {{session.bindings.length === 1 ? 'path' : 'paths'}}</span></div>
        <p class="rig-hint">{{session.weightRig?.name}} · all points it can influence</p>
      </ng-container>
      <ng-template #artworkScope>
        <div class="rig-heading"><strong>{{session.target?.name || 'Select artwork'}}</strong>
          <span class="rig-chip" [class.accent]="(session.pending ? session.assignmentLabel : session.bindingLabel) !== 'Unbound'">{{session.pending ? session.assignmentLabel : session.bindingLabel}}</span></div>
        <p *ngIf="session.assignmentRig as armature" class="rig-hint">{{armature.name}} · {{session.assignmentCount}} {{session.assignmentCount === 1 ? 'bone' : 'bones'}}</p>
        <p *ngIf="session.mixedArmatures" class="rig-hint" role="status">Select an individual path to edit artwork using different armatures.</p>
        <ng-container *ngIf="!session.pending; else picking">
          <div class="rig-actions"><button class="btn btn-sm btn-secondary" [disabled]="!session.target || session.mixedArmatures" (click)="session.begin()">{{session.binding || session.attachment ? 'Edit bones' : 'Assign bones'}}</button></div>
          <p *ngIf="!session.binding && !session.attachment" class="rig-hint">Assign one bone for rigid movement, or several to bend native paths with weights.</p>
          <p *ngIf="session.bindingLabel === 'Rigid'" class="rig-hint">Add another bone to paint point weights.</p>
          <p *ngIf="session.bindingLabel === 'Custom weights'" class="rig-hint">Custom weights preserved from this project. Editing assigned bones applies the new binding rules.</p>
        </ng-container>
        <ng-template #picking>
          <div class="picking">
            <p class="rig-hint">Pick bones on the canvas or in Layers. {{session.pending!.bones.length === 0 ? (session.pending!.editing ? 'Apply removes this binding.' : 'Pick at least one bone.') : session.pending!.bones.length === 1 ? 'All artwork follows this bone.' : 'Native paths bend across the assigned bones.'}}</p>
            <div class="picks" *ngIf="session.pickedBones.length"><button *ngFor="let bone of session.pickedBones" class="pick" [attr.aria-label]="'Deselect ' + bone.name" (click)="session.toggle(session.pending!.rigId!, bone.id)"><span class="rig-swatch swatch" [style.background]="session.color(bone.id)" aria-hidden="true"></span>{{bone.name}}<span aria-hidden="true">×</span></button></div>
            <p *ngIf="session.assignmentChanged && session.assignmentProblem" class="rig-hint problem" role="status">{{session.assignmentProblem}}</p>
            <div *ngIf="session.assignmentChanged && !session.rigs.atRest" class="rig-actions"><button class="btn btn-sm btn-secondary" (click)="session.resetToRest()">Reset to rest</button></div>
            <div class="rig-actions"><button class="btn btn-sm btn-primary" [disabled]="session.assignmentChanged && !!session.assignmentProblem" (click)="session.confirm()">{{session.assignmentChanged ? 'Apply' : 'Done'}}</button><button class="btn btn-sm btn-secondary" (click)="session.cancel()">Cancel</button></div>
          </div>
        </ng-template>
      </ng-template>
      <p *ngIf="session.rigs.message" class="feedback" role="status" aria-live="polite">{{session.rigs.message}}</p>
      <div *ngIf="session.rigs.restBlocked && !session.pending" class="rig-actions"><button class="btn btn-sm btn-secondary" (click)="session.rigs.resetToRest()">Reset to rest</button></div>
    </section>
    <app-rig-weights-panel *ngIf="session.rigs.workspace === 'weights' && !session.pending && (session.scopeMode === 'bone' || session.binding)" />
    </ng-container>`,
    styleUrl: './rig-panel.scss',
    styles: `:host {display:block;} .scope {min-width:128px;} .rig-heading .rig-chip {margin-left:auto;}
      .picking {display:flex; flex-direction:column; gap:8px; padding:8px; border:1px solid var(--accent); border-radius:var(--radius-sm); background:var(--accent-dim);} .problem {color:var(--text-primary);}
      .picks {display:flex; flex-wrap:wrap; gap:6px;} .pick {display:inline-flex; align-items:center; gap:6px; padding:3px 8px; background:var(--bg-surface); border:1px solid var(--border-bright); border-radius:999px; color:var(--text-primary); font:inherit; cursor:pointer;} .pick:hover {border-color:var(--danger);} .pick:focus-visible {outline:2px solid var(--accent); outline-offset:1px;}
      .feedback {margin:0; padding:7px 8px; background:var(--bg-elevated); border-radius:var(--radius-sm); color:var(--text-primary); line-height:1.5;}`,
})
export class RigBindingControlsComponent implements DoCheck, OnDestroy {
    private unbind: () => void;
    constructor(public session: RigBindingSessionService) {
        this.unbind = bindToolKeyboard(() => !!session.pending || session.previewKind === 'numeric' || session.previewKind === 'auto', key => {
            if(key === 'Escape') session.cancel();
            else if(session.pending) session.confirm();
            else if(session.previewKind === 'auto') session.applyPreview();
        }, () => session.cancel());
    }
    ngDoCheck(): void { this.session.validate(); }
    @HostListener('window:blur') blur(): void { this.session.cancel(); }
    ngOnDestroy(): void { this.unbind(); this.session.close(); }
}
