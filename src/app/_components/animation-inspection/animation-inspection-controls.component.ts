import { Component } from '@angular/core';
import { faLayerGroup, faRoute } from '@fortawesome/free-solid-svg-icons';
import { IconButtonComponent } from '../icon-button/icon-button.component';
import { AnimationInspectionService } from '../../_services/animation-inspection.service';

@Component({
    selector: 'app-animation-inspection-controls', standalone: true, imports: [IconButtonComponent],
    styles: [':host { display:inline-flex; flex:0 0 auto; align-items:center; gap:2px; }'],
    template: `<app-icon-button label="Onion skins" [icon]="onionIcon" [pressed]="inspection.onions"
        tooltip="Onion skins · Show nearby poses while paused. Teal: before · Amber: after."
        (activated)="toggleOnions()" />
        <app-icon-button label="Motion trails" [icon]="trailIcon" [pressed]="inspection.motionTrails"
        tooltip="Motion trails · Show the paths of selected object origins while paused"
        (activated)="inspection.motionTrails = !inspection.motionTrails" />`,
})
export class AnimationInspectionControlsComponent {
    readonly onionIcon = faLayerGroup;
    readonly trailIcon = faRoute;
    constructor(public inspection: AnimationInspectionService) {}
    toggleOnions(): void {
        this.inspection.onions = !this.inspection.onions;
    }
}
