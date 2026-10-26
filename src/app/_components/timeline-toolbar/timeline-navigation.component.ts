import { Component } from '@angular/core';
import { KeyframeRetimingComponent } from './keyframe-retiming.component';
import { FormsModule } from '@angular/forms';
import { TimelineEditorService } from '../../_services/timeline-editor.service';

@Component({
    selector: 'app-timeline-navigation', standalone: true, imports: [FormsModule, KeyframeRetimingComponent],
    styles: [`:host { display:flex; flex:0 0 auto; flex-wrap:wrap; align-items:center; gap:6px; padding:4px 10px;
        border-bottom:1px solid var(--border); font-size:11px; }
        input[type=search] { width:150px; min-width:80px; }
        input[type=search], button { color:var(--text-primary); background:var(--bg-base); border:1px solid var(--border); border-radius:var(--radius-sm); padding:3px 6px; }
        label { display:flex; align-items:center; gap:4px; margin:0; }
        button:disabled { opacity:.45; } output { color:var(--text-muted); }`],
    template: `
      <input type="search" aria-label="Search timeline" placeholder="Find object or channel"
        [ngModel]="timeline.rowSearch" (ngModelChange)="timeline.setRowFilters($event, timeline.selectedRowsOnly, timeline.animatedRowsOnly)" />
      <label><input type="checkbox" [ngModel]="timeline.selectedRowsOnly"
        (ngModelChange)="timeline.setRowFilters(timeline.rowSearch, $event, timeline.animatedRowsOnly)" />Selected only</label>
      <label><input type="checkbox" [ngModel]="timeline.animatedRowsOnly"
        (ngModelChange)="timeline.setRowFilters(timeline.rowSearch, timeline.selectedRowsOnly, $event)" />Animated only</label>
      <button type="button" [disabled]="!timeline.filteringRows" (click)="timeline.setRowFilters('', false, false)">Clear filters</button>
      <button type="button" (click)="timeline.revealSelection()" title="Clear filters, expand and scroll to selected artwork or bone">Reveal selection</button>
      <button type="button" [disabled]="!timeline.canFitSelectedKeys" (click)="timeline.fitSelectedKeys()">Fit keys</button>
      <button type="button" (click)="timeline.fitWorkArea()">Fit work area</button>
      <app-keyframe-retiming />
      <output aria-live="polite">{{timeline.rows.length}} rows{{timeline.rows.length ? '' : ' · No matching channels'}}</output>`,
})
export class TimelineNavigationComponent {
    constructor(public timeline: TimelineEditorService) {}
}
