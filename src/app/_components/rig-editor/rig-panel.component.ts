import { RigBindingControlsComponent } from './rig-binding-controls.component';
import { RigConstraintsComponent } from './rig-constraints.component';
import { RigPoseActionsComponent } from './rig-pose-actions.component';
import { RigWindComponent } from './rig-wind.component';
import { RigSpringComponent } from './rig-spring.component';
import { Component, OnDestroy } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { RigEditingService } from '../../_services/rig-editing.service';
import { RigBindingSessionService } from '../../_services/rig-binding-session.service';

/** Workspace switching plus the selected bone's setup or pose; artwork and weights live in the binding controls. */
@Component({
    selector: 'app-rig-panel', standalone: true, imports: [RigBindingControlsComponent, RigConstraintsComponent, RigPoseActionsComponent, RigSpringComponent, RigWindComponent, NgFor, NgIf, FaIconComponent],
    template: `
    <div class="workspace-bar" *ngIf="rig.active">
      <div class="rig-segmented" role="group" aria-label="Rig workspace">
        <button *ngFor="let mode of modes" type="button" [disabled]="rig.isAnimating && mode !== 'pose'" [title]="rig.isAnimating && mode !== 'pose' ? 'Switch to Edit to change rig setup or bindings' : ''" [attr.aria-pressed]="rig.workspace === mode" (click)="setWorkspace(mode)">{{labels[mode]}}</button>
      </div>
      <button type="button" class="rig-icon-button" [attr.aria-pressed]="rig.visible" [attr.aria-label]="rig.visible ? 'Hide bones on canvas' : 'Show bones on canvas'" [title]="rig.visible ? 'Hide bones on canvas' : 'Show bones on canvas'" (click)="rig.visible = !rig.visible"><fa-icon [icon]="rig.visible ? eyeIcon : hiddenIcon" /></button>
    </div>
    <p class="status" role="status" *ngIf="rig.active && rig.problem">{{rig.problem}}</p>
    <div class="status" role="status" *ngIf="rig.message && rig.message !== rig.problem && !session.showsBindingControls"><p>{{rig.message}}</p>
      <button *ngIf="rig.restBlocked" class="btn btn-sm btn-secondary" (click)="rig.resetToRest()">Reset to rest</button></div>
    <app-rig-binding-controls *ngIf="!rig.isAnimating" />
    <ng-container *ngIf="rig.active as active">
      <section *ngIf="rig.workspace !== 'weights'" class="rig-section" [attr.aria-label]="rig.workspace === 'rest' ? 'Bone setup' : 'Pose controls'" (keydown)="$event.stopPropagation()">
        <div class="rig-section-title"><span>{{rig.workspace === 'rest' ? 'Bone' : 'Pose'}}</span><span *ngIf="rig.bone as bone" class="rig-chip">{{bone.id === active.id ? 'Armature root' : bone.kind === 'point' ? 'Point' : 'Bone'}}</span></div>
        <div class="rig-heading"><strong>{{rig.bone?.name ?? active.name}}</strong></div>
        <ng-container *ngIf="rig.bone as bone">
          <ng-container *ngIf="rig.workspace === 'rest'">
            <div class="rig-fields"><label *ngFor="let field of restFields">{{fieldLabels[field]}}<input type="number" [attr.aria-label]="'Bone ' + field" [disabled]="field === 'length' && bone.kind === 'point'" [value]="display(rig.restBone?.[field])" (blur)="restValue(field, $event)" (keydown)="fieldKey($event, display(rig.restBone?.[field]))" /></label></div>
            <p class="rig-hint">Drag a body to move it, a tip to aim or resize. Dragging a connected bone moves its joint. Artwork stays in place; editing a posed rig makes that pose the new rest.</p>
          </ng-container>
          <ng-container *ngIf="rig.workspace === 'pose' && !rig.activeIKConstraint?.enabled">
            <div *ngIf="!rig.activeIKConstraint" class="rig-segmented" role="group" aria-label="Pose method">
              <button type="button" [attr.aria-pressed]="rig.poseMethod === 'fk'" title="Rotate bones directly" (click)="rig.poseMethod = 'fk'">Rotate (FK)</button>
              <button type="button" [attr.aria-pressed]="rig.poseMethod === 'ik'" title="Bend this chain by dragging a handle; nothing is linked or saved besides the pose" (click)="rig.poseMethod = 'ik'">Quick IK</button>
            </div>
            <ng-container *ngIf="rig.poseMethod === 'ik' && !rig.activeIKConstraint">
              <ng-container *ngIf="rig.ikChain"><p class="rig-hint">Drag the square to bend this chain once. To keep a foot or hand planted while other bones move, add IK below. Arrow keys move the square; Shift moves 10 units.</p>
                <div class="rig-actions"><button class="btn btn-sm btn-secondary" (click)="rig.flipIKBend()">Flip bend</button></div>
              </ng-container>
            </ng-container>
          </ng-container>
          <ng-container *ngIf="rig.workspace === 'pose' && !rig.drivingConstraint(bone.id)">
            <div class="rig-fields"><label>Offset X<input aria-label="Pose offset X" type="number" [disabled]="!rig.canPose" [value]="display(livePosition.x)" (blur)="positionValue('x', $event)" (keydown)="fieldKey($event, display(bone.poseX ?? 0))" /></label>
              <label>Offset Y<input aria-label="Pose offset Y" type="number" [disabled]="!rig.canPose" [value]="display(livePosition.y)" (blur)="positionValue('y', $event)" (keydown)="fieldKey($event, display(bone.poseY ?? 0))" /></label>
              <label>Rotation (°)<input aria-label="FK rotation" type="number" [disabled]="!rig.canPose" [value]="display(livePose)" (blur)="poseValue($event)" (keydown)="fieldKey($event, display(bone.pose))" /></label></div>
            <p class="rig-hint">{{rig.isAnimating ? 'Pose changes create keys at the playhead in the current scene or action.' : 'Drag a tip to rotate, a body to move. Artwork follows as you drag; Esc cancels. Arrow keys nudge; Shift for larger steps.'}}</p>
          </ng-container>
          <p class="rig-hint" *ngIf="rig.workspace === 'pose' && rig.drivingConstraint(bone.id)">This bone follows IK. Select its target to animate the chain.</p>
        </ng-container>
        <app-rig-pose-actions *ngIf="rig.isAnimating" />
        <div class="rig-actions"><button class="btn btn-sm btn-secondary" [disabled]="rig.isAnimating && !rig.canPose" [title]="rig.workspace === 'pose' && active.constraints?.length ? 'Clear rotations and moves; enabled IK still reaches for its targets' : 'Clear rotations and moves'" (click)="rig.resetPose()">Reset pose</button>
          <button *ngIf="!rig.isAnimating && rig.workspace === 'pose' && active.constraints?.length" class="btn btn-sm btn-secondary" title="Clear the pose and pause IK until you pose again; needed before binding artwork" (click)="rig.resetToRest()">Reset to rest</button></div>
      </section>
      <section *ngIf="rig.workspace !== 'weights' && rig.bone" class="rig-section" aria-label="Inverse kinematics" (keydown)="$event.stopPropagation()"><app-rig-constraints /></section>
      <section *ngIf="rig.workspace !== 'weights' && active.springs?.length" class="rig-section" aria-label="Armature wind" (keydown)="$event.stopPropagation()"><app-rig-wind /></section>
      <section *ngIf="rig.workspace !== 'weights' && rig.bone" class="rig-section" aria-label="Spring physics" (keydown)="$event.stopPropagation()"><app-rig-spring /></section>
    </ng-container>`,
    styleUrl: './rig-panel.scss',
    styles: `:host {display:block;} .workspace-bar {display:flex; align-items:center; gap:6px; padding:10px 12px; border-bottom:1px solid var(--border);} .workspace-bar .rig-segmented {flex:1;}
      .status {margin:0; padding:8px 12px; color:var(--text-primary); background:var(--bg-elevated); border-bottom:1px solid var(--border); font-size:11px; line-height:1.5;} .status p {margin:0;} .status button {margin-top:6px;}`,
})
export class RigPanelComponent implements OnDestroy {
    readonly modes = ['rest', 'pose', 'weights'] as const;
    readonly labels = { rest: 'Bone setup', pose: 'Pose', weights: 'Weights' } as const;
    readonly restFields = ['x', 'y', 'angle', 'length'] as const;
    readonly fieldLabels = { x: 'X', y: 'Y', angle: 'Angle (°)', length: 'Length' } as const;
    readonly eyeIcon = faEye;
    readonly hiddenIcon = faEyeSlash;
    constructor(public rig: RigEditingService, public session: RigBindingSessionService) {}
    setWorkspace(mode: typeof this.modes[number]): void {
        if(this.rig.isAnimating && mode !== 'pose') return;
        this.session.cancel();
        if(mode === 'weights' && this.session.target) this.session.openWeights();
        else if(mode === 'weights' && this.rig.bone) this.session.openBoneWeights();
        else this.rig.workspace = mode;
    }
    ngOnDestroy(): void { this.rig.visible = false; }
    /** Follows an uncommitted drag so the field reads what the canvas shows. */
    get livePose(): number { const id = this.rig.boneId; return this.rig.posePreview?.bones.find(bone => bone.id === id)?.pose ?? this.rig.bone?.pose ?? 0; }
    get livePosition() { const bone = this.rig.posePreview?.bones.find(bone => bone.id === this.rig.boneId) ?? this.rig.bone; return { x: bone?.poseX ?? 0, y: bone?.poseY ?? 0 }; }
    /** Fields show two decimals; leaving one untouched never writes the rounded value back. */
    display(value: number | string | undefined): string { return typeof value === 'number' ? String(Math.round(value * 100) / 100) : value ?? ''; }
    restValue(field: typeof this.restFields[number], event: Event): void {
        const input = event.target as HTMLInputElement;
        if(input.value !== this.display(this.rig.restBone?.[field])) this.rig.editBone({ [field]: input.valueAsNumber });
        input.value = this.display(this.rig.restBone?.[field] ?? 0);
    }
    poseValue(event: Event): void {
        const input = event.target as HTMLInputElement;
        if(input.value !== this.display(this.rig.bone?.pose)) this.rig.setPose(input.valueAsNumber);
        input.value = this.display(this.rig.bone?.pose ?? 0);
    }
    positionValue(axis: 'x' | 'y', event: Event): void {
        const input = event.target as HTMLInputElement, bone = this.rig.bone;
        if(!bone) return;
        const current = axis === 'x' ? bone.poseX ?? 0 : bone.poseY ?? 0;
        if(input.value !== this.display(current)) this.rig.setPosePosition(axis === 'x' ? input.valueAsNumber : bone.poseX ?? 0, axis === 'y' ? input.valueAsNumber : bone.poseY ?? 0);
        input.value = this.display((axis === 'x' ? this.rig.bone?.poseX : this.rig.bone?.poseY) ?? 0);
    }
    fieldKey(event: KeyboardEvent, original: string | number): void {
        if(event.key === 'Escape') { event.preventDefault(); (event.target as HTMLInputElement).value = String(original); (event.target as HTMLInputElement).blur(); }
        if(event.key === 'Enter') { event.preventDefault(); (event.target as HTMLInputElement).blur(); }
    }
}
