import { Component } from '@angular/core';
import { NgFor, NgIf, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActionCompositionService } from '../../_services/action-composition.service';
import { TimelineEditorService } from '../../_services/timeline-editor.service';
import { ActionPlacement, placementTiming } from '../../editor/objects/animation.object';
import { ActionPlacementBlockComponent } from './action-placement-block.component';

/** Placement rows participate directly in the existing timeline grid and scroll container. */
@Component({
    selector: 'app-action-placement-rows', standalone: true, imports: [DecimalPipe, NgFor, NgIf, FormsModule, ActionPlacementBlockComponent],
    template: `<ng-container *ngIf="!actions.playback.activeAction">
      <ng-container *ngFor="let placement of actions.placements; trackBy: identity">
        <div class="placement-label" [attr.title]="actions.loopWarning(placement) || null" [style.height.px]="timeline.placementRowHeight">
          <div><button (click)="actions.playback.editAction(placement.actionId)" title="Edit linked source">{{actions.action(placement.actionId)?.name}}</button>
            <label>Start <input type="number" min="0" step="0.01" [attr.aria-label]="'Start of ' + name(placement)" [ngModel]="placement.start" (blur)="change(placement, 'start', $event)" (keydown)="key(placement, 'start', $event)"></label>
            <button (click)="actions.repeatPlacement(placement)" title="Copy timing into an adjacent linked placement">Repeat</button>
            <span *ngIf="actions.loopWarning(placement)" aria-label="Trimmed loop seam warning">⚠</span>
            <button (click)="actions.removePlacement(placement)" aria-label="Remove placement">×</button></div>
          <div><label *ngFor="let field of fields">{{field.label}} <input type="number" [step]="field.key === 'repeat' ? 1 : .01"
            [attr.aria-label]="field.label + ' of ' + name(placement)" [ngModel]="value(placement, field.key)"
            (blur)="change(placement, field.key, $event)" (keydown)="key(placement, field.key, $event)"></label></div>
        </div>
        <div class="placement-time" [style.height.px]="timeline.placementRowHeight">
          <div class="placement-lane" [style.width.px]="timeline.timelineContentWidth" [style.--timeline-grid-step]="timeline.gridStepWidth()" [style.--timeline-grid-offset]="timeline.gridOffset()">
            <app-action-placement-block [placement]="placement" [pixelsPerSecond]="timeline.pixelsPerSecond" [padding]="timeline.timePadding" [domainStart]="timeline.timeDomainStart" />
            <div class="playhead animation-playhead" [attr.data-pixels-per-second]="timeline.pixelsPerSecond" [attr.data-time-padding]="timeline.timePadding" [attr.data-domain-start]="timeline.timeDomainStart" [style.left]="timeline.playheadLeft()"></div>
            <small>{{actions.duration(placement) | number:'1.0-3'}} s · {{value(placement, 'rate')}}× · {{value(placement, 'repeat')}} loops</small>
          </div>
        </div>
      </ng-container>
    </ng-container>`,
    styles: [`:host { display:contents; }
      .placement-label { position:sticky; left:0; z-index:5; width:360px; box-sizing:border-box; padding:4px 8px; border-bottom:1px solid var(--border); background:var(--bg-base); }
      .placement-label > div { display:flex; align-items:center; gap:5px; height:27px; }
      label { display:flex; align-items:center; gap:3px; margin:0; font-size:10px; }
      input { width:56px; } button, input { color:inherit; background:var(--bg-base); border:1px solid var(--border); border-radius:var(--radius-sm); padding:2px 4px; font-size:11px; }
      button:first-child { max-width:105px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      button:focus-visible, input:focus-visible { outline:2px solid var(--accent); }
      .placement-time { min-width:0; border-bottom:1px solid var(--border); box-sizing:border-box; }
      .placement-lane { position:relative; height:100%; padding-top:5px; box-sizing:border-box; background-image:linear-gradient(to right,var(--border) 1px,transparent 1px); background-size:var(--timeline-grid-step) 100%; background-position-x:var(--timeline-grid-offset); }
      .playhead { position:absolute; top:0; bottom:0; width:1px; background:var(--accent); pointer-events:none; z-index:2; }
      small { display:block; padding:3px 28px; color:var(--text-muted); font-size:10px; }`],
})
export class ActionPlacementRowsComponent {
    fields = [{ key: 'sourceStart', label: 'In' }, { key: 'sourceEnd', label: 'Out' }, { key: 'rate', label: 'Rate' }, { key: 'repeat', label: 'Loops' }] as const;
    constructor(public actions: ActionCompositionService, public timeline: TimelineEditorService) {}
    identity(_index: number, placement: ActionPlacement): string { return placement.id; }
    name(p: ActionPlacement): string { return this.actions.action(p.actionId)?.name ?? 'Action'; }
    value(p: ActionPlacement, field: 'start' | 'sourceStart' | 'sourceEnd' | 'rate' | 'repeat'): number {
        return field === 'start' ? p.start : placementTiming(p, this.actions.action(p.actionId)?.animation.duration ?? 1)[field];
    }
    change(p: ActionPlacement, field: 'start' | 'sourceStart' | 'sourceEnd' | 'rate' | 'repeat', event: Event): void {
        const input = event.target as HTMLInputElement, value = input.value === '' ? NaN : Number(input.value);
        if(value !== this.value(p, field)) {
            if(field === 'start') this.actions.move(p, value);
            else this.actions.retime(p, { [field]: value });
        }
        input.value = String(this.value(p, field));
    }
    key(p: ActionPlacement, field: 'start' | 'sourceStart' | 'sourceEnd' | 'rate' | 'repeat', event: KeyboardEvent): void {
        if(event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation();
        const input = event.target as HTMLInputElement;
        if(event.key === 'Escape') input.value = String(this.value(p, field));
        input.blur();
    }
}
