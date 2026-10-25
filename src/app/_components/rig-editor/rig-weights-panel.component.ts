import { Component, HostListener, OnDestroy } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faArrowPointer, faDroplet, faEquals, faLock, faLockOpen, faMinus, faPlus, IconDefinition } from '@fortawesome/free-solid-svg-icons';
import { BrushSetting, RigBindingSessionService, WEIGHT_TOOLS, WeightPaintMode } from '../../_services/rig-binding-session.service';
import { WEIGHT_HEAT_GRADIENT } from '../../editor/rig-weight-colors';

/** Tools, influences and selection for weight editing, shared by artwork-first and bone-first scopes. */
@Component({
    selector: 'app-rig-weights-panel', standalone: true, imports: [FormsModule, NgFor, NgIf, FaIconComponent],
    template: `<section aria-label="Point weights" class="weights">
      <div class="rig-section" role="group" aria-label="Weight tools">
        <div class="rig-section-title"><span>Tool</span><span>Keys 1–5</span></div>
        <div class="rig-segmented tools" role="group" aria-label="Weight tool">
          <button *ngFor="let tool of tools" type="button" [attr.aria-pressed]="session.paintMode === tool.mode" [attr.aria-label]="tool.label + ' tool'" [disabled]="tool.mode !== 'select' && !session.canEditWeights" [title]="tool.label + ' (' + tool.key + ') · ' + tool.hint" (click)="session.setPaintMode(tool.mode)"><fa-icon [icon]="icons[tool.mode]" /><span>{{tool.label}}</span></button>
        </div>
        <ng-container *ngIf="session.paintMode !== 'select'; else selectHint">
          <div *ngFor="let setting of brushSettings" class="brush-row">
            <span class="brush-label">{{setting.label}}</span>
            <input type="range" class="slider" [attr.aria-label]="'Weight brush ' + setting.name + ' slider'" [min]="setting.min" [max]="setting.max" step="1" [value]="brushValue(setting.key, setting.scale)" (input)="brushSetting(setting.key, $event, setting.scale)" />
            <input type="number" class="rig-input" [attr.aria-label]="'Weight brush ' + setting.name" [min]="setting.min" [max]="setting.max" step="1" [value]="brushValue(setting.key, setting.scale)" (change)="brushSetting(setting.key, $event, setting.scale)" (keydown)="numberKey($event, setting.key, setting.scale)" />
            <span class="unit">{{setting.unit}}</span>
          </div>
          <p class="rig-hint">Paints <strong>{{session.rigs.bone?.name}}</strong> on {{session.selectedCount ? 'selected points only' : 'all editable points'}}.</p>
        </ng-container>
        <ng-template #selectHint><p class="rig-hint">Click points or drag a box; Shift adds. Pick a brush to paint the active bone.</p></ng-template>
        <p *ngIf="!session.canEditWeights" class="rig-hint">These points follow one bone rigidly. Assign another bone to paint weights.</p>
      </div>
      <div class="rig-section" role="group" aria-label="Bones">
        <div class="rig-section-title"><span>Bones</span>
          <div class="rig-segmented display" role="group" aria-label="Weight display">
            <button type="button" [attr.aria-pressed]="session.weightDisplay === 'mix'" title="Color points by every bone’s share" (click)="session.weightDisplay = 'mix'">Mix</button>
            <button type="button" [attr.aria-pressed]="session.weightDisplay === 'heat'" title="Show the active bone’s weight from blue (0%) to red (100%)" (click)="session.weightDisplay = 'heat'">Heat</button>
          </div>
        </div>
        <div *ngIf="session.weightDisplay === 'heat'" class="heat-legend" aria-hidden="true"><span>0%</span><i [style.background]="heatGradient"></i><span>100%</span></div>
        <label *ngIf="session.scopeMode === 'bone'" class="check"><input type="checkbox" [ngModel]="session.controlledOnly" (ngModelChange)="filter($event)" /> Only points this bone controls</label>
        <ng-container *ngIf="session.selectedPoint; else noPoints">
          <div class="influences" role="group" aria-label="Bone influences">
            <div *ngFor="let bone of session.influences; trackBy: track" class="influence" [class.selected]="bone.id === session.rigs.boneId">
              <button type="button" class="bone-name" [attr.aria-pressed]="bone.id === session.rigs.boneId" [attr.aria-label]="'Show ' + bone.name + ' weights'" [title]="'Make ' + bone.name + ' the active bone'" (click)="session.toggle(session.weightRig!.id, bone.id)"><span class="rig-swatch swatch" [style.background]="session.color(bone.id)" aria-hidden="true"></span><span class="name">{{bone.name}}</span><span *ngIf="bone.id === session.rigs.boneId" class="rig-chip" [class.accent]="session.paintMode !== 'select'">{{session.paintMode !== 'select' ? 'Painting' : 'Active'}}</span></button>
              <button type="button" class="rig-icon-button lock" [class.mixed]="session.lockState(bone.id) === 'mixed'" [disabled]="!session.influenceRefs(bone.id).length" [attr.aria-label]="(session.lockState(bone.id) === 'locked' ? 'Unlock ' : 'Lock ') + bone.name + ' weight'" [attr.aria-pressed]="session.lockState(bone.id) === 'mixed' ? 'mixed' : session.lockState(bone.id) === 'locked'" [title]="session.lockState(bone.id) === 'locked' ? 'Locked: edits keep this value' : session.lockState(bone.id) === 'mixed' ? 'Some selected points are locked' : 'Lock this weight for the selection'" (click)="session.setLock(bone.id)"><fa-icon [icon]="session.lockState(bone.id) === 'unlocked' ? unlockedIcon : lockedIcon" /></button>
              <input class="slider" type="range" min="0" max="100" step="1" [attr.aria-label]="bone.name + ' weight slider'" [disabled]="!session.canEditInfluence(bone.id) || session.previewKind === 'auto'" [value]="weight(bone.id) ?? 0" [attr.aria-valuetext]="weight(bone.id) === undefined ? 'Mixed weights' : weight(bone.id) + '%'" [style.accent-color]="session.color(bone.id)" (input)="previewValue(bone.id, $event)" (change)="finishSlider($event)" (blur)="cancelSlider()" (pointercancel)="cancelSlider()" (keydown)="fieldKey($event)" />
              <label class="amount"><input type="number" class="rig-input" min="0" max="100" step="1" [attr.aria-label]="bone.name + ' weight'" [disabled]="!session.canEditInfluence(bone.id) || session.previewKind === 'auto'" [placeholder]="session.editRefs.length ? 'Mixed' : '—'" [value]="weight(bone.id) ?? ''" (focus)="beginField($event)" (input)="previewValue(bone.id, $event)" (blur)="weightValue(bone.id, $event)" (keydown)="fieldKey($event)" /><span>%</span></label>
            </div>
          </div>
          <p *ngIf="!session.editRefs.length && session.canEditWeights" class="rig-hint">Select points to type exact values. Click a bone to make it the active bone.</p>
        </ng-container>
        <ng-template #noPoints><p class="rig-hint">{{session.scopeMode === 'bone' && session.controlledOnly ? 'No controlled points. Turn off the filter to add weights to other assigned artwork.' : 'There are no bound points in this scope.'}}</p></ng-template>
      </div>
      <div class="rig-section" role="group" aria-label="Weight selection">
        <div class="rig-section-title"><span>Selection</span><span>{{session.selectedCount}} selected</span></div>
        <div class="rig-actions"><button type="button" class="rig-text-button" (click)="session.selectAll()">Select all</button><button type="button" class="rig-text-button" [disabled]="!session.selectedCount" (click)="session.clearSelection()">Clear selection</button></div>
        <p *ngIf="session.selectedCount > session.editRefs.length" class="rig-hint">{{session.selectedCount - session.editRefs.length}} selected {{session.selectedCount - session.editRefs.length === 1 ? 'group is' : 'groups are'}} rigid. Assign another bone to edit their weights.</p>
        <div class="rig-actions">
          <button type="button" class="btn btn-sm btn-secondary" [disabled]="!session.autoRefs.length || session.previewKind === 'auto'" [title]="session.selectedCount ? 'Preview distance-based weights for the selection' : 'Preview distance-based weights for every editable point'" (click)="session.previewAutoWeights()">Auto weights</button>
          <button type="button" class="btn btn-sm btn-secondary" [disabled]="!session.editRefs.length" title="Remove weights from the selection; those points stay at rest" (click)="session.clearWeights()">Clear weights</button>
          <button *ngIf="session.scopeMode === 'artwork' && session.bindings.length && session.canEditWeights" type="button" class="btn btn-sm btn-secondary" title="Points at exactly the same rest position share one set of weights" (click)="session.linkOverlapping()">Share overlaps</button>
        </div>
        <div *ngIf="session.previewKind === 'auto'" class="callout" role="status"><p class="rig-hint">Previewing automatic weights for {{session.autoRefs.length}} {{session.autoRefs.length === 1 ? 'group' : 'groups'}}.</p><div class="rig-actions"><button class="btn btn-sm btn-primary" (click)="session.applyPreview()">Apply</button><button class="btn btn-sm btn-secondary" (click)="session.cancelPreview()">Cancel</button></div></div>
      </div>
      <details *ngIf="session.selectedPoint as selected" class="rig-section point-details" open>
        <summary class="rig-section-title"><span>Point</span><span>{{selected.label}}</span></summary>
        <label class="field">Inspect
          <select class="rig-input" aria-label="Weight point" [ngModel]="session.pointRef ? session.pointKey(selected) : ''" (ngModelChange)="session.selectPointKey($event)">
            <option value="" disabled>Select a point</option>
            <option *ngFor="let point of session.pointEntries; trackBy: trackPoint" [value]="session.pointKey(point)">{{session.bindings.length > 1 || session.scopeMode === 'bone' ? point.pathName + ' · ' : ''}}{{point.label}}</option>
          </select>
        </label>
        <div *ngIf="session.pointRef" class="point-state">
          <label *ngIf="session.selectedIsHandle" class="check"><input type="checkbox" [ngModel]="session.selectedIsIndependent" (ngModelChange)="session.setHandleIndependent($event)" /> Independent handle weights</label>
          <p *ngIf="session.selectedIsHandle && !session.selectedIsIndependent" class="rig-hint">Weight edits also update this handle’s anchor.</p>
          <div *ngIf="session.selectedSharedCount > 1" class="shared"><span>Shared by {{session.selectedSharedCount}} points</span><button *ngIf="!session.selectedIsHandle || session.selectedIsIndependent" type="button" class="rig-text-button" (click)="session.unlinkSelectedWeights()">Make separate</button></div>
        </div>
      </details>
    </section>`,
    styleUrl: './rig-panel.scss',
    styles: `:host {display:block;} .weights {display:flex; flex-direction:column;}
      .tools > button {flex-direction:column; gap:3px; min-height:44px; font-size:10px;} .tools fa-icon {font-size:12px;} .display {min-width:110px;}
      .brush-row {display:grid; grid-template-columns:56px minmax(0,1fr) 54px 18px; align-items:center; gap:8px;} .brush-label {color:var(--text-secondary);} .unit {color:var(--text-muted);}
      .slider {width:100%; min-width:0; padding:0; accent-color:var(--accent); cursor:pointer;} .slider:disabled {opacity:.45; cursor:default;} .rig-hint strong {color:var(--text-primary);} .rig-hint .rig-swatch {display:inline-block; vertical-align:-1px;}
      .heat-legend {display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:6px; color:var(--text-muted); font-size:10px;} .heat-legend i {height:6px; border-radius:3px;}
      .check {display:flex; align-items:center; gap:6px; line-height:1.4;} .check input {accent-color:var(--accent);}
      .influences {display:flex; flex-direction:column; gap:2px;} .influence {display:grid; grid-template-columns:minmax(0,1fr) 70px; grid-template-areas:'name lock' 'slider amount'; column-gap:8px; row-gap:2px; align-items:center; padding:6px 8px; border:1px solid transparent; border-radius:var(--radius-sm);}
      .influence:hover {background:var(--bg-elevated);} .influence.selected {border-color:var(--border-bright); background:var(--bg-elevated);} .bone-name {grid-area:name;} .lock {grid-area:lock; justify-self:end;} .influence .slider {grid-area:slider;} .amount {grid-area:amount; display:flex; align-items:center; justify-content:flex-end; gap:3px;}
      .bone-name {display:flex; align-items:center; gap:7px; min-width:0; padding:3px 0; text-align:left; background:transparent; border:0; color:var(--text-primary); font:inherit; cursor:pointer;} .bone-name .name {min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;} .bone-name:focus-visible {outline:2px solid var(--accent); outline-offset:1px;}
      .amount input {width:58px; height:24px; padding:0 5px; text-align:right;} .lock.mixed {opacity:.7;} .lock[aria-pressed=true] {color:var(--accent);}
      .callout {display:flex; flex-direction:column; gap:8px; padding:8px; border:1px solid var(--accent); border-radius:var(--radius-sm); background:var(--accent-dim);}
      .point-details summary {cursor:pointer; list-style:none;} .point-details summary::-webkit-details-marker {display:none;} .point-details summary > span:first-child::before {content:'▸ '; } .point-details[open] summary > span:first-child::before {content:'▾ ';}
      .field {display:flex; flex-direction:column; gap:4px;} .point-state {display:flex; flex-direction:column; gap:6px;} .shared {display:flex; justify-content:space-between; gap:6px; align-items:center;}`,
})
export class RigWeightsPanelComponent implements OnDestroy {
    readonly tools = WEIGHT_TOOLS;
    readonly icons: Record<WeightPaintMode, IconDefinition> = { select: faArrowPointer, add: faPlus, subtract: faMinus, set: faEquals, smooth: faDroplet };
    readonly lockedIcon = faLock;
    readonly unlockedIcon = faLockOpen;
    readonly heatGradient = WEIGHT_HEAT_GRADIENT;
    private cancelled = new WeakSet<HTMLInputElement>();
    private contexts = new WeakMap<HTMLInputElement, { key: string; tool: unknown }>();
    constructor(public session: RigBindingSessionService) {}
    track(_index: number, bone: { id: string }) { return bone.id; }
    trackPoint(_index: number, point: { pathId: string; pointId: string }) { return JSON.stringify([point.pathId, point.pointId]); }
    weight(boneId: string): number | undefined { return this.session.weightValue(boneId); }
    beginField(event: Event): void { this.contexts.set(event.target as HTMLInputElement, { key: this.session.editContextKey, tool: this.session.rigs.editor.activeTool }); }
    previewValue(boneId: string, event: Event): void {
        const input = event.target as HTMLInputElement;
        if(!this.contexts.has(input)) this.beginField(event);
        this.cancelled.delete(input);
        if(this.fieldCurrent(input)) this.session.previewWeight(boneId, input.valueAsNumber / 100);
    }
    private fieldCurrent(input: HTMLInputElement): boolean { const context = this.contexts.get(input); return !context || context.key === this.session.editContextKey && context.tool === this.session.rigs.editor.activeTool; }
    finishSlider(event: Event): void { const input = event.target as HTMLInputElement; if(!this.cancelled.has(input) && this.fieldCurrent(input) && this.session.previewKind === 'numeric') this.session.applyPreview(); this.cancelled.delete(input); this.contexts.delete(input); }
    cancelSlider(): void { this.session.cancelPreview('numeric'); this.contexts = new WeakMap(); }
    weightValue(boneId: string, event: Event): void {
        const input = event.target as HTMLInputElement;
        if(!this.cancelled.has(input) && this.fieldCurrent(input)) {
            if(this.session.previewKind === 'numeric') this.session.applyPreview();
            else this.session.setSelectedWeight(boneId, input.valueAsNumber / 100);
        }
        this.cancelled.delete(input); this.contexts.delete(input); input.value = String(this.weight(boneId) ?? '');
    }
    filter(value: boolean): void { this.session.cancelPreview(); this.session.clearSelection(); this.session.controlledOnly = value; }
    /** Brush rows in display units; Value only applies to the Set brush. */
    get brushSettings() {
        const rows = [
            { key: 'brushRadius' as const, name: 'radius', label: 'Size', min: 4, max: 300, scale: 1, unit: 'px' },
            { key: 'brushStrength' as const, name: 'strength', label: 'Strength', min: 0, max: 100, scale: 100, unit: '%' },
            { key: 'brushValue' as const, name: 'value', label: 'Value', min: 0, max: 100, scale: 100, unit: '%' },
        ];
        return this.session.paintMode === 'set' ? rows : rows.slice(0, 2);
    }
    brushValue(key: BrushSetting, scale: number): number { return Math.round(this.session[key] * scale); }
    brushSetting(key: BrushSetting, event: Event, scale: number): void {
        const input = event.target as HTMLInputElement;
        this.session.setBrush(key, input.valueAsNumber / scale);
        input.value = String(this.brushValue(key, scale));
    }
    numberKey(event: KeyboardEvent, key: BrushSetting, scale: number): void {
        const input = event.target as HTMLInputElement;
        if(event.key === 'Escape') input.value = String(this.brushValue(key, scale));
        if(event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); input.blur(); }
    }
    fieldKey(event: KeyboardEvent): void {
        if(event.key === 'Escape') { event.preventDefault(); const input = event.target as HTMLInputElement; this.cancelled.add(input); this.session.cancelPreview(); input.blur(); }
        if(event.key === 'Enter') { event.preventDefault(); if((event.target as HTMLInputElement).type === 'range') this.finishSlider(event); (event.target as HTMLInputElement).blur(); }
    }
    @HostListener('window:blur') blur(): void { this.session.cancelPreview(); }
    ngOnDestroy(): void { this.session.cancelPreview(); }
}
