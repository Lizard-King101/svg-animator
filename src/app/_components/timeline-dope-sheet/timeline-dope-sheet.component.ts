import { NgClass, NgFor, NgIf, NgStyle } from "@angular/common";
import { ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, ViewChild } from "@angular/core";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { TimelineEditorService } from "../../_services/timeline-editor.service";
import { TimelineGraphComponent } from "../timeline-graph/timeline-graph.component";
import { TimelineRowComponent } from "../timeline-row/timeline-row.component";
import { TimelineRulerComponent } from "../timeline-ruler/timeline-ruler.component";

import { ActionPlacementRowsComponent } from '../action-composition/action-placement-rows.component';

@Component({
    selector: "app-timeline-dope-sheet",
    standalone: true,
    imports: [ActionPlacementRowsComponent, NgClass, NgFor, NgIf, NgStyle, FaIconComponent, TimelineGraphComponent, TimelineRowComponent, TimelineRulerComponent],
    templateUrl: "timeline-dope-sheet.component.html",
    styles: [":host { display: contents; }"],
})
export class TimelineDopeSheetComponent implements OnDestroy {
    private graphResize?: ResizeObserver;
    @ViewChild('graphPane') set graphPane(pane: ElementRef<HTMLElement> | undefined) {
        this.graphResize?.disconnect();
        if(!pane) { this.timeline.graphViewportHeight = undefined; return; }
        this.graphResize = new ResizeObserver(entries => {
            const height = entries[0]?.contentRect.height;
            if(!height || height === this.timeline.graphViewportHeight) return;
            this.zone.run(() => { this.timeline.graphViewportHeight = height; this.changes.markForCheck(); });
        });
        this.graphResize.observe(pane.nativeElement);
    }
    constructor(public timeline: TimelineEditorService, private zone: NgZone, private changes: ChangeDetectorRef) {}
    ngOnDestroy(): void { this.graphResize?.disconnect(); }
}
