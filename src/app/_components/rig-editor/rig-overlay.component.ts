import { LatestFrame } from '../../editor/latest-frame';
import { moveBoneJoint, restSkeleton } from '../../editor/rig-rest-edit';
import { BoneDrawingService } from '../../_services/bone-drawing.service';
import { RigBindingSessionService } from '../../_services/rig-binding-session.service';
import { boneDiamond } from '../../editor/bone-glyph';
import { Component, DoCheck, HostListener, Input, OnDestroy } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { RigEditingService } from '../../_services/rig-editing.service';
import { DocumentMutationService } from '../../_services/document-mutation.service';
import { CanvasWorkspaceComponent } from '../canvas-workspace/canvas-workspace.component';
import { canvasViewProjection } from '../../editor/canvas-workspace-projection';
import { Bone, boneMatrices } from '../../editor/objects/armature';
import { applyMatrix, invertMatrix, Matrix } from '../../editor/objects/transform.object';
import { RigWeightOverlayComponent } from './rig-weight-overlay.component';

@Component({
    selector: 'app-rig-overlay', standalone: true, imports: [NgFor, NgIf, RigWeightOverlayComponent],
    template: `
      <ng-container *ngIf="rig.visible && rig.active">
        <ng-container *ngIf="bones as projectedBones">
        <svg aria-label="Armature bones"><g *ngFor="let bone of projectedBones; trackBy: track">
          <polygon *ngIf="!bone.point" class="bone-shape" [attr.points]="bone.diamond" [style.stroke]="bone.id === rig.boneId ? null : bone.color" [style.fill]="bone.color" [class.selected-bone]="bone.id === rig.boneId" [class.driven]="bone.driven" [class.ik-candidate]="bone.pickable === true" [class.ik-excluded]="bone.pickable === false" [class.picked]="session.pending?.bones?.includes(bone.id)" tabindex="0" role="button" [attr.aria-label]="'Select ' + bone.name" (pointerdown)="begin($event, bone.id, 'body')" (pointermove)="move($event)" (pointerup)="end($event)" (pointercancel)="cancel()" (lostpointercapture)="cancel()" (keydown)="key($event, bone.id)" (click)="choose(bone.id)" />
          <circle [attr.cx]="bone.start.x" [attr.cy]="bone.start.y" r="4" />
        </g></svg>
        <button *ngFor="let bone of projectedBones; trackBy: track" class="bone-tip" [class.point-bone]="bone.point" [class.picked]="session.pending?.bones?.includes(bone.id)" [style.--bone-color]="bone.color" [style.border-color]="bone.color" [style.left.px]="bone.end.x" [style.top.px]="bone.end.y" [attr.aria-label]="(rig.workspace === 'rest' ? 'Edit ' : 'Pose ') + bone.name" [title]="bone.title" [class.driven]="bone.driven" [class.ik-candidate]="bone.pickable === true" [class.ik-excluded]="bone.pickable === false" [attr.aria-pressed]="bone.id === rig.boneId"
          (click)="$event.stopPropagation(); choose(bone.id)" (pointerdown)="begin($event, bone.id, bone.point ? 'body' : 'tip')" (pointermove)="move($event)" (pointerup)="end($event)" (pointercancel)="cancel()" (lostpointercapture)="cancel()" (keydown)="key($event, bone.id)"></button>
        </ng-container>
        <app-rig-weight-overlay *ngIf="rig.workspace === 'weights'" [artwork]="artwork" [workspace]="workspace" />
      </ng-container>`,
    styles: `:host {display:contents;} svg {position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:20; overflow:visible;} line,circle {stroke:var(--accent);} circle {fill:var(--bg-surface);} .bone-tip {position:absolute; transform:translate(-50%,-50%); z-index:21; width:14px; height:14px; padding:0; border:2px solid var(--accent); background:var(--bg-surface); border-radius:50%; touch-action:none; cursor:pointer;} .bone-tip[aria-pressed=true],button:focus-visible,.selected {outline:2px solid var(--text-primary); outline-offset:2px;} .bone-shape {pointer-events:all; cursor:pointer; fill:var(--bg-surface); fill-opacity:.65; stroke:var(--text-secondary); stroke-width:1.5;} .bone-shape:hover {fill:var(--accent);} .bone-shape.picked {stroke:var(--accent); stroke-width:2.5;} .bone-shape.selected-bone {fill:var(--bg-base); fill-opacity:.9; stroke:var(--accent); stroke-width:3; paint-order:stroke;} .bone-shape:focus {outline:none;} .bone-shape:focus-visible {stroke:var(--text-primary); stroke-width:3;} .point-bone {width:22px; height:22px; background:transparent;} .point-bone::before,.point-bone::after {content:""; position:absolute; background:var(--bone-color,var(--accent)); left:50%; top:50%; transform:translate(-50%,-50%);} .point-bone::before {width:30px; height:1px;} .point-bone::after {height:30px; width:1px;} .bone-tip.picked {background:var(--bone-color,var(--accent));} .bone-shape.driven {stroke-dasharray:4 3;} .bone-tip.driven {border-style:dashed; cursor:not-allowed;} .bone-shape.ik-candidate {stroke:var(--accent); stroke-width:3; cursor:crosshair;} .bone-tip.ik-candidate {border-color:var(--accent); background:var(--accent); cursor:crosshair;} .ik-excluded {opacity:.3; cursor:not-allowed;}`,
})
export class RigOverlayComponent implements DoCheck, OnDestroy {
    @Input({ required: true }) artwork!: SVGElement;
    @Input({ required: true }) workspace!: CanvasWorkspaceComponent;
    private drag?: { tool: unknown; animationContext: string; mode: 'rest' | 'pose'; part: 'body' | 'tip'; originalBone: Bone; changes: Partial<Bone>; inverse: Matrix; parentInverse?: Matrix; id: string; rigId: string; documentId: string; revision: number; pointerId: number; capture: HTMLElement; startX: number; startY: number; startAngle: number; original: number; angle: number; joint: { x: number; y: number };
        /** Bone setup drags of a connected bone move the joint it shares with its parent. */ jointStart?: { x: number; y: number }; jointTo?: { x: number; y: number }; };
    private suppressClick = false;
    private creation?: { pointerId: number; capture: HTMLElement };
    constructor(public rig: RigEditingService, private mutations: DocumentMutationService, public session: RigBindingSessionService, public drawing: BoneDrawingService) {}
    choose(id: string): void {
        if(this.suppressClick) { this.suppressClick = false; return; }
        if(this.rig.activeId) this.session.toggle(this.rig.activeId, id);
    }
    @HostListener('mousedown', ['$event']) stopArtworkGesture(event: MouseEvent): void { event.stopPropagation(); }
    track(_index: number, item: { id: string }) { return item.id; }
    private get projection() {
        const svg = this.rig.editor.selectedSVG;
        return svg && this.artwork && this.workspace ? canvasViewProjection(svg).canvasToWorkspace : undefined;
    }
    get bones() {
        // Pose gestures preview through the shared live pose; only rest edits project a local skeleton draft.
        const source = this.rig.posePreview ?? this.rig.displayedRig, projection = this.projection; if(!source || !projection) return [];
        let projectedRig = this.drag?.mode === 'rest' ? restSkeleton(source) : source;
        if(this.drag?.mode === 'rest' && this.drag.jointTo) projectedRig = moveBoneJoint(projectedRig, this.drag.id, this.drag.jointTo) ?? projectedRig;
        else if(this.drag?.mode === 'rest') { const bone = projectedRig.bones.find(bone => bone.id === this.drag!.id); if(bone) Object.assign(bone, this.drag.changes); }
        const matrices = boneMatrices(projectedRig), influenceIds = this.session.binding?.boneIds ?? this.session.weightRig?.bones.map(bone => bone.id) ?? [];
        // While picking, only chosen bones take the swatch colors shown beside Apply.
        const colored = this.session.pending ? this.session.pending.bones : influenceIds;
        // While choosing an IK target, valid bones stand out and the rest recede.
        const targets = this.rig.ikPick ? new Set(this.rig.ikTargetCandidates.map(bone => bone.id)) : undefined;
        return projectedRig.bones.map(bone => {
            const matrix = matrices.get(bone.id)!;
            const start = applyMatrix(matrix, 0, 0), end = applyMatrix(matrix, bone.length, 0);
            const a = applyMatrix(projection, start.x, start.y), b = applyMatrix(projection, end.x, end.y);
            const driver = this.rig.workspace === 'pose' && source.constraintsActive !== false ? this.rig.drivingConstraint(bone.id) : undefined, target = targets?.has(bone.id);
            return { id: bone.id, name: bone.name, point: bone.kind === 'point', start: a, end: b, diamond: boneDiamond(a, b), color: this.rig.workspace === 'weights' && colored.includes(bone.id) ? this.session.color(bone.id) : null,
                title: target ? `Use ${bone.name} as the IK target` : driver ? `${bone.name} · follows ${driver.name}; drag its target` : bone.name, driven: !!driver,
                pickable: targets ? !!target : undefined };
        });
    }
    begin(event: PointerEvent, id: string, part: 'body' | 'tip' = 'tip'): void {
        event.stopPropagation(); if(event.button !== 0) return;
        this.cancel(); this.suppressClick = false;
        if(this.session.pending || this.rig.ikPick) return;
        this.rig.boneId = id;
        if(this.drawing.selected && this.rig.canEdit) {
            event.preventDefault(); const capture = event.currentTarget as HTMLElement;
            this.drawing.down(event); if(!this.drawing.draft) return;
            this.creation = { pointerId: event.pointerId, capture }; capture.setPointerCapture(event.pointerId); return;
        }
        if(this.rig.workspace === 'weights' || !this.rig.canManipulate || this.rig.problem || !this.projection) return;
        if(this.rig.workspace === 'pose' && this.rig.drivingConstraint(id)) return;
        const bone = this.bones.find(bone => bone.id === id), svg = this.rig.editor.selectedSVG;
        if(!bone || !svg || !this.rig.active || !this.rig.bone) return;
        event.preventDefault(); const rect = this.workspace.element.getBoundingClientRect();
        const joint = { x: bone.start.x + rect.left, y: bone.start.y + rect.top }, capture = event.currentTarget as HTMLElement;
        const displayed = this.rig.displayedRig!, originalBone = displayed.bones.find(item => item.id === id)!;
        const parent = originalBone.parentId ? boneMatrices(displayed).get(originalBone.parentId) : undefined;
        this.drag = { tool: this.rig.editor.activeTool, animationContext: this.rig.animationContext, mode: this.rig.workspace, part, originalBone: { ...originalBone }, changes: {}, inverse: invertMatrix(this.projection), parentInverse: parent ? invertMatrix(parent) : undefined, id, rigId: this.rig.active.id, documentId: svg.id, revision: this.mutations.revision, pointerId: event.pointerId, capture, joint, startX: event.clientX, startY: event.clientY,
            startAngle: Math.atan2(event.clientY - joint.y, event.clientX - joint.x), original: this.rig.bone.pose, angle: this.rig.bone.pose,
            jointStart: this.rig.workspace === 'rest' && part === 'body' && this.rig.isJointConnected(id) ? this.jointWorld(id) : undefined };
        capture.focus(); capture.setPointerCapture(event.pointerId);
    }
    private readonly previewFrame = new LatestFrame<PointerEvent>(event => this.previewMove(event));
    move(event: PointerEvent): void {
        if(this.creation) { if(this.creation.pointerId === event.pointerId) this.drawing.move(event); return; }
        if(this.drag?.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        this.previewFrame.queue(event);
    }
    private previewMove(event: PointerEvent): void {
        if(this.creation) { if(this.creation.pointerId === event.pointerId) this.drawing.move(event); return; }
        this.ngDoCheck();
        const drag = this.drag; if(!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        if(Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) { drag.angle = drag.original; drag.changes = {}; drag.jointTo = undefined; if(drag.mode === 'pose') this.rig.clearPosePreview(); return; }
        this.update(drag, event);
        if(drag.mode !== 'pose') return;
        if(drag.part === 'tip') this.rig.previewFK(drag.id, { pose: drag.angle });
        else this.rig.previewFK(drag.id, { poseX: drag.changes.poseX!, poseY: drag.changes.poseY! });
    }
    private jointWorld(id: string) { const rig = this.rig.displayedRig!; return applyMatrix(boneMatrices(rig).get(id)!, 0, 0); }
    private update(drag: NonNullable<RigOverlayComponent['drag']>, event: PointerEvent): void {
        if(drag.jointStart) {
            const rect = this.workspace.element.getBoundingClientRect();
            const start = applyMatrix(drag.inverse, drag.startX - rect.left, drag.startY - rect.top), end = applyMatrix(drag.inverse, event.clientX - rect.left, event.clientY - rect.top);
            drag.jointTo = { x: drag.jointStart.x + end.x - start.x, y: drag.jointStart.y + end.y - start.y }; return;
        }
        if(drag.mode === 'rest' || drag.part === 'body') {
            const rect = this.workspace.element.getBoundingClientRect();
            const local = (x: number, y: number) => { const world = applyMatrix(drag.inverse, x - rect.left, y - rect.top); return drag.parentInverse ? applyMatrix(drag.parentInverse, world.x, world.y) : world; };
            const start = local(drag.startX, drag.startY), end = local(event.clientX,event.clientY), bone = drag.originalBone;
            if(drag.part === 'body') {
                drag.changes = drag.mode === 'rest' ? { x:bone.x + (bone.poseX ?? 0) + end.x-start.x, y:bone.y + (bone.poseY ?? 0) + end.y-start.y } : {poseX:(bone.poseX ?? 0)+end.x-start.x, poseY:(bone.poseY ?? 0)+end.y-start.y};
            } else {
                const x = end.x - bone.x - (bone.poseX ?? 0), y = end.y - bone.y - (bone.poseY ?? 0);
                drag.changes = { angle:Math.atan2(y,x)*180/Math.PI, length:Math.max(.001,Math.hypot(x,y)) };
            }
            return;
        }
        const delta = Math.atan2(event.clientY - drag.joint.y, event.clientX - drag.joint.x) - drag.startAngle;
        drag.angle = Math.round((drag.original + Math.atan2(Math.sin(delta), Math.cos(delta)) * 180 / Math.PI) * 100) / 100;
    }
    end(event: PointerEvent): void {
        if(this.creation) { if(this.creation.pointerId !== event.pointerId) return; this.drawing.up(event); this.suppressClick = true; this.cancel(); return; }
        const drag = this.drag; if(!drag || drag.pointerId !== event.pointerId) return;
        event.stopPropagation(); this.ngDoCheck(); if(!this.drag) return;
        this.move(event); this.previewFrame.flush(); this.cancel(); this.rig.boneId = drag.id;
        if(drag.mode === 'rest') { if(drag.jointTo) this.rig.moveJoint(drag.id, drag.jointTo); else if(Object.keys(drag.changes).length) this.rig.editBone(drag.changes); }
        else if(drag.part === 'body') { if(Object.keys(drag.changes).length) this.rig.setPosePosition(drag.changes.poseX!, drag.changes.poseY!, drag.id); }
        else this.rig.setPose(drag.angle, drag.id);
    }
    key(event: KeyboardEvent, id: string): void {
        this.suppressClick = false;
        if((this.session.pending || this.rig.ikPick) && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); this.choose(id); return; }
        if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancel(); return; }
        if(!this.rig.canManipulate || this.rig.workspace === 'weights' || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
        if(this.rig.workspace === 'pose' && this.rig.drivingConstraint(id)) return;
        event.preventDefault(); event.stopPropagation(); this.cancel(); this.rig.boneId = id;
        const bone = this.rig.workspace === 'rest' ? this.rig.displayedRig?.bones.find(item => item.id === id) : this.rig.bone; if(!bone) return;
        if(this.rig.workspace === 'rest' || bone.kind === 'point') {
            const step = event.shiftKey ? 10 : 1, x = (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y = (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
            if(this.rig.workspace === 'rest' && this.rig.isJointConnected(id)) { const start = this.jointWorld(id); this.rig.moveJoint(id, { x: start.x + x, y: start.y + y }); return; }
            if(this.rig.workspace === 'rest') this.rig.editBone({ x:bone.x + (bone.poseX ?? 0) + x, y:bone.y + (bone.poseY ?? 0) + y });
            else this.rig.setPosePosition((bone.poseX ?? 0) + x, (bone.poseY ?? 0) + y);
            return;
        }
        this.rig.setPose((this.rig.bone?.pose ?? 0) + (['ArrowLeft','ArrowDown'].includes(event.key) ? -1 : 1) * (event.shiftKey ? 10 : 1));
    }
    @HostListener('window:blur') cancel(): void {
        this.previewFrame.cancel();
        const creation = this.creation; this.creation = undefined;
        if(creation) { this.drawing.cancel(); if(creation.capture.hasPointerCapture(creation.pointerId)) creation.capture.releasePointerCapture(creation.pointerId); }
        const drag = this.drag; this.drag = undefined;
        if(drag?.mode === 'pose') this.rig.clearPosePreview();
        if(drag?.capture.hasPointerCapture(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId);
    }
    ngDoCheck(): void {
        this.session.validate(); this.drawing.validate(); if(this.creation && !this.drawing.draft) this.cancel();
        const drag = this.drag;
        if(drag && (!this.rig.visible || !this.rig.canManipulate || this.rig.workspace !== drag.mode || drag.animationContext !== this.rig.animationContext || drag.tool !== this.rig.editor.activeTool || drag.id !== this.rig.boneId || drag.rigId !== this.rig.activeId || drag.documentId !== this.rig.editor.selectedSVG?.id || drag.revision !== this.mutations.revision)) this.cancel();
    }
    ngOnDestroy(): void { this.cancel(); }
}
