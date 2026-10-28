import { LatestFrame } from '../../editor/latest-frame';
import { RigBindingSessionService } from '../../_services/rig-binding-session.service';
import { ChangeDetectorRef, Component, DoCheck, HostListener, Input, OnDestroy } from '@angular/core';
import { NgIf } from '@angular/common';
import { RigEditingService } from '../../_services/rig-editing.service';
import { DocumentMutationService } from '../../_services/document-mutation.service';
import { CanvasWorkspaceComponent } from '../canvas-workspace/canvas-workspace.component';
import { canvasViewProjection } from '../../editor/canvas-workspace-projection';
import { applyMatrix, invertMatrix, Matrix } from '../../editor/objects/transform.object';
import { boneMatrices } from '../../editor/objects/armature';

@Component({
    selector:'app-ik-target', standalone:true, imports:[NgIf],
    template:`<ng-container *ngIf="target as target">
      <svg aria-hidden="true"><line [attr.x1]="target.end.x" [attr.y1]="target.end.y" [attr.x2]="target.x" [attr.y2]="target.y" /></svg>
      <button class="ik-target" [class.persistent]="!!rig.activeIKConstraint" [style.left.px]="target.x" [style.top.px]="target.y" [attr.aria-label]="targetLabel" title="Drag IK target · Arrow keys move · Shift: 10 units" (mousedown)="$event.stopPropagation()" (click)="$event.stopPropagation()"
        (pointerdown)="begin($event)" (pointermove)="move($event)" (pointerup)="end($event)" (pointercancel)="cancel()" (lostpointercapture)="cancel()" (blur)="cancel()" (keydown)="key($event)">+</button>
    </ng-container>`,
    styles:`:host {display:contents;} svg {position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:23; overflow:visible;} line {stroke:var(--accent); stroke-width:1.5; stroke-dasharray:4 3;} .ik-target {position:absolute; transform:translate(-50%,-50%); z-index:24; width:24px; height:24px; padding:0; border:2px solid var(--accent); border-radius:var(--radius-sm); background:var(--bg-surface); color:var(--accent); line-height:18px; font-size:20px; touch-action:none; cursor:move;} .ik-target.persistent {border-radius:50%;} .ik-target:focus-visible {outline:2px solid var(--text-primary); outline-offset:3px;}`,
})
export class IKTargetComponent implements DoCheck, OnDestroy {
    @Input({required:true}) artwork!: SVGElement;
    @Input({required:true}) workspace!: CanvasWorkspaceComponent;
    private drag?: { pointerId:number; capture:HTMLElement; documentId:string; rigId:string; boneId:string; constraintId?:string; revision:number; animationContext:string; tool:unknown; inverse:Matrix; left:number; top:number; startX:number; startY:number; origin:{x:number;y:number}; target:{x:number;y:number}; moved:boolean };
    constructor(public rig:RigEditingService,private mutations:DocumentMutationService,private session:RigBindingSessionService, detector?:ChangeDetectorRef) {
        this.physicsSubscription=rig.physicsFrames?.subscribe(()=>detector?.detectChanges());
    }
    private physicsSubscription;
    get enabled() { return !this.session.pending && this.rig.canPose && this.rig.visible && this.rig.workspace === 'pose' && (this.rig.activeIKConstraint ? this.rig.activeIKConstraint.enabled : this.rig.poseMethod === 'ik') && !!this.rig.ikChain; }
    get targetLabel() {
        const constraint = this.rig.activeIKConstraint;
        return constraint ? 'Move IK target ' + this.rig.active?.bones.find(bone => bone.id === constraint.targetBoneId)?.name : 'IK target for ' + this.rig.bone?.name;
    }
    private get projection() {
        const svg=this.rig.editor.selectedSVG;
        return svg && this.artwork && this.workspace ? canvasViewProjection(svg).canvasToWorkspace : undefined;
    }
    get target() {
        const projection=this.projection, point=this.drag?.target ?? this.rig.ikTargetPosition, chain=this.rig.ikChain;
        if(!this.enabled || !projection || !point || !chain) return undefined;
        const end=applyMatrix(boneMatrices(this.rig.posePreview ?? this.rig.displayedRig!).get(chain.lower.id)!,chain.lower.length,0);
        return {...applyMatrix(projection,point.x,point.y),end:applyMatrix(projection,end.x,end.y)};
    }
    begin(event:PointerEvent):void {
        event.stopPropagation(); if(event.button !== 0 || !this.enabled || !this.projection || this.rig.problem) return;
        event.preventDefault(); this.cancel(); const capture=event.currentTarget as HTMLElement, rect=this.workspace.element.getBoundingClientRect(), origin=this.rig.ikTargetPosition!;
        capture.focus();
        this.drag={pointerId:event.pointerId,capture,documentId:this.rig.editor.selectedSVG!.id,rigId:this.rig.activeId!,boneId:this.rig.boneId!,revision:this.mutations.revision,animationContext:this.rig.animationContext,tool:this.rig.editor.activeTool,
            constraintId:this.rig.activeIKConstraint?.id,inverse:invertMatrix(this.projection),left:rect.left,top:rect.top,startX:event.clientX,startY:event.clientY,origin,target:origin,moved:false};
        capture.setPointerCapture(event.pointerId);
    }
    private readonly previewFrame = new LatestFrame<PointerEvent>(event => this.previewMove(event));
    move(event:PointerEvent):void {
        if(this.drag?.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        this.previewFrame.queue(event);
    }
    private previewMove(event:PointerEvent):void {
        this.ngDoCheck();
        const drag=this.drag; if(!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        drag.moved=Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>=3;
        if(!drag.moved) { drag.target=drag.origin; this.rig.cancelPoseGesture(); return; }
        const start=applyMatrix(drag.inverse,drag.startX-drag.left,drag.startY-drag.top), end=applyMatrix(drag.inverse,event.clientX-drag.left,event.clientY-drag.top);
        drag.target={x:drag.origin.x+end.x-start.x,y:drag.origin.y+end.y-start.y};
        this.rig.previewIK(drag.target);
    }
    end(event:PointerEvent):void {
        if(this.drag?.pointerId !== event.pointerId) return;
        this.ngDoCheck(); if(!this.drag) return;
        this.move(event); this.previewFrame.flush(); const drag=this.drag;
        if(!drag) return; this.cancel();
        if(drag.moved) this.rig.setIKTarget(drag.target);
    }
    key(event:KeyboardEvent):void {
        if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); this.cancel(); return; }
        if(!this.enabled || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); this.cancel();
        const point=this.rig.ikTargetPosition!, step=event.shiftKey ? 10 : 1;
        this.rig.setIKTarget({x:point.x+(event.key==='ArrowLeft' ? -step : event.key==='ArrowRight' ? step : 0),y:point.y+(event.key==='ArrowUp' ? -step : event.key==='ArrowDown' ? step : 0)});
    }
    @HostListener('window:blur') cancel():void {
        this.previewFrame.cancel();
        const drag=this.drag; this.drag=undefined;
        if(drag) this.rig.cancelPoseGesture();
        if(drag?.capture.hasPointerCapture(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId);
    }
    ngDoCheck():void {
        const drag=this.drag;
        if(drag && (!this.enabled || drag.animationContext!==this.rig.animationContext || drag.documentId!==this.rig.editor.selectedSVG?.id || drag.rigId!==this.rig.activeId || drag.boneId!==this.rig.boneId || drag.constraintId!==this.rig.activeIKConstraint?.id || drag.revision!==this.mutations.revision || drag.tool!==this.rig.editor.activeTool)) this.cancel();
    }
    ngOnDestroy():void { this.physicsSubscription?.unsubscribe(); this.cancel(); }
}
