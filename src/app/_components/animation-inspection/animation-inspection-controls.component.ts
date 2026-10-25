import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf } from '@angular/common';
import { AnimationInspectionService } from '../../_services/animation-inspection.service';

@Component({
    selector: 'app-animation-inspection-controls', standalone: true, imports: [FormsModule, NgIf],
    styles: [':host { display:flex; flex:0 0 auto; min-height:30px; padding:4px 10px; border-bottom:1px solid var(--border); align-items:center; gap:12px; flex-wrap:wrap; } .hint { color:var(--text-muted); font-size:10px; }'],
    template: `<label class="timeline-check" title="Selected artwork, or animated artwork when nothing is selected. Teal before, amber after. Hidden during playback.">
        <input type="checkbox" [(ngModel)]="inspection.onions" /><span>Onion skins</span></label>
        <label class="timeline-field"><span>Spacing (s)</span><input aria-label="Onion skin spacing in seconds" type="number"
            min="0.01" max="10" step="0.05" [disabled]="!inspection.onions" [ngModel]="inspection.step" (ngModelChange)="inspection.setStep($event)" /></label>
        <label class="timeline-check" title="Origin trails for up to eight selected objects; 60 intervals over the full duration. Hidden during playback.">
        <input type="checkbox" [(ngModel)]="inspection.motionTrails" /><span>Motion trails</span></label>
        <span class="hint" *ngIf="inspection.onions">Teal: before · Amber: after</span>
        <span class="hint" *ngIf="inspection.motionTrails">Select objects to trace their origins · paused preview only</span>`,
})
export class AnimationInspectionControlsComponent {
    constructor(public inspection: AnimationInspectionService) {}
}
