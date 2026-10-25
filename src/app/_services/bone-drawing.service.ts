import { Injectable } from '@angular/core';
import { RigEditingService } from './rig-editing.service';
import { DocumentMutationService } from './document-mutation.service';
import { BoneTool } from './tools/bone.tool';
import { boneMatrices } from '../editor/objects/armature';
import { applyMatrix } from '../editor/objects/transform.object';

type Position = { x: number; y: number };
@Injectable()
export class BoneDrawingService {
    readonly pointDeadzone = 5;
    /** Screen distance within which a new bone starts exactly on the selected bone's tip. */
    readonly tipSnap = 12;
    draft?: { start: Position; end: Position; kind: 'bone' | 'point'; parentId?: string; rigId?: string; documentId: string; revision: number; screen: Position };
    get selected() { return this.rigs.editor.activeTool instanceof BoneTool; }
    constructor(public rigs: RigEditingService, private mutations: DocumentMutationService) {}
    activate(): void { this.cancel(); this.rigs.enterEdit(); }
    down(event: MouseEvent): void {
        if(event.button !== 0 || !this.rigs.canEdit || !this.selected) return;
        const start = this.parentTip(event) ?? this.rigs.editor.toCanvasPoint(event.clientX, event.clientY);
        this.draft = { start, end: start, kind: 'point', parentId: this.rigs.boneId, rigId: this.rigs.activeId,
            documentId: this.rigs.editor.selectedSVG!.id, revision: this.mutations.revision, screen: { x: event.clientX, y: event.clientY } };
    }
    move(event: MouseEvent): void {
        this.validate(); const draft = this.draft; if(!draft) return;
        draft.kind = Math.hypot(event.clientX-draft.screen.x,event.clientY-draft.screen.y) < this.pointDeadzone ? 'point' : 'bone';
        let point = this.rigs.editor.toCanvasPoint(event.clientX, event.clientY);
        if(event.shiftKey && draft.kind === 'bone') {
            const length = Math.hypot(point.x - draft.start.x, point.y - draft.start.y);
            const angle = Math.round(Math.atan2(point.y - draft.start.y, point.x - draft.start.x) / (Math.PI / 12)) * Math.PI / 12;
            draft.end = { x: draft.start.x + Math.cos(angle) * length, y: draft.start.y + Math.sin(angle) * length };
        } else draft.end = point;
    }
    up(event: MouseEvent): void {
        this.move(event); const draft = this.draft; this.cancel(); if(!draft) return;
        if(event.target instanceof Element && !event.target.closest('app-canvas-workspace')) return;

        this.rigs.drawBone(draft.start, draft.end, draft.kind, draft.parentId);
    }
    /** Chains drawn tip-to-tip must connect exactly; IK needs the joint, and a pixel of drift is invisible. */
    private parentTip(event: MouseEvent): Position | undefined {
        const rig = this.rigs.displayedRig, parent = rig?.bones.find(bone => bone.id === this.rigs.boneId);
        if(!rig || !parent) return undefined;
        const tip = applyMatrix(boneMatrices(rig).get(parent.id)!, parent.length, 0);
        const pointer = this.rigs.editor.toCanvasPoint(event.clientX, event.clientY), reach = this.rigs.editor.toCanvasPoint(event.clientX + this.tipSnap, event.clientY);
        return Math.hypot(tip.x - pointer.x, tip.y - pointer.y) <= Math.hypot(reach.x - pointer.x, reach.y - pointer.y) ? tip : undefined;
    }
    validate(): void {
        const draft = this.draft;
        if(draft && (!this.selected || !this.rigs.canEdit || draft.revision !== this.mutations.revision || draft.documentId !== this.rigs.editor.selectedSVG?.id || draft.rigId !== this.rigs.activeId || draft.parentId !== this.rigs.boneId)) this.cancel();
    }
    cancel(): void { this.draft = undefined; }
}
