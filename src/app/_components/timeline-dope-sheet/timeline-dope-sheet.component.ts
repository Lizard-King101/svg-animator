import { NgClass, NgFor, NgIf, NgStyle } from "@angular/common";
import { Component } from "@angular/core";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { TimelineEditorService } from "../../_services/timeline-editor.service";
import { TimelineGraphComponent } from "../timeline-graph/timeline-graph.component";
import { TimelineRowComponent } from "../timeline-row/timeline-row.component";

@Component({
    selector: "app-timeline-dope-sheet",
    standalone: true,
    imports: [NgClass, NgFor, NgIf, NgStyle, FaIconComponent, TimelineGraphComponent, TimelineRowComponent],
    templateUrl: "timeline-dope-sheet.component.html",
    styles: [":host { display: contents; }"],
})
export class TimelineDopeSheetComponent {
    constructor(public timeline: TimelineEditorService) {}
}
