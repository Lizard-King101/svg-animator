import { NgFor, NgIf } from "@angular/common";
import { Component } from "@angular/core";
import { TimelineEditorService } from "../../_services/timeline-editor.service";

@Component({
    selector: "app-timeline-graph",
    standalone: true,
    imports: [NgFor, NgIf],
    templateUrl: "timeline-graph.component.html",
    styles: [":host { display: contents; }"],
})
export class TimelineGraphComponent {
    constructor(public timeline: TimelineEditorService) {}
}
