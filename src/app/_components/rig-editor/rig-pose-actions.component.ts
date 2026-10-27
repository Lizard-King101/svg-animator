import { Component } from '@angular/core';
import { NgIf } from '@angular/common';
import { RigEditingService } from '../../_services/rig-editing.service';

@Component({
    selector: 'app-rig-pose-actions', standalone: true, imports: [NgIf],
    styleUrl: './rig-panel.scss',
    styles: ':host { display:flex; flex-direction:column; gap:8px; }',
    template: `
      <p class="rig-hint" aria-label="Pose keying context">{{rig.poseKeyingContext}} · {{rig.poseControlCount}} editable control{{rig.poseControlCount === 1 ? '' : 's'}}</p>
      <div class="rig-actions">
        <button type="button" class="btn btn-sm btn-secondary" [disabled]="!rig.canKeySelectedPose"
          title="Key rotation and both offsets for the selected control" (click)="rig.keyPose()">Key selected control</button>
        <button type="button" class="btn btn-sm btn-secondary" [disabled]="!rig.canKeyArmaturePose"
          title="Key rotation and both offsets for every editable control; skip IK-driven bones" (click)="rig.keyArmaturePose()">Key armature pose</button>
      </div>
      <div class="rig-actions">
        <button type="button" class="btn btn-sm btn-secondary" [disabled]="!rig.canKeyArmaturePose" (click)="rig.copyPose()">Copy armature pose</button>
        <button type="button" class="btn btn-sm btn-secondary" [disabled]="!!rig.pastePoseProblem"
          [title]="rig.pastePoseProblem || 'Key the copied controls on this armature at the playhead'" (click)="rig.pastePose()">Paste armature pose</button>
      </div>
      <p *ngIf="rig.copiedPoseLabel" class="rig-hint">Copied: {{rig.copiedPoseLabel}}</p>
      <p class="rig-hint">Armature poses include FK and IK target controls. Bones following IK are skipped.</p>`,
})
export class RigPoseActionsComponent {
    constructor(public rig: RigEditingService) {}
}
