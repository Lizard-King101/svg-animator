import { NgClass, NgFor, NgIf, NgStyle } from "@angular/common";
import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { TimelineEditorService } from "../../_services/timeline-editor.service";
import { ColorAttribute } from "../attributes/color/color.component";
import { TimelineGraphComponent } from "../timeline-graph/timeline-graph.component";

@Component({
    selector: "app-timeline-dope-sheet",
    standalone: true,
    imports: [FormsModule, NgClass, NgFor, NgIf, NgStyle, FaIconComponent, ColorAttribute, TimelineGraphComponent],
    templateUrl: "timeline-dope-sheet.component.html",
    styles: [":host { display: contents; }"],
})
export class TimelineDopeSheetComponent {
    constructor(public timeline: TimelineEditorService) {}
}
