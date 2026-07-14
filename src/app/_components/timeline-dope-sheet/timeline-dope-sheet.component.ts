import { NgClass, NgFor, NgIf, NgStyle } from "@angular/common";
import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { TimelineEditorService } from "../../_services/timeline-editor.service";
import { TimelineGraphComponent } from "../timeline-graph/timeline-graph.component";
import { PaintEditorComponent } from "../paint-editor/paint-editor.component";
import { GRADIENT_STOPS_PAINT_EDITOR_CAPABILITIES, SOLID_ONLY_PAINT_EDITOR_CAPABILITIES } from "../paint-editor/paint-editor.types";

@Component({
    selector: "app-timeline-dope-sheet",
    standalone: true,
    imports: [FormsModule, NgClass, NgFor, NgIf, NgStyle, FaIconComponent, PaintEditorComponent, TimelineGraphComponent],
    templateUrl: "timeline-dope-sheet.component.html",
    styles: [":host { display: contents; }"],
})
export class TimelineDopeSheetComponent {
    readonly solidPaintCapabilities = SOLID_ONLY_PAINT_EDITOR_CAPABILITIES;
    readonly gradientStopsCapabilities = GRADIENT_STOPS_PAINT_EDITOR_CAPABILITIES;
    constructor(public timeline: TimelineEditorService) {}
}
