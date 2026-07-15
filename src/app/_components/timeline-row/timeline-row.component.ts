import { NgClass, NgIf, NgStyle } from "@angular/common";
import { Component, Input } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { TimelineEditorService } from "../../_services/timeline-editor.service";
import { TimelineRow } from "../../_services/timeline-editing.service";
import { PaintEditorComponent } from "../paint-editor/paint-editor.component";
import { GRADIENT_STOPS_PAINT_EDITOR_CAPABILITIES, SOLID_ONLY_PAINT_EDITOR_CAPABILITIES } from "../paint-editor/paint-editor.types";

@Component({
    selector: "app-timeline-row",
    standalone: true,
    imports: [FormsModule, NgClass, NgIf, NgStyle, FaIconComponent, PaintEditorComponent],
    templateUrl: "timeline-row.component.html",
    styles: [":host { display: contents; }"],
})
export class TimelineRowComponent {
    @Input({ required: true }) row!: TimelineRow;
    readonly solidPaintCapabilities = SOLID_ONLY_PAINT_EDITOR_CAPABILITIES;
    readonly gradientStopsCapabilities = GRADIENT_STOPS_PAINT_EDITOR_CAPABILITIES;

    constructor(public timeline: TimelineEditorService) {}
}
