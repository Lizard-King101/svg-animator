import { Component, DoCheck, HostListener, Input, OnDestroy } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { Path } from '../../editor/objects/elements/path.object';
import { OutlineEditingService } from '../../_services/outline-editing.service';

@Component({
    selector: 'app-outline-panel', standalone: true, imports: [NgIf, NgFor],
    template: `
      <button type="button" class="btn btn-sm btn-secondary" [disabled]="!outline.canEdit(path)" [attr.aria-pressed]="outline.path === path" (click)="toggle()">{{outline.path === path ? 'Done editing outline' : 'Edit outline'}}</button>
      <p class="hint" role="status" *ngIf="outline.problem(path) as problem">{{problem}}</p>
      <div class="outline-controls" *ngIf="outline.path === path">
        <p class="hint">Trim the visible stroke. Fill and rig weights stay intact.</p>
        <div class="actions" role="group" aria-label="Outline selection mode">
          <button type="button" class="btn btn-sm btn-secondary" [attr.aria-pressed]="outline.picking === 'sections'" (click)="mode('sections')">Sections</button>
          <button type="button" class="btn btn-sm btn-secondary" [attr.aria-pressed]="outline.picking === 'segments'" (click)="mode('segments')">Source segments</button>
        </div>
        <ng-container *ngIf="outline.picking === 'segments'">
          <p class="hint">Click a segment; Shift-click adds. {{outline.selectedSegmentIds.length}} selected.</p>
          <div class="actions">
            <button type="button" class="btn btn-sm btn-secondary" [disabled]="!outline.selectedSegmentIds.length" (click)="outline.setSelectedSegmentsVisible(false)">Hide outline here</button>
            <button type="button" class="btn btn-sm btn-secondary" [disabled]="!outline.selectedSegmentIds.length" (click)="outline.setSelectedSegmentsVisible(true)">Show outline here</button>
          </div>
        </ng-container>
        <ng-container *ngIf="outline.picking === 'sections'">
          <p class="hint">Click a section; Shift-click adds. Drag S / E to trim between anchors.</p>
          <div class="section-list" role="group" aria-label="Outline sections">
            <button *ngFor="let section of outline.sections; index as i; trackBy: track" type="button" class="btn btn-sm btn-secondary" [attr.aria-pressed]="outline.selectedIds.includes(section.id)" (click)="outline.select(section.id, $event.shiftKey)">Section {{i + 1}}</button>
          </div>
          <span class="hint" *ngIf="!outline.sections.length">Outline hidden. Select source segments to show part of it.</span>
          <div class="actions" *ngIf="outline.sections.length">
            <button type="button" class="btn btn-sm btn-secondary" (click)="outline.selectAll()">Select all</button>
            <button type="button" class="btn btn-sm btn-secondary" [disabled]="!outline.selectedIds.length" (click)="outline.hideSelected()">Hide selected</button>
          </div>
          <div class="taper" *ngFor="let end of ends">
            <div class="taper-heading"><span>{{end.label}} taper</span><button type="button" class="btn btn-sm btn-secondary" [disabled]="!outline.selectedIds.length" (click)="outline.pointed(end.key)">Pointed end</button></div>
            <label *ngFor="let field of fields"><span>{{field.label}}</span>
              <input type="range" min="0" max="100" step="1" [attr.aria-label]="end.label + ' taper ' + field.name + ' slider'" [disabled]="!outline.selectedIds.length" [value]="value(end.key, field.key) ?? 0" (input)="preview(end.key, field.key, $event)" (change)="outline.commit()" (blur)="outline.cancel()" (pointercancel)="outline.cancel()" (lostpointercapture)="outline.cancel()" (keydown)="key($event)" />
              <input type="number" min="0" max="100" step="1" [attr.aria-label]="end.label + ' taper ' + field.name" [disabled]="!outline.selectedIds.length" [placeholder]="outline.selectedIds.length ? 'Mixed' : '—'" [value]="value(end.key, field.key) ?? ''" (input)="preview(end.key, field.key, $event)" (blur)="outline.commit()" (keydown)="key($event)" /><span>%</span>
            </label>
          </div>
        </ng-container>
        <button type="button" class="btn btn-sm btn-secondary" [disabled]="path.outlineSections === undefined" (click)="outline.restore()">Restore full outline</button>
        <p class="hint" role="status" *ngIf="outline.feedback">{{outline.feedback}}</p>
      </div>`,
    styles: `:host {display:block; margin-top:10px;} .outline-controls {display:grid; gap:9px; margin-top:8px;} .hint {font-size:11px; color:var(--text-secondary); line-height:1.5; margin:0;} .actions,.section-list {display:flex; flex-wrap:wrap; gap:5px;} .section-list {max-height:120px; overflow:auto;} button[aria-pressed=true] {color:var(--accent); border-color:var(--accent);} .taper {display:grid; gap:6px; border-top:1px solid var(--border-color); padding-top:8px;} .taper-heading {display:flex; align-items:center; justify-content:space-between; gap:5px; font-size:12px;} label {display:grid; grid-template-columns:55px minmax(30px,1fr) 50px 10px; gap:5px; align-items:center; color:var(--text-secondary); font-size:11px;} input[type=range] {min-width:0; width:100%; padding:0; accent-color:var(--accent);} input[type=number] {width:100%; height:25px; background:var(--bg-base); color:var(--text-primary); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:2px 4px;} input:focus-visible {outline:2px solid var(--accent);} input:disabled {opacity:.45;}`,
})
export class OutlinePanelComponent implements DoCheck, OnDestroy {
    @Input({required: true}) path!: Path;
    readonly ends = [{key: 'start' as const, label: 'Start'}, {key: 'end' as const, label: 'End'}];
    readonly fields = [{key: 'length' as const, label: 'Length', name: 'length'}, {key: 'tipWidth' as const, label: 'Tip width', name: 'tip width'}];
    constructor(public outline: OutlineEditingService) {}
    toggle(): void { if(this.outline.path === this.path) this.outline.end(); else this.outline.begin(this.path); }
    mode(mode: 'sections' | 'segments'): void { this.outline.cancel(); this.outline.picking = mode; }
    track(_index: number, section: {id: string}): string { return section.id; }
    value(end: 'start' | 'end', field: 'length' | 'tipWidth'): number | undefined {
        const values = this.outline.selected.map(section => Math.round((section[end === 'start' ? 'startTaper' : 'endTaper']?.[field] ?? (field === 'length' ? 0 : 1)) * 10000) / 100);
        return values.length && values.every(value => value === values[0]) ? values[0] : undefined;
    }
    preview(end: 'start' | 'end', field: 'length' | 'tipWidth', event: Event): void { this.outline.previewTaper(end, field, (event.target as HTMLInputElement).valueAsNumber); }
    key(event: KeyboardEvent): void {
        if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.outline.cancel(); (event.target as HTMLInputElement).blur(); }
        if(event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.outline.commit(); (event.target as HTMLInputElement).blur(); }
    }
    @HostListener('window:blur') cancel(): void { this.outline.cancel(); }
    ngDoCheck(): void { this.outline.validate(); }
    ngOnDestroy(): void { if(this.outline.path === this.path) this.outline.end(); }
}
