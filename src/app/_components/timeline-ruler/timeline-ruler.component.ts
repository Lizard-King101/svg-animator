import { NgFor } from "@angular/common";
import { Component } from "@angular/core";
import { TimelineEditorService } from "../../_services/timeline-editor.service";

@Component({
    selector: "app-timeline-ruler",
    standalone: true,
    imports: [NgFor],
    template: `
      <div class="timeline-time-content timeline-ruler"
           [style.width.px]="timeline.timelineContentWidth"
           (pointerdown)="timeline.beginScrub($event)"
           (contextmenu)="timeline.openWorkAreaContextMenu($event)">
        <div class="playable-duration" [style.left.px]="timeline.playableStartLeft()" [style.width.px]="timeline.playableWidth()"></div>
        <div class="work-area-bar"
             [style.left.px]="timeline.workAreaLeft()"
             [style.width.px]="timeline.workAreaWidth()"
             title="Drag work area · Right-click for trim options"
             (pointerdown)="timeline.beginWorkAreaDrag('range', $event)">
          <button class="work-area-handle start" type="button" aria-label="Work area start"
                  (pointerdown)="timeline.beginWorkAreaDrag('start', $event)"
                  (keydown)="timeline.adjustWorkArea('start', $event)"></button>
          <button class="work-area-handle end" type="button" aria-label="Work area end"
                  (pointerdown)="timeline.beginWorkAreaDrag('end', $event)"
                  (keydown)="timeline.adjustWorkArea('end', $event)"></button>
        </div>
        <div class="playhead animation-playhead"
             [attr.data-pixels-per-second]="timeline.pixelsPerSecond"
             [attr.data-time-padding]="timeline.timePadding"
             [attr.data-domain-start]="timeline.timeDomainStart"
             [style.left]="timeline.playheadLeft()"></div>
        <span class="ruler-mark" *ngFor="let mark of timeline.rulerMarks()"
              [style.left.px]="mark.left">{{ mark.label }}</span>
      </div>
    `,
})
export class TimelineRulerComponent {
    constructor(public timeline: TimelineEditorService) {}
}
