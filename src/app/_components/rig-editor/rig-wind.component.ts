import { Component } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { RigEditingService } from '../../_services/rig-editing.service';

/** Armature forces share ordinary rig channels; the selected bone only controls its response. */
@Component({
    selector:'app-rig-wind',standalone:true,imports:[NgFor,NgIf],styleUrl:'./rig-panel.scss',
    styles:':host {display:flex;flex-direction:column;gap:8px;} .wind-field {display:flex;gap:4px;min-width:0;} .wind-field input {min-width:0;} .wind-field button {flex-shrink:0;}',
    template:`<div class="rig-section-title"><span>Wind</span><span>{{rig.active?.name}}</span></div>
      <div class="rig-fields"><label *ngFor="let field of fields">{{field==='windX'?'Wind X':'Wind Y'}}
        <span class="wind-field"><input type="number" min="-1000" max="1000" step="0.1" [attr.aria-label]="field==='windX'?'Wind X':'Wind Y'" [disabled]="!rig.canEditWind" [value]="value(field)" (blur)="change(field,$event)" (keydown)="key(field,$event)" />
          <button *ngIf="rig.isAnimating" type="button" class="rig-icon-button" [disabled]="!rig.canEditWind" [attr.aria-label]="field==='windX'?'Key Wind X':'Key Wind Y'" [attr.aria-pressed]="rig.windKeyed(field)" title="Key this force at the playhead" (click)="rig.setWind(field,value(field),true)">{{rig.windKeyed(field)?'◆':'◇'}}</button>
        </span></label></div>
      <p class="rig-hint">Canvas direction: +X right, +Y down. Applies to this armature’s physics bones. Tune Wind influence per bone.</p>
      <p class="rig-hint" *ngIf="rig.isAnimating">Changing a force creates a key in the current scene or action. Shape gusts in the graph editor.</p>`,
})
export class RigWindComponent {
    readonly fields=['windX','windY'] as const;
    constructor(public rig:RigEditingService) {}
    value(field: typeof this.fields[number]): number { return this.rig.active?.[field]??0; }
    change(field:typeof this.fields[number],event:Event):void {
        const input=event.target as HTMLInputElement; this.rig.setWind(field,input.valueAsNumber);input.value=String(this.value(field));
    }
    key(field:typeof this.fields[number],event:KeyboardEvent):void {
        if(event.key==='Escape') {event.preventDefault();event.stopPropagation();(event.target as HTMLInputElement).value=String(this.value(field));(event.target as HTMLInputElement).blur();}
        else if(event.key==='Enter') {event.preventDefault();(event.target as HTMLInputElement).blur();}
    }
}
