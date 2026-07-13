import { NgFor, NgIf } from "@angular/common";
import { Component, Input } from "@angular/core";
import { TimelineEditorService } from "../../_services/timeline-editor.service";

@Component({
    selector: "app-timeline-graph",
    standalone: true,
    imports: [NgFor, NgIf],
    templateUrl: "timeline-graph.component.html",
    styles: [":host { display: contents; }"],
})
export class TimelineGraphComponent {
    @Input({ required: true }) visibleIndex = 0;
    constructor(public timeline: TimelineEditorService) {}
}
