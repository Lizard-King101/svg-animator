import { Component, OnDestroy } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RigEditingService } from '../../_services/rig-editing.service';
import { constraintIssue, constraintJointGap } from '../../editor/rig-constraints';
import { TwoBoneIKConstraint } from '../../editor/objects/armature';
import { bindToolKeyboard } from '../../editor/tool-keyboard';

/** Presents the same constraint from its chain or target; commands belong to RigEditingService. */
@Component({
    selector: 'app-rig-constraints', standalone: true, imports: [NgFor, NgIf, FormsModule],
    template: `<ng-container *ngIf="rig.bone && rig.workspace !== 'weights'">
      <div class="rig-section-title"><span>Inverse kinematics</span>
        <span *ngIf="rig.activeIKConstraint as constraint" class="rig-chip" [class.accent]="constraint.enabled && !issue(constraint)" [class.danger]="!!issue(constraint)">{{issue(constraint) ? 'Needs fix' : constraint.enabled ? 'On' : 'Off'}}</span></div>
      <ng-container *ngIf="rig.isAnimating && rig.activeIKConstraint as constraint">
        <div class="relationship"><span>Chain</span><strong>{{boneName(constraint.upperBoneId)}} → {{boneName(constraint.lowerBoneId)}}</strong></div>
        <div class="rig-actions"><button class="btn btn-sm btn-secondary" (click)="selectBone(constraint.targetBoneId)">Select target: {{boneName(constraint.targetBoneId)}}</button></div>
        <p class="rig-hint">Animate the target to move this chain. Switch to Edit to change the constraint.</p>
      </ng-container>
      <ng-container *ngIf="!rig.isAnimating">
      <ng-container *ngIf="rig.activeIKConstraint as constraint; else create">
        <div class="rig-heading constraint-heading"><strong>{{constraint.name}}</strong><label class="toggle"><input type="checkbox" aria-label="Enable IK constraint" [checked]="constraint.enabled" (change)="enable(constraint.id, $event)" /> Enabled</label></div>
        <div *ngIf="issue(constraint) as issue" class="callout danger" role="alert"><p class="rig-hint">{{issue}} Posing this armature is paused until it is fixed.</p>
          <button *ngIf="gap(constraint) as gap" class="btn btn-sm btn-primary" (click)="rig.moveJoint(gap.lowerId)">Reconnect joint</button></div>
        <div class="relationship"><span>Chain</span><button class="rig-text-button" (click)="selectBone(constraint.lowerBoneId)">{{boneName(constraint.upperBoneId)}} → {{boneName(constraint.lowerBoneId)}}</button></div>
        <div class="rig-fields single">
          <label *ngIf="rig.selectedIKConstraints.length > 1">Constraint
            <select aria-label="Selected IK constraint" [ngModel]="constraint.id" (ngModelChange)="rig.selectIKConstraint($event)"><option *ngFor="let item of rig.selectedIKConstraints" [value]="item.id">{{item.name}}</option></select>
          </label>
          <label>Name<input aria-label="IK constraint name" [value]="constraint.name" (blur)="rename(constraint.id, $event)" (keydown)="nameKey($event, constraint.name)" /></label>
          <label>Target
            <select aria-label="IK target point" [ngModel]="constraint.targetBoneId" (ngModelChange)="rig.updateIKConstraint(constraint.id, {targetBoneId: $event})"><option *ngFor="let bone of rig.ikTargetCandidates" [value]="bone.id">{{bone.name}}</option></select>
          </label>
        </div>
        <div class="rig-actions"><button class="btn btn-sm btn-secondary" (click)="selectBone(constraint.targetBoneId)">Select target</button><button class="btn btn-sm btn-secondary" (click)="rig.updateIKConstraint(constraint.id, {bend: constraint.bend === 1 ? -1 : 1})">Flip bend</button><button class="btn btn-sm btn-secondary" (click)="rig.matchIKTarget(constraint.id)">Match target to tip</button></div>
        <p *ngIf="rig.workspace === 'pose'" class="rig-hint">Drag {{boneName(constraint.targetBoneId)}} to pose this chain. Moving the body keeps the limb reaching toward its target.</p>
        <p *ngIf="rig.workspace === 'rest'" class="rig-hint">Drag the knee or elbow body to move the joint; both bones stay connected. In Pose, this chain follows its target. Keep foot targets under the root for planted feet.</p>
        <div class="rig-actions"><button class="btn btn-sm btn-secondary" (click)="rig.removeIKConstraint(constraint.id)">Remove constraint</button></div>
      </ng-container>
      <ng-template #create>
        <ng-container *ngIf="rig.ikChain as chain; else selectChain">
          <div *ngIf="rig.ikPick; else offerIK" class="callout accent" role="status">
            <strong>Pick the target for {{chain.upper.name}} → {{chain.lower.name}}</strong>
            <p *ngIf="rig.ikTargetCandidates.length" class="rig-hint">Click the bone {{chain.lower.name}} should reach for, on the canvas or in Layers. Highlighted bones work; usually a foot or hand control under the root.</p>
            <p *ngIf="!rig.ikTargetCandidates.length" class="rig-hint">No bone outside this chain yet. Create a target at the tip, or draw a foot or hand control under the root first.</p>
            <div class="rig-actions"><button class="btn btn-sm btn-secondary" (click)="rig.pickIKTarget()">New target at {{chain.lower.name}}’s tip</button><button class="btn btn-sm btn-secondary" (click)="rig.cancelIKTargetPick()">Cancel</button></div>
          </div>
          <ng-template #offerIK>
            <div class="relationship"><span>Chain</span><strong>{{chain.upper.name}} → {{chain.lower.name}}</strong></div>
            <p class="rig-hint">Add IK so this chain bends to reach a target bone in Pose.</p>
            <div class="rig-actions"><button class="btn btn-sm btn-secondary" (click)="rig.beginIKTargetPick()">Add IK…</button></div>
          </ng-template>
        </ng-container>
        <ng-template #selectChain><p *ngIf="chainHint as hint" class="rig-hint">{{hint.text}}</p>
          <div *ngIf="chainHint?.parent as parent" class="rig-actions"><button class="btn btn-sm btn-secondary" (click)="rig.moveJoint(rig.bone!.id)">Snap to {{parent}}’s tip</button></div></ng-template>
      </ng-template>
      </ng-container>
      <div *ngIf="rows.length" class="constraint-list" role="group" aria-label="Armature IK constraints">
        <span class="list-title">In this armature</span>
        <button *ngFor="let row of rows" class="constraint-row" [class.current]="row.id === rig.activeIKConstraint?.id" [attr.aria-label]="'Select ' + row.name + ', ' + row.state" (click)="selectConstraint(row.constraint)">
          <span class="row-name">{{row.name}}</span><span class="state" [class.problem]="row.state === 'Needs fix'" [class.on]="row.state === 'On'">{{row.state}}</span><small>{{row.chain}}</small></button>
      </div>
    </ng-container>`,
    styleUrl: './rig-panel.scss',
    styles: `:host {display:flex; flex-direction:column; gap:10px; font-size:11px; color:var(--text-secondary);} .constraint-heading {justify-content:space-between;} .toggle {display:flex; align-items:center; gap:5px; white-space:nowrap;} .toggle input {accent-color:var(--accent);}
      .rig-fields.single {grid-template-columns:1fr;} .relationship {display:flex; align-items:center; justify-content:space-between; gap:8px;} .relationship strong {color:var(--text-primary); font-weight:600;}
      .callout {display:flex; flex-direction:column; gap:6px; align-items:flex-start; padding:8px; border:1px solid; border-radius:var(--radius-sm);} .callout.accent {border-color:var(--accent); background:var(--accent-dim);} .callout.danger {border-color:var(--danger);} .callout strong {color:var(--text-primary);} .callout.danger p {color:var(--text-primary);}
      .constraint-list {display:flex; flex-direction:column; gap:4px; padding-top:10px; border-top:1px solid var(--border);} .list-title {color:var(--text-muted); font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;} .constraint-row {display:grid; grid-template-columns:minmax(0,1fr) auto; gap:2px 8px; padding:6px 8px; text-align:left; color:var(--text-primary); background:transparent; border:1px solid transparent; border-radius:var(--radius-sm); font:inherit; cursor:pointer;} .constraint-row:hover {background:var(--bg-elevated);} .constraint-row.current {border-color:var(--border-bright); background:var(--bg-elevated);} .constraint-row:focus-visible {outline:2px solid var(--accent); outline-offset:1px;} .row-name {overflow:hidden; text-overflow:ellipsis; white-space:nowrap;} .state {color:var(--text-secondary);} .state.on {color:var(--accent);} .state.problem {color:var(--danger);} .constraint-row small {grid-column:1 / -1; color:var(--text-secondary);}`,
})
export class RigConstraintsComponent implements OnDestroy {
    private unbind: () => void;
    constructor(public rig: RigEditingService) {
        this.unbind = bindToolKeyboard(() => !!rig.ikPick, key => { if(key === 'Escape') rig.cancelIKTargetPick(); }, () => rig.cancelIKTargetPick());
    }
    ngOnDestroy(): void { this.unbind(); this.rig.cancelIKTargetPick(); }
    issue(constraint: TwoBoneIKConstraint): string | undefined { return this.rig.active ? constraintIssue(this.rig.active, constraint) : undefined; }
    gap(constraint: TwoBoneIKConstraint) { return this.rig.active ? constraintJointGap(this.rig.active, constraint) : undefined; }
    /** Every constraint in the armature, so links stay findable whichever bone is selected. */
    get rows() {
        return (this.rig.active?.constraints ?? []).map(constraint => ({ id: constraint.id, name: constraint.name, constraint,
            chain: `${this.boneName(constraint.upperBoneId)} → ${this.boneName(constraint.lowerBoneId)} → ${this.boneName(constraint.targetBoneId)}`,
            state: this.issue(constraint) ? 'Needs fix' : constraint.enabled ? 'On' : 'Off' }));
    }
    selectConstraint(constraint: TwoBoneIKConstraint): void { this.selectBone(constraint.lowerBoneId); this.rig.selectIKConstraint(constraint.id); }
    /** Explains why the selected bone cannot start IK, with the one-click repair when only the joint is apart. */
    get chainHint(): { text: string; parent?: string } | undefined {
        const bone = this.rig.bone, parent = this.rig.active?.bones.find(item => item.id === bone?.parentId);
        if(!bone) return undefined;
        if(bone.kind === 'point') return { text: 'Point bones can be IK targets. To add IK, select the lower bone of a leg or arm.' };
        if(parent && parent.kind !== 'point' && !this.rig.isJointConnected(bone.id)) {
            const distance = Math.hypot(bone.x + (bone.poseX ?? 0) - parent.length, bone.y + (bone.poseY ?? 0));
            return { text: `${bone.name} starts ${distance.toFixed(1)} units from ${parent.name}’s tip, so they can’t bend together with IK yet.`, parent: parent.name };
        }
        return { text: 'To add IK, select the lower bone of a two-bone chain, such as a shin or forearm.' };
    }
    boneName(id: string): string { return this.rig.active?.bones.find(bone => bone.id === id)?.name ?? 'Missing bone'; }
    selectBone(id: string): void { if(this.rig.activeId) this.rig.selectBone(this.rig.activeId, id); }
    enable(id: string, event: Event): void { this.rig.updateIKConstraint(id, {enabled: (event.target as HTMLInputElement).checked}); }
    rename(id: string, event: Event): void {
        const input = event.target as HTMLInputElement, current = this.rig.active?.constraints?.find(item => item.id === id);
        const name = input.value.trim();
        if(current && name && name !== current.name) this.rig.updateIKConstraint(id, {name});
        input.value = this.rig.active?.constraints?.find(item => item.id === id)?.name ?? '';
    }
    nameKey(event: KeyboardEvent, original: string): void {
        if(event.key === 'Escape') { event.preventDefault(); (event.target as HTMLInputElement).value = original; (event.target as HTMLInputElement).blur(); }
        if(event.key === 'Enter') { event.preventDefault(); (event.target as HTMLInputElement).blur(); }
    }
}
