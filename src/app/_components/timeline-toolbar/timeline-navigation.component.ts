import { Component } from '@angular/core';
import { KeyframeRetimingComponent } from './keyframe-retiming.component';
import { FormsModule } from '@angular/forms';
import { TimelineEditorService } from '../../_services/timeline-editor.service';
import { faArrowPointer, faDiamond, faFilterCircleXmark, faCrosshairs } from '@fortawesome/free-solid-svg-icons';
import { IconButtonComponent } from '../icon-button/icon-button.component';

@Component({
    selector: 'app-timeline-navigation', standalone: true, imports: [FormsModule, KeyframeRetimingComponent, IconButtonComponent],
    styles: [`:host { display:flex; flex:0 0 auto; flex-wrap:wrap; align-items:center; gap:6px; padding:4px 10px;
        border-bottom:1px solid var(--border); font-size:11px; }
        input[type=search] { width:150px; min-width:80px; }
        input[type=search], button { color:var(--text-primary); background:var(--bg-base); border:1px solid var(--border); border-radius:var(--radius-sm); padding:3px 6px; }
        label { display:flex; align-items:center; gap:4px; margin:0; }
        button:disabled { opacity:.45; } output { color:var(--text-secondary); }
        button:focus-visible, input:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }`],
    template: `
      <input type="search" aria-label="Search timeline" placeholder="Find object or channel"
        [ngModel]="timeline.rowSearch" (ngModelChange)="timeline.setRowFilters($event, timeline.selectedRowsOnly, timeline.animatedRowsOnly)" />
      <app-icon-button label="Selected only" tooltip="Filter timeline to selected artwork or bone branch" [icon]="selectionIcon" [pressed]="timeline.selectedRowsOnly"
        (activated)="timeline.setRowFilters(timeline.rowSearch, !timeline.selectedRowsOnly, timeline.animatedRowsOnly)" />
      <app-icon-button label="Animated only" tooltip="Filter timeline to channels with animation" [icon]="animatedIcon" [pressed]="timeline.animatedRowsOnly"
        (activated)="timeline.setRowFilters(timeline.rowSearch, timeline.selectedRowsOnly, !timeline.animatedRowsOnly)" />
      <app-icon-button label="Clear filters" [icon]="clearIcon" [disabled]="!timeline.filteringRows" (activated)="timeline.setRowFilters('', false, false)" />
      <app-icon-button label="Reveal selection" tooltip="Reveal selection · Clear filters, expand and scroll to the selected artwork or bone" [icon]="revealIcon" (activated)="timeline.revealSelection()" />
      <button type="button" [disabled]="!timeline.canFitSelectedKeys" (click)="timeline.fitSelectedKeys()">Fit keys</button>
      <button type="button" (click)="timeline.fitWorkArea()">Fit work area</button>
      <app-keyframe-retiming />
      <output aria-live="polite">{{timeline.rows.length}} rows{{timeline.rows.length ? '' : ' · No matching channels'}}</output>`,
})
export class TimelineNavigationComponent {
    readonly selectionIcon = faArrowPointer;
    readonly animatedIcon = faDiamond;
    readonly clearIcon = faFilterCircleXmark;
    readonly revealIcon = faCrosshairs;
    constructor(public timeline: TimelineEditorService) {}
}
