import { Component, DoCheck } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { RigSpringService } from '../../_services/rig-spring.service';
import { SPRING_LIMITS, SpringSettings } from '../../../../packages/runtime/src/rig/spring-chain';

@Component({
    selector: 'app-rig-spring', standalone: true, imports: [NgFor, NgIf], providers: [RigSpringService],
    template: `<div class="rig-section-title"><span>Spring physics</span><span class="rig-chip" *ngIf="spring.constraint">{{spring.constraint.enabled ? 'Live' : 'Off'}}</span></div>
      <p class="rig-hint" *ngIf="spring.problem">{{spring.problem}}</p>
      <div class="rig-fields" *ngIf="spring.endOptions.length">
        <label>Start bone<span>{{spring.startName}}</span></label>
        <label>End bone<select aria-label="Physics end bone" [value]="spring.endBoneId" [disabled]="!spring.rig.canEdit" (change)="end($event)"><option *ngFor="let bone of spring.endOptions" [value]="bone.id">{{bone.name}}</option></select></label>
      </div>
      <ng-container *ngIf="spring.constraint as constraint; else create">
        <p class="rig-hint">{{spring.chainLabel}}</p>
        <label class="toggle"><input type="checkbox" aria-label="Enable spring physics" [checked]="constraint.enabled" [disabled]="!spring.rig.canEdit" (change)="enable($event)" /> Enabled</label>
        <label class="bone-settings">Settings for bone<select class="rig-input" aria-label="Physics settings bone" [value]="spring.rig.boneId" (change)="selectBone($event)"><option *ngFor="let bone of spring.chainBones" [value]="bone.id">{{bone.name}}</option></select></label>
        <div class="rig-fields"><label *ngFor="let field of fields">{{field.label}}
          <input type="number" [attr.aria-label]="'Spring ' + field.label" [min]="limits[field.key][0]" [max]="limits[field.key][1]" [step]="field.key === 'mix' || field.key === 'windInfluence' ? .1 : 1"
            [value]="spring.settings[field.key]" [disabled]="!spring.rig.canEdit" (blur)="change(field.key, $event)" (keydown)="fieldKey(field.key, $event)" [title]="field.hint" />
        </label></div>
        <p class="rig-hint">Saved with the rig. Physics runs in Pose, playback and animated exports; no keys or baking required.</p>
        <p class="rig-hint" *ngIf="!spring.rig.canEdit">Switch to Edit to change the constraint.</p>
        <div class="rig-actions" *ngIf="spring.rig.canEdit"><button class="btn btn-sm btn-secondary" (click)="spring.reset()" *ngIf="spring.rig.workspace === 'pose'">Reset simulation</button><button class="btn btn-sm btn-secondary" (click)="spring.remove()">Remove spring</button></div>
        <details *ngIf="spring.rig.isAnimating"><summary>Convert to keys…</summary>
          <p class="rig-hint">Optional: replace this chain’s rotation tracks and disable this spring for the whole rig, including other actions. Keys are written to the active scene or action.</p>
          <div class="rig-actions"><button class="btn btn-sm btn-secondary" [disabled]="!!spring.bakeProblem || spring.busy" [title]="spring.bakeProblem" (click)="spring.bake()">{{spring.busy ? 'Baking…' : 'Bake to keys'}}</button><button *ngIf="spring.busy" class="btn btn-sm btn-secondary" (click)="spring.cancel()">Cancel</button></div>
        </details>
      </ng-container>
      <ng-template #create><p class="rig-hint" *ngIf="!spring.problem">Choose an inclusive start/end range. Children outside it follow normally; each included bone has its own settings.</p>
        <button class="btn btn-sm btn-secondary" *ngIf="spring.rig.canEdit && !spring.problem" (click)="spring.add()">Add spring physics</button>
        <p class="rig-hint" *ngIf="!spring.rig.canEdit">Create spring constraints in Edit.</p>
      </ng-template>
      <p class="rig-hint" role="status" *ngIf="spring.message">{{spring.message}}</p>`,
    styleUrl: './rig-panel.scss',
    styles: `:host {display:flex; flex-direction:column; gap:10px;} .rig-hint {overflow-wrap:anywhere;} .toggle {display:flex; align-items:center; gap:6px;} .toggle input {accent-color:var(--accent);} .bone-settings {display:flex; flex-direction:column; gap:4px; font-size:11px;} summary {cursor:pointer; color:var(--text-secondary); font-size:11px;} details[open] summary {margin-bottom:8px;}`,
    host: { '(keydown.escape)': 'cancel($event)' },
})
export class RigSpringComponent implements DoCheck {
    readonly limits = SPRING_LIMITS;
    readonly fields: { key: keyof SpringSettings; label: string; hint: string }[] = [
        { key: 'stiffness', label: 'Stiffness', hint: 'How strongly the strand returns toward its authored pose.' },
        { key: 'damping', label: 'Damping', hint: 'How quickly the swinging settles.' },
        { key: 'gravity', label: 'Gravity', hint: 'Downward pull relative to each bone’s length. Negative values pull upward.' },
        { key: 'limit', label: 'Angle limit (°)', hint: 'Maximum deviation from the authored local angle in either direction.' },
        { key: 'windInfluence', label: 'Wind influence', hint: 'Response to armature Wind X/Y. 0 ignores wind; 1 is normal; higher values catch more wind.' },
        { key: 'mix', label: 'Mix', hint: '0 preserves the authored pose; 1 uses the full spring motion.' },
    ];
    constructor(public spring: RigSpringService) {}
    ngDoCheck(): void { this.spring.checkContext(); }
    end(event: Event): void { this.spring.setEnd((event.target as HTMLSelectElement).value); }
    selectBone(event: Event): void { this.spring.selectSettingsBone((event.target as HTMLSelectElement).value); }
    enable(event: Event): void { this.spring.enable((event.target as HTMLInputElement).checked); }
    change(key: keyof SpringSettings, event: Event): void {
        const input = event.target as HTMLInputElement;
        this.spring.setSetting(key, input.valueAsNumber); input.value = String(this.spring.settings[key]);
    }
    fieldKey(key: keyof SpringSettings, event: KeyboardEvent): void {
        if(event.key === 'Escape') {
            event.stopPropagation(); event.preventDefault();
            (event.target as HTMLInputElement).value = String(this.spring.settings[key]); (event.target as HTMLInputElement).blur();
        } else if(event.key === 'Enter') { event.preventDefault(); (event.target as HTMLInputElement).blur(); }
    }
    cancel(event: Event): void { event.stopPropagation(); this.spring.cancel(); }
}
