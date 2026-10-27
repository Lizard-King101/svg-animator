import { Component, Input } from '@angular/core';
import { NgIf } from '@angular/common';
import { RigEditingService } from '../../_services/rig-editing.service';
@Component({
    selector: 'app-rig-layer-badge', standalone: true, imports: [NgIf],
    template: `<button *ngIf="rig.linkFor(elementId) as link" [title]="link.label + ' · Select bone'" [attr.aria-label]="link.label" (mousedown)="$event.stopPropagation()" (click)="$event.stopPropagation(); rig.selectBone(link.rigId, link.boneId)">◇</button>`,
    styles: `:host {display:inline-flex;} button {padding:0 3px; border:0; background:transparent; color:var(--accent); cursor:pointer;}`,
})
export class RigLayerBadgeComponent { @Input({required: true}) elementId!: string; constructor(public rig: RigEditingService) {} }
