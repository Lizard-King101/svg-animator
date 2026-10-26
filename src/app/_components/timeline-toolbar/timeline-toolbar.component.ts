import { LoopSeamControlsComponent } from '../animation-inspection/loop-seam-controls.component';
import { TimelineNavigationComponent } from './timeline-navigation.component';
import { NgClass, NgFor, NgIf } from "@angular/common";
import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { TimelineEditorService } from "../../_services/timeline-editor.service";
import { AnimationInspectionControlsComponent } from '../animation-inspection/animation-inspection-controls.component';

@Component({
    selector: "app-timeline-toolbar",
    standalone: true,
    imports: [FormsModule, NgClass, NgFor, NgIf, FaIconComponent, AnimationInspectionControlsComponent, LoopSeamControlsComponent, TimelineNavigationComponent],
    templateUrl: "timeline-toolbar.component.html",
    styles: [":host { display: contents; }"],
})
export class TimelineToolbarComponent {
    constructor(public timeline: TimelineEditorService) {}
    commitHandle(field: 'speed' | 'influence', event: Event): void {
        const input = event.target as HTMLInputElement;
        if(input.value.trim()) this.timeline.setActiveHandleValue(field, input.value);
        input.value = String((field === 'speed' ? this.timeline.activeHandleSpeed() : this.timeline.activeHandleInfluence()) ?? '');
    }
    handleKey(field: 'speed' | 'influence', event: KeyboardEvent): void {
        if(event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation();
        const input = event.target as HTMLInputElement;
        if(event.key === 'Escape') input.value = String((field === 'speed' ? this.timeline.activeHandleSpeed() : this.timeline.activeHandleInfluence()) ?? '');
        input.blur();
    }
}
