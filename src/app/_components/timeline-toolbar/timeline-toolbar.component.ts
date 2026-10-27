import { LoopSeamControlsComponent } from '../animation-inspection/loop-seam-controls.component';
import { TimelineNavigationComponent } from './timeline-navigation.component';
import { NgClass, NgFor, NgIf } from "@angular/common";
import { Component, OnDestroy } from "@angular/core";
import { faRepeat, faSliders, faLink } from '@fortawesome/free-solid-svg-icons';
import { IconButtonComponent } from '../icon-button/icon-button.component';
import { AnimationInspectionService } from '../../_services/animation-inspection.service';
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { TimelineEditorService } from "../../_services/timeline-editor.service";
import { AnimationInspectionControlsComponent } from '../animation-inspection/animation-inspection-controls.component';

@Component({
    selector: "app-timeline-toolbar",
    standalone: true,
    imports: [FormsModule, NgClass, NgFor, NgIf, FaIconComponent, AnimationInspectionControlsComponent, LoopSeamControlsComponent, TimelineNavigationComponent, IconButtonComponent],
    templateUrl: "timeline-toolbar.component.html",
    styles: [":host { display: contents; }"],
})
export class TimelineToolbarComponent implements OnDestroy {
    readonly loopIcon = faRepeat;
    readonly settingsIcon = faSliders;
    readonly linkIcon = faLink;
    panel?: 'view' | 'loop';
    private trigger?: HTMLElement;
    private subscription;
    constructor(public timeline: TimelineEditorService, public inspection: AnimationInspectionService) {
        this.subscription = timeline.animation.contextChanging.subscribe(reason => {
            if(!reason) this.panel = undefined;
        });
    }
    ngOnDestroy(): void { this.subscription.unsubscribe(); }
    togglePanel(panel: 'view' | 'loop', event: MouseEvent): void {
        this.trigger = event.currentTarget as HTMLElement;
        this.panel = this.panel === panel ? undefined : panel;
    }
    closePanel(event: Event): void {
        event.preventDefault(); event.stopPropagation(); this.panel = undefined; this.trigger?.focus();
    }
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
