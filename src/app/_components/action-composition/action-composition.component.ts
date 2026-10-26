import { Component } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ActionCompositionService, ActionSelectionScope } from '../../_services/action-composition.service';

@Component({
    selector: 'app-action-composition', standalone: true, imports: [NgFor, NgIf, FormsModule],
    template: `
      <div class="context-controls">
        <label>Edit <select aria-label="Animation editing context" [ngModel]="actions.playback.activeAction?.id ?? ''" (ngModelChange)="switchContext($event)">
          <option value="">Scene</option><option *ngFor="let action of actions.actions" [value]="action.id">Action: {{action.name}}</option>
        </select></label>
        <label *ngIf="actions.selectedRig as rig">Use <select aria-label="New action scope" [ngModel]="resolvedScope" (ngModelChange)="scope = $event">
          <option value="selection" [disabled]="!actions.editor.selectedElements.length">Selected artwork</option>
          <option value="rig">Armature: {{rig.name}}</option>
        </select></label>
        <input aria-label="New action name" placeholder="Action name" [(ngModel)]="name" (keydown.enter)="create(false)">
        <button type="button" (click)="create(false)" [disabled]="!actions.canCreate(resolvedScope)">New action from selection</button>
        <button type="button" (click)="create(true)" [disabled]="!actions.canCreate(resolvedScope) || !!actions.playback.activeAction" title="Move the selected artwork or armature's scene keys into a reusable action">Extract selected motion</button>
      </div>
      <div class="context-controls" *ngIf="actions.playback.activeAction as action; else scene">
        <strong>Action · local time</strong>
        <input aria-label="Action name" [ngModel]="action.name" (blur)="actions.rename(action, $any($event.target).value)" (keydown.enter)="$any($event.target).blur()" (keydown.escape)="$any($event.target).value = action.name; $any($event.target).blur()">
        <span>{{action.targetIds.length}} scoped targets · edits update every placement</span>
        <button type="button" (click)="switchContext('')">Back to scene</button>
        <button type="button" (click)="actions.duplicate(action)">Duplicate source</button>
        <button type="button" (click)="actions.removeAction(action)" title="Remove source and all its placements; undo restores both">Delete action and placements</button>
      </div>
      <ng-template #scene>
        <div class="context-controls" *ngIf="actions.actions.length">
          <label>Place <select aria-label="Action to place" [(ngModel)]="placementAction">
            <option value="">Choose action</option><option *ngFor="let action of actions.actions" [value]="action.id">{{action.name}}</option>
          </select></label>
          <button type="button" [disabled]="!placementAction" (click)="actions.place(placementAction, actions.playback.currentTime)">Place at playhead</button>
          <span>Blocks replace scene channels while active. Scene motion resumes at the end.</span>
        </div>
      </ng-template>
      <p role="status" *ngIf="actions.message || actions.playback.contextMessage">{{actions.message || actions.playback.contextMessage}}</p>
    `,
    styles: [`
      :host { display: block; flex: 0 0 auto; border-bottom: 1px solid var(--border); font-size: 11px; }
      .context-controls { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:4px 10px; }
      label { display:flex; align-items:center; gap:5px; margin:0; }
      input, select, button { color:inherit; background:var(--bg-base); border:1px solid var(--border); border-radius:var(--radius-sm); padding:3px 6px; }
      input { width:130px; } button:disabled { opacity:.45; } button:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid var(--accent); }
      span { opacity:.7; }
      p { margin:3px 10px; }
    `],
})
export class ActionCompositionComponent {
    name = '';
    placementAction = '';
    scope: ActionSelectionScope = 'selection';
    get resolvedScope(): ActionSelectionScope { return this.actions.selectedRig && (!this.actions.editor.selectedElements.length || this.scope === 'rig') ? 'rig' : 'selection'; }
    constructor(public actions: ActionCompositionService) {}
    switchContext(id: string): void { this.actions.playback.editAction(id || undefined); }
    create(extract: boolean): void {
        const action = this.actions.create(this.name, extract, this.resolvedScope);
        if(action) { this.placementAction = action.id; this.name = ''; }
    }
}
