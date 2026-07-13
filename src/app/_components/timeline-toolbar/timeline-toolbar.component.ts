import { NgClass, NgFor, NgIf } from "@angular/common";
import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { TimelineEditorService } from "../../_services/timeline-editor.service";

@Component({
    selector: "app-timeline-toolbar",
    standalone: true,
    imports: [FormsModule, NgClass, NgFor, NgIf, FaIconComponent],
    templateUrl: "timeline-toolbar.component.html",
    styles: [":host { display: contents; }"],
})
export class TimelineToolbarComponent {
    constructor(public timeline: TimelineEditorService) {}
}
