import { RowDropPosition } from '../editor/row-pointer-drag';
import { chainBend, solveTwoBoneIK, twoBoneChain } from '../editor/two-bone-ik';
import { constraintJointGap, evaluateRigConstraints, rigConstraintProblem } from '../editor/rig-constraints';
import { editableRestRig, moveBoneJoint, REST_REQUIRED, restSkeleton } from '../editor/rig-rest-edit';
import { applyAttachments, attachmentProblem, attachmentTransforms } from '../editor/rig-attachments';
import { AnyElement, SVG } from '../editor/objects/svg.object';
import { captureGeometrySnapshot, restoreGeometrySnapshot } from '../editor/objects/element-geometry';
import { applyMatrix, invertMatrix, multiplyMatrix } from '../editor/objects/transform.object';
import { findAnimationTarget } from '../editor/objects/animation-targets';
import { Injectable } from '@angular/core';
import { Armature, Bone, TwoBoneIKConstraint, WeightPointRef, boneMatrices, deformBinding, effectivePointWeights, hasBonePose, isConnectedBoneJoint, validRigs } from '../editor/objects/armature';
import { addPathBindings, prepareArtworkAssignment } from '../editor/rig-assignment';
import { automaticWeightUpdates, editWeightInfluence, pointWeightState } from '../editor/rig-weight-editing';
import { nativeWeightPaths, weightScopeProblem } from '../editor/rig-artwork-scope';
import { detachBindingWeights, linkCoincidentWeights, setPointIndependent, unlinkPointWeights } from '../editor/rig-point-weights';
import { assignWeightUpdates, changeScopeInfluences, WeightUpdate } from '../editor/rig-weight-commands';
import { applyRigPose, bindingProblem } from '../editor/rig-binding';
import { findElementChain, pinTransformOrigin, parentMatrixFor } from '../editor/objects/element-bounds';
import { isGeometryVisible } from '../editor/objects/element-availability';
import { Path } from '../editor/objects/elements/path.object';
import { combinedMotionAdjustedMatrixFor } from '../editor/objects/motion-path.object';
import { allAnimationDocuments } from '../editor/objects/animation.object';
import { EditorService } from './editor.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService, MutationDomain } from './document-mutation.service';
import { RigAnimationField, rigAnimationProperty } from '../editor/rig-animation';
import { documentRigChannelProblem } from '../editor/rig-animation-conflicts';

/** Owns rig commands; selection and the rest/pose workspace are session-only. */
@Injectable()
export class RigEditingService {
    anchorId = '';
    activeId?: string;
    boneId?: string;
    private currentWorkspace: 'rest' | 'pose' | 'weights' = 'rest';
    get workspace() { return this.isAnimating ? 'pose' as const : this.currentWorkspace; }
    set workspace(value: 'rest' | 'pose' | 'weights') {
        if(value === 'pose' && this.active?.constraintsActive === false && this.canEdit) {
            if(!this.readyToPose()) return;
            const candidate = structuredClone(this.active); candidate.constraintsActive = true;
            if(!this.commitPose(candidate)) return;
        }
        this.clearPosePreview();
        if(value !== this.currentWorkspace) this.message = '';
        this.currentWorkspace = value;
    }
    poseMethod: 'fk' | 'ik' = 'fk';
    /** Uncommitted evaluated pose shown on the live artwork; every rig command restores it before committing. */
    private livePose?: { svg: SVG; rigId: string; rig: Armature; restore: () => void };
    get posePreview(): Armature | undefined { const live = this.livePose; return live && live.svg === this.editor.selectedSVG && live.rigId === this.activeId ? live.rig : undefined; }
    private ikBends = new Map<string, 1 | -1>();
    selectedIKConstraintId?: string;
    get selectedIKConstraints() { return this.active?.constraints?.filter(item => [item.upperBoneId,item.lowerBoneId,item.targetBoneId].includes(this.boneId ?? '')) ?? []; }
    get activeIKConstraint(): TwoBoneIKConstraint | undefined { return this.selectedIKConstraints.find(item => item.id === this.selectedIKConstraintId) ?? this.selectedIKConstraints[0]; }
    selectIKConstraint(id: string): void { this.selectedIKConstraintId = id; this.clearPosePreview(); }
    get displayedRig() { try { return this.active && evaluateRigConstraints(this.playback.isRigPreviewed(this.active.id) ? {...this.active, constraintsActive:true} : this.active); } catch { return this.active; } }
    /** The enabled constraint that owns a bone's rotation; such bones are posed through their target. */
    drivingConstraint(boneId: string): TwoBoneIKConstraint | undefined { return this.active?.constraints?.find(item => item.enabled && [item.upperBoneId,item.lowerBoneId].includes(boneId)); }
    get ikChain() { const rig = this.displayedRig, id = this.activeIKConstraint?.lowerBoneId ?? this.boneId; return rig && id ? twoBoneChain(rig,id) : undefined; }
    get ikBend(): 1 | -1 { return this.activeIKConstraint?.bend ?? this.ikBends.get(this.activeId + ':' + this.boneId) ?? (this.active && this.boneId ? chainBend(this.active,this.boneId) : 1); }
    get ikEndpoint() {
        const chain = this.ikChain; if(!chain || !this.active) return undefined;
        return applyMatrix(boneMatrices(this.displayedRig!).get(chain.lower.id)!,chain.lower.length,0);
    }
    get ikTargetPosition() {
        const constraint = this.activeIKConstraint, rig = this.displayedRig;
        if(!constraint || !rig) return this.ikEndpoint;
        const matrix = boneMatrices(rig).get(constraint.targetBoneId); return matrix && applyMatrix(matrix,0,0);
    }
    /** Any bone that neither rides on the chain nor carries it, such as a foot or hand control under the root. Its start is the goal. */
    get ikTargetCandidates() {
        const rig = this.active, upperId = this.activeIKConstraint?.upperBoneId ?? this.ikChain?.upper.id; if(!rig || !upperId) return [];
        return rig.bones.filter(bone => !this.descendsFrom(rig,bone.id,upperId) && !this.descendsFrom(rig,upperId,bone.id));
    }
    private ikPickState?: { documentId: string; rigId: string; lowerBoneId: string; revision: number };
    /** Session-only target picking for a new IK constraint; any context change makes it inactive. */
    get ikPick() {
        const pick = this.ikPickState;
        return pick && pick.documentId === this.editor.selectedSVG?.id && pick.rigId === this.activeId && pick.revision === this.mutations.revision && this.canEdit && this.workspace !== 'weights' ? pick : undefined;
    }
    beginIKTargetPick(): void {
        const chain = this.ikChain, svg = this.editor.selectedSVG;
        if(!chain || !svg || !this.activeId || !this.canEdit) return;
        this.ikPickState = { documentId: svg.id, rigId: this.activeId, lowerBoneId: chain.lower.id, revision: this.mutations.revision }; this.message = '';
    }
    cancelIKTargetPick(): void { this.ikPickState = undefined; }
    /** Completes picking: a bone outside the chain becomes the target, or no bone creates one at the tip. */
    pickIKTarget(targetBoneId?: string): boolean {
        const pick = this.ikPick; if(!pick) return false;
        this.boneId = pick.lowerBoneId;
        const chain = this.ikChain;
        if(targetBoneId && !this.ikTargetCandidates.some(bone => bone.id === targetBoneId)) {
            this.message = `Pick a bone outside ${chain ? chain.upper.name + ' → ' + chain.lower.name : 'this chain'} and the bones carrying it.`; return false;
        }
        this.ikPickState = undefined;
        return this.createIKConstraint(targetBoneId ?? '');
    }
    visible = false;
    message = '';
    pathName(id: string) { return findAnimationTarget(this.editor.selectedSVG?.elements ?? [], id)?.name ?? 'Missing path'; }
    get armatures() { return this.editor.selectedSVG?.rigs.armatures ?? []; }
    get active() { return this.armatures.find(rig => rig.id === this.activeId); }
    get bone() { return this.active?.bones.find(bone => bone.id === this.boneId); }
    get restBone() { const bone = this.displayedRig?.bones.find(item => item.id === this.boneId); return bone ? { ...bone, x: bone.x + (bone.poseX ?? 0), y: bone.y + (bone.poseY ?? 0), angle: bone.angle + bone.pose } : undefined; }
    get path() { const path = this.editor.selectedElement; return path instanceof Path ? path : undefined; }
    get binding() { return this.active?.bindings.find(binding => binding.pathId === this.path?.id); }
    get problem() {
        const svg = this.editor.selectedSVG, rig = this.active; if(!svg || !rig) return undefined;
        // Previews start only from valid artwork, which they temporarily replace.
        if(this.posePreview) return undefined;
        try { const evaluated = this.displayedRig!; return bindingProblem(svg,evaluated) ?? attachmentProblem(svg,evaluated); }
        catch(error) { return (error as Error).message; }
    }
    /** The Weights workspace takes over the inspector, as artwork edits there would invalidate bindings. */
    get ownsInspector() { return this.canEdit && this.visible && !!this.active && this.workspace === 'weights'; }
    get hidesArtworkHandles() { return this.canPose && this.visible && !!this.active && this.workspace !== 'rest'; }
    get canEdit() { return !!this.editor.selectedSVG && this.playback.mode === 'edit'; }
    get isAnimating() { return this.playback.mode === 'animate'; }
    get canPose() { return !!this.editor.selectedSVG && !this.playback.playing && (this.canEdit || (!!this.activeId && this.playback.allowsTarget(this.activeId))); }
    get canManipulate() { return this.workspace === 'pose' ? this.canPose : this.canEdit; }
    get animationContext() { return `${this.playback.mode}:${this.playback.contextKey}:${this.playback.currentTime}:${this.playback.revision}:${this.playback.playing}`; }
    constructor(public editor: EditorService, private playback: AnimationPlaybackService, private mutations: DocumentMutationService) {
        this.playback.contextChanging.subscribe(() => this.clearPosePreview());
    }

    select(id: string): void { this.activeId = id; this.boneId = this.active?.bones[0]?.id; this.visible = true; this.message = ''; }
    selectBone(rigId: string, boneId: string): void { this.select(rigId); this.boneId = boneId; }
    enterEdit(): void { this.playback.setMode('edit'); this.workspace = 'rest'; this.visible = true; }
    create(): void {
        this.enterEdit();
        const svg = this.editor.selectedSVG; if(!svg) return;
        this.editor.tools[0].restoreSelection();
        const rig = this.newRig({ x: svg.viewBoxX + svg.width / 2, y: svg.viewBoxY + svg.height / 2 });
        this.mutate(() => svg.rigs.armatures.push(rig), 'metadata'); this.select(rig.id); this.workspace = 'rest';
    }
    private newRig(at: { x: number; y: number }): Armature {
        const id = this.editor.ID, name = 'Armature ' + (this.armatures.length + 1);
        return { id, name, bones: [{ id, name, kind: 'point', parentId: null, x: at.x, y: at.y, angle: 0, length: 0, pose: 0 }], bindings: [] };
    }
    rename(name: string): void {
        if(this.active && this.canEdit && name.trim()) this.mutate(() => {
            this.active!.name = name.trim(); const root = this.active!.bones.find(bone => bone.id === this.active!.id); if(root) root.name = name.trim();
        }, 'metadata');
    }
    renameBone(name: string): void {
        const bone = this.bone; name = name.trim();
        if(!bone || !this.canEdit || !name || name === bone.name) return;
        if(bone.id === this.activeId) { this.rename(name); return; }
        this.mutate(() => bone.name = name, 'metadata');
    }
    canReparent(parentId: string | null): boolean {
        const rig = this.active, bone = this.bone;
        if(!rig || !bone || bone.id === rig.id || bone.parentId === parentId) return false;
        let parent = rig.bones.find(item => item.id === parentId);
        if(parentId && !parent) return false;
        while(parent) { if(parent.id === bone.id) return false; parent = rig.bones.find(item => item.id === parent!.parentId); }
        return true;
    }
    reparentBone(parentId: string | null): void {
        if(!this.canReparent(parentId)) return;
        this.editBone(this.parentLocalPlacement(this.boneId!,parentId));
    }
    drawBone(start: { x: number; y: number }, end: { x: number; y: number }, kind: 'bone' | 'point', parentId = this.boneId): boolean {
        const svg = this.editor.selectedSVG; if(!svg || !this.canEdit) return false;
        let rig = this.active;
        if(rig && this.displayedRig!.bones.some(hasBonePose)) { this.message = REST_REQUIRED; return false; }
        const fresh = !rig; rig ??= this.newRig(start);
        const parent = fresh ? rig.bones[0] : rig.bones.find(bone => bone.id === parentId);
        if(!fresh && parentId && !parent) return false;
        const inverse = parent ? invertMatrix(boneMatrices(rig, false).get(parent.id)!) : undefined;
        const a = inverse ? applyMatrix(inverse, start.x, start.y) : start, b = inverse ? applyMatrix(inverse, end.x, end.y) : end;
        const length = Math.hypot(b.x - a.x, b.y - a.y); if(kind === 'bone' && length < .001) return false;
        const bone: Bone = fresh && kind === 'point' ? rig.bones[0] : { id: this.editor.ID, name: (kind === 'point' ? 'Point ' : 'Bone ') + rig.bones.length, kind,
            parentId: parent?.id ?? null, x: a.x, y: a.y, angle: kind === 'point' ? 0 : Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, length: kind === 'point' ? 0 : length, pose: 0 };
        const target = rig;
        this.mutate(() => { if(fresh) svg.rigs.armatures.push(target); if(!target.bones.includes(bone)) target.bones.push(bone); }, 'metadata');
        this.selectBone(rig.id, bone.id); this.workspace = 'rest'; return true;
    }
    remove(): void {
        const svg = this.editor.selectedSVG, rig = this.active; if(!svg || !rig || !this.canEdit) return;
        if(rig.bindings.length || rig.attachments?.length) { this.message = 'Unbind paths and detach artwork before deleting the armature. Unbinding keeps the current artwork.'; return; }
        this.mutate(() => svg.rigs.armatures = svg.rigs.armatures.filter(item => item !== rig), 'metadata'); this.select(this.armatures[0]?.id ?? '');
    }
    addBone(child: boolean): void {
        const svg = this.editor.selectedSVG, rig = this.active, parent = child ? this.bone : undefined;
        if(!svg || !rig || !this.restEditable()) return;
        const bone: Bone = { id: this.editor.ID, name: `Bone ${rig.bones.length + 1}`, parentId: parent?.id ?? null,
            x: parent ? parent.length : svg.viewBoxX + svg.width / 2, y: parent ? 0 : svg.viewBoxY + svg.height / 2,
            angle: 0, length: Math.max(10, svg.width / 5), pose: 0 };
        this.mutate(() => rig.bones.push(bone), 'metadata'); this.boneId = bone.id;
    }
    editBone(changes: Partial<Omit<Bone, 'id' | 'pose'>>): void {
        const rig = this.active, bone = this.bone; if(!rig || !bone || !this.restEditable()) return;
        if(Object.entries(changes).every(([key, value]) => this.restBone?.[key as keyof Bone] === value)) return;
        const candidate = editableRestRig(this.editor.selectedSVG!, this.displayedRig!); if(candidate.constraints?.length) candidate.constraintsActive = false; Object.assign(candidate.bones.find(item => item.id === bone.id)!, changes);
        if(changes.length !== undefined) {
            candidate.bones.filter(child => child.parentId === bone.id && Math.abs(child.x - bone.length) < .001 && Math.abs(child.y) < .001)
                .forEach(child => child.x = changes.length!);
        }
        const constraintProblem = rigConstraintProblem(candidate);
        if(constraintProblem) { this.message = constraintProblem; return; }
        const before = restSkeleton(this.displayedRig!), broken = candidate.constraints?.find(item => constraintJointGap(candidate, item) && !constraintJointGap(before, item));
        const gap = broken && constraintJointGap(candidate, broken);
        if(broken && gap) { this.message = `${gap.lower} must stay on ${gap.upper}'s tip for ${broken.name}. Drag the joint on the canvas to move both bones together.`; return; }
        if(!validRigs({ version: 5, armatures: [candidate] })) { this.message = 'Use finite values, a positive length, and a parent outside this bone’s descendants.'; return; }
        this.commitRig(candidate);
        this.message = 'Rest setup updated. Artwork and weights preserved.';
    }
    /** Moves the joint a bone shares with its parent, or reconnects it onto the parent's tip when no point is given. */
    moveJoint(boneId: string, world?: { x: number; y: number }): boolean {
        const svg = this.editor.selectedSVG; if(!svg || !this.active || !this.restEditable()) return false;
        const candidate = moveBoneJoint(editableRestRig(svg, this.displayedRig!), boneId, world);
        if(!candidate) { this.message = 'Keep the joint away from both bones’ other ends.'; return false; }
        if(candidate.constraints?.length) candidate.constraintsActive = false;
        const constraintProblem = rigConstraintProblem(candidate);
        if(constraintProblem) { this.message = constraintProblem; return false; }
        if(!validRigs({ version: 5, armatures: [candidate] })) { this.message = 'Use finite values and positive bone lengths.'; return false; }
        this.commitRig(candidate); this.boneId = boneId;
        this.message = world ? 'Joint moved. Both bones stay connected; artwork stays in place.' : 'Joint reconnected. This chain can use IK again.';
        return true;
    }
    /** Whether a length bone starts on its length-bone parent's tip, so it can move as a joint or form an IK chain. */
    isJointConnected(boneId: string): boolean {
        const rig = this.displayedRig, bone = rig?.bones.find(item => item.id === boneId), parent = rig?.bones.find(item => item.id === bone?.parentId);
        return !!bone && !!parent && bone.kind !== 'point' && parent.kind !== 'point' && isConnectedBoneJoint(parent, bone);
    }
    private parentLocalPlacement(boneId: string,parentId: string | null) {
        const matrices = boneMatrices(this.displayedRig!), world = matrices.get(boneId)!;
        const local = parentId ? multiplyMatrix(invertMatrix(matrices.get(parentId)!),world) : world;
        return {parentId,x:local.e,y:local.f,angle:Math.atan2(local.b,local.a)*180/Math.PI};
    }
    private commitRig(candidate: Armature): void {
        const rig = this.active!;
        this.mutate(() => {
            rig.bones = candidate.bones.map(next => {
                const bone = rig.bones.find(item => item.id === next.id)!;
                delete bone.poseX; delete bone.poseY; return Object.assign(bone,next);
            });
            rig.bindings = candidate.bindings;
            if(candidate.attachments) rig.attachments = candidate.attachments; else delete rig.attachments;
            rig.constraints = candidate.constraints; rig.constraintsActive = candidate.constraintsActive;
            const root = rig.bones.find(bone => bone.id === rig.id); if(root) rig.name = root.name;
        }, 'metadata');
    }
    moveLayerRow(sourceRigId: string, sourceId: string | null, targetRigId: string, targetId: string | null, position: RowDropPosition): void {
        const svg = this.editor.selectedSVG; if(!svg || !this.canEdit) return;
        if(sourceId === null) {
            if(targetId !== null || sourceRigId === targetRigId || position === 'inside') return;
            const source = this.armatures.find(rig => rig.id === sourceRigId), target = this.armatures.find(rig => rig.id === targetRigId);
            if(!source || !target) return;
            this.mutate(() => { const list = svg.rigs.armatures.filter(rig => rig !== source); list.splice(list.indexOf(target)+(position === 'after' ? 1 : 0),0,source); svg.rigs.armatures = list; },'metadata'); return;
        }
        if(sourceRigId !== targetRigId || sourceId === targetId) return;
        this.selectBone(sourceRigId,sourceId);
        const rig = this.active, bone = this.bone; if(!rig || !bone) return;
        const target = rig.bones.find(item => item.id === targetId);
        const parentId = targetId === null ? rig.bones.find(item => item.id === rig.id)?.id ?? null : position === 'inside' ? targetId : target?.parentId ?? null;
        if(targetId && !target) return;
        const reparent = bone.parentId !== parentId;
        if(reparent && (!this.canReparent(parentId) || !this.restEditable())) return;
        let ancestor = target;
        while(ancestor) { if(ancestor.id === bone.id) return; ancestor = rig.bones.find(item => item.id === ancestor!.parentId); }
        const candidate = reparent ? editableRestRig(svg,this.displayedRig!) : structuredClone(rig);
        if(reparent && candidate.constraints?.length) candidate.constraintsActive = false;
        const moving = candidate.bones.find(item => item.id === sourceId)!;
        if(reparent) {
            Object.assign(moving,this.parentLocalPlacement(sourceId,parentId));
        }
        candidate.bones = candidate.bones.filter(item => item !== moving);
        const index = position === 'inside' || !target ? candidate.bones.length : candidate.bones.findIndex(item => item.id === target.id)+(position === 'after' ? 1 : 0);
        candidate.bones.splice(index,0,moving);
        const constraintProblem = rigConstraintProblem(candidate);
        if(constraintProblem) { this.message = constraintProblem; return; }
        if(validRigs({version:5,armatures:[candidate]})) this.commitRig(candidate);
    }
    deleteBone(): void {
        const rig = this.active, bone = this.bone; if(!rig || !bone || !this.restEditable()) return;
        if(rig.constraints?.some(item => [item.upperBoneId,item.lowerBoneId,item.targetBoneId].includes(bone.id))) { this.message = 'Delete this bone’s IK constraint before deleting the bone.'; return; }
        if(rig.bindings.some(link => link.boneIds?.includes(bone.id) || link.points.some(point => point.lockedBoneIds?.includes(bone.id) || point.weights.some(weight => weight.boneId === bone.id))) || rig.attachments?.some(link => link.boneId === bone.id)) { this.message = 'Unbind or detach this bone before deleting it.'; return; }
        if(rig.bones.some(item => item.parentId === bone.id)) { this.message = 'Reparent or remove child bones first.'; return; }
        this.mutate(() => rig.bones = rig.bones.filter(item => item !== bone), 'metadata'); this.boneId = rig.bones[0]?.id;
    }
    setPose(angle: number, boneId = this.boneId): void {
        const candidate = this.fkCandidate(boneId, { pose: angle }); if(candidate) this.commitAuthoredPose(candidate);
    }
    /** Shows an FK rotation or body offset on the live artwork until the gesture commits or cancels. */
    previewFK(boneId: string, changes: Pick<Bone, 'pose'> | Required<Pick<Bone, 'poseX' | 'poseY'>>): Armature | undefined {
        const candidate = this.fkCandidate(boneId, changes);
        if(candidate) return this.previewPose(candidate);
        this.clearPosePreview(); return undefined;
    }
    private fkCandidate(boneId: string | undefined, changes: Partial<Pick<Bone, 'pose' | 'poseX' | 'poseY'>>): Armature | undefined {
        const rig = this.active, bone = rig?.bones.find(item => item.id === boneId);
        if(!rig || !bone || !this.canPose || !Object.values(changes).every(Number.isFinite) || !this.readyToPose()) return;
        const driver = this.isAnimating || changes.pose !== undefined ? this.drivingConstraint(bone.id) : undefined;
        if(driver) { this.message = `${bone.name} follows ${driver.name}. Drag ${rig.bones.find(item => item.id === driver.targetBoneId)?.name ?? 'its target'} to pose it, or turn the constraint off to rotate it directly.`; return; }
        const candidate = structuredClone(rig); Object.assign(candidate.bones.find(item => item.id === bone.id)!, changes);
        if(candidate.constraints?.length) candidate.constraintsActive = true;
        return candidate;
    }
    previewIK(target: {x:number;y:number}): Armature | undefined {
        if(!this.active || !this.boneId || !this.canPose || !this.readyToPose()) { this.clearPosePreview(); return; }
        const candidate = this.ikCandidate(target);
        if(candidate) return this.previewPose(candidate);
        this.clearPosePreview(); return undefined;
    }
    /** Weight previews only move artwork on a posed rig; at rest every weighting leaves points in place. */
    previewWeights(updates: readonly WeightUpdate[]): void {
        const rig = this.active;
        if(!rig || !updates.length || !this.displayedRig?.bones.some(hasBonePose)) { this.clearPosePreview(); return; }
        try { this.previewPose(assignWeightUpdates(rig, updates)); }
        catch { this.clearPosePreview(); }
    }
    private previewPose(candidate: Armature): Armature | undefined {
        this.clearPosePreview();
        const svg = this.editor.selectedSVG, rig = this.active;
        if(!svg || !rig || !this.canPose || !this.readyToPose()) return;
        const evaluated = this.evaluatePose(candidate); if(!evaluated) return;
        const paths = evaluated.bindings.flatMap(binding => { const path = findAnimationTarget(svg.elements, binding.pathId); return path instanceof Path ? [path] : []; });
        const geometry = paths.map(path => ({ path, snapshot: captureGeometrySnapshot(path) }));
        const transforms = (evaluated.attachments ?? []).flatMap(link => { const element = findAnimationTarget(svg.elements, link.elementId); return element ? [{ element, transform: { ...element.transform } }] : []; });
        applyRigPose(svg, evaluated); applyAttachments(svg, evaluated);
        this.livePose = { svg, rigId: rig.id, rig: evaluated, restore: () => {
            geometry.forEach(({ path, snapshot }) => restoreGeometrySnapshot(path, snapshot));
            transforms.forEach(({ element, transform }) => element.transform = transform);
        } };
        return evaluated;
    }
    clearPosePreview(): void { const live = this.livePose; this.livePose = undefined; live?.restore(); }
    setIKTarget(target: {x:number;y:number}): void {
        if(!this.active || !this.canPose || !this.readyToPose()) return;
        const candidate = this.ikCandidate(target); if(candidate) this.commitAuthoredPose(candidate);
    }
    flipIKBend(): void {
        const constraint = this.activeIKConstraint;
        if(constraint) { this.updateIKConstraint(constraint.id,{bend:constraint.bend === 1 ? -1 : 1}); return; }
        const target = this.ikEndpoint; if(!target) return;
        this.ikBends.set(this.activeId + ':' + this.boneId,this.ikBend === 1 ? -1 : 1);
        this.setIKTarget(target);
    }
    setPosePosition(x: number, y: number, boneId = this.boneId): void {
        const candidate = this.fkCandidate(boneId, { poseX: x, poseY: y }); if(candidate) this.commitAuthoredPose(candidate);
    }
    /** In Pose, enabled IK keeps reaching for its targets after a reset; elsewhere the reset is the rest setup. */
    resetPose(toRest = this.workspace !== 'pose'): boolean {
        const rig = this.active, svg = this.editor.selectedSVG; if(!rig || !svg || !this.canPose || (toRest && this.isAnimating) || !this.readyToPose()) return false;
        const candidate = structuredClone(rig);
        candidate.bones.forEach(bone => { bone.pose = 0; delete bone.poseX; delete bone.poseY; });
        if(candidate.constraints?.length) candidate.constraintsActive = !toRest;
        return this.commitAuthoredPose(candidate);
    }
    /** Clears every pose and pauses IK until the next pose edit, so artwork can be bound or bones drawn. */
    resetToRest(): boolean { return this.resetPose(true); }
    /** Nothing, neither authored offsets nor IK, bends the skeleton away from its rest setup. */
    get atRest(): boolean { return !this.displayedRig?.bones.some(hasBonePose); }
    get restBlocked(): boolean { return this.message === REST_REQUIRED && !this.atRest; }
    /** Preflight the complete evaluated pose before writing either bones or artwork. */
    private evaluatePose(candidate: Armature): Armature | undefined {
        try {
            const evaluated = evaluateRigConstraints(candidate); attachmentTransforms(evaluated);
            for(const binding of evaluated.bindings) for(const point of deformBinding(evaluated,binding).values()) {
                if(!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('This pose exceeds the supported coordinate range.');
            }
            return evaluated;
        }
        catch(error) { this.message = (error as Error).message; return; }
    }
    private mutate<T>(change: () => T, domain?: MutationDomain): T { this.clearPosePreview(); return this.mutations.mutate(change, domain); }
    /** Canvas pose gestures key authored offsets; the setup and solved IK angles stay untouched. */
    private commitAuthoredPose(candidate: Armature, forceBoneId?: string): boolean {
        if(!this.isAnimating) return this.commitPose(candidate);
        this.clearPosePreview();
        const rig = this.active;
        if(!rig || !this.canPose || !this.evaluatePose(candidate)) return false;
        const fields: RigAnimationField[] = ['pose', 'poseX', 'poseY'];
        const updates = candidate.bones.flatMap(bone => {
            if(this.drivingConstraint(bone.id)) return [];
            const original = rig.bones.find(item => item.id === bone.id);
            return fields.filter(field => original && (bone.id === forceBoneId || (bone[field] ?? 0) !== (original[field] ?? 0)))
                .map(field => ({property:rigAnimationProperty(bone.id,field),value:bone[field] ?? 0}));
        });
        if(!updates.length) return false;
        const conflict = updates.map(update => documentRigChannelProblem(this.editor.selectedSVG!,rig.id,update.property)).find(Boolean);
        if(conflict) { this.message = conflict; return false; }
        this.mutate(() => updates.forEach(update => this.playback.upsertTargetKeyframe(rig.id,update.property,'number',update.value)), 'animation');
        this.message = this.playback.contextMessage;
        return !this.message;
    }
    keyPose(): void {
        if(this.active && this.boneId && this.isAnimating) this.commitAuthoredPose(structuredClone(this.active),this.boneId);
    }
    private commitPose(candidate: Armature, pinOrigins: AnyElement[] = []): boolean {
        this.clearPosePreview();
        const svg = this.editor.selectedSVG, rig = this.active, evaluated = this.evaluatePose(candidate);
        if(!svg || !rig || !evaluated) return false;
        this.mutate(() => {
            pinOrigins.forEach(pinTransformOrigin);
            rig.bones = candidate.bones.map(next => {
                const existing = rig.bones.find(bone => bone.id === next.id);
                if(!existing) return next;
                delete existing.poseX; delete existing.poseY; return Object.assign(existing,next);
            });
            rig.bindings = candidate.bindings;
            if(candidate.attachments) rig.attachments = candidate.attachments; else delete rig.attachments;
            if(candidate.constraints) rig.constraints = candidate.constraints; else delete rig.constraints;
            if(candidate.constraintsActive !== undefined) rig.constraintsActive = candidate.constraintsActive; else delete rig.constraintsActive;
            applyRigPose(svg,evaluated); applyAttachments(svg,evaluated);
        });
        this.message = ''; return true;
    }
    private ikCandidate(target: {x:number;y:number}): Armature | undefined {
        if(!this.active || ![target.x,target.y].every(Number.isFinite)) return;
        const constraint = this.activeIKConstraint;
        if(!constraint) {
            const displayed = this.displayedRig!, chain = this.boneId && twoBoneChain(displayed,this.boneId);
            if(!chain) return;
            const solved = solveTwoBoneIK(displayed,chain.lower.id,target,this.ikBend); if(!solved) return;
            const candidate = structuredClone(this.active);
            for(const id of [chain.upper.id,chain.lower.id]) candidate.bones.find(bone => bone.id === id)!.pose = solved.bones.find(bone => bone.id === id)!.pose;
            if(candidate.constraints?.length) candidate.constraintsActive = true;
            return candidate;
        }
        const candidate = structuredClone(this.active); candidate.constraintsActive = true;
        this.placeTarget(candidate,constraint.targetBoneId,target);
        return candidate;
    }
    private placeTarget(candidate: Armature, id: string, world: {x:number;y:number}): void {
        const bone = candidate.bones.find(item => item.id === id)!;
        const matrix = bone.parentId ? boneMatrices(this.displayedRig!).get(bone.parentId) : undefined;
        const local = matrix ? applyMatrix(invertMatrix(matrix),world.x,world.y) : world;
        bone.poseX = local.x-bone.x; bone.poseY = local.y-bone.y;
    }
    private descendsFrom(rig: Armature,id: string,ancestorId: string): boolean {
        let bone = rig.bones.find(item => item.id === id);
        while(bone) { if(bone.id === ancestorId) return true; bone = rig.bones.find(item => item.id === bone!.parentId); }
        return false;
    }
    createIKConstraint(targetBoneId: string, name?: string): boolean {
        const rig = this.active, chain = this.ikChain, tip = this.ikEndpoint;
        if(!rig || !chain || !tip || !this.canEdit || !this.readyToPose()) return false;
        const candidate = structuredClone(this.workspace === 'pose' ? rig : this.displayedRig!);
        if(!targetBoneId) {
            const root = candidate.bones.find(bone => bone.id === rig.id && bone.kind === 'point' && !this.descendsFrom(rig,bone.id,chain.upper.id));
            const matrix = root ? boneMatrices(this.displayedRig!).get(root.id) : undefined;
            const local = matrix ? applyMatrix(invertMatrix(matrix),tip.x,tip.y) : tip;
            targetBoneId = this.editor.ID;
            candidate.bones.push({id:targetBoneId,name:chain.lower.name+' target',kind:'point',parentId:root?.id ?? null,x:local.x,y:local.y,angle:0,length:0,pose:0});
        }
        const constraint: TwoBoneIKConstraint = {id:this.editor.ID,name:name?.trim() || chain.lower.name+' IK',type:'two-bone-ik',enabled:true,upperBoneId:chain.upper.id,lowerBoneId:chain.lower.id,targetBoneId,bend:chainBend(this.displayedRig!,chain.lower.id)};
        (candidate.constraints ??= []).push(constraint);
        candidate.constraintsActive = this.workspace === 'pose';
        if(!this.commitPose(candidate)) return false;
        this.selectedIKConstraintId = constraint.id; this.poseMethod = 'ik';
        this.message = this.workspace === 'pose' ? 'IK target linked.' : 'IK target linked. Pose solves toward the target; Match target to tip keeps the current setup.';
        return true;
    }
    updateIKConstraint(id: string, changes: Partial<Pick<TwoBoneIKConstraint,'name'|'enabled'|'targetBoneId'|'bend'>>): boolean {
        if(!this.active || !this.canEdit || !this.readyToPose()) return false;
        const poseChange = changes.enabled !== undefined || changes.targetBoneId !== undefined || changes.bend !== undefined;
        const candidate = structuredClone(poseChange && this.workspace === 'rest' ? this.displayedRig! : this.active), constraint = candidate.constraints?.find(item => item.id === id); if(!constraint) return false;
        if(poseChange) candidate.constraintsActive = this.workspace !== 'rest';
        if(changes.name !== undefined) { changes = {...changes,name:changes.name.trim()}; if(!changes.name) return false; }
        Object.assign(constraint,changes); return this.commitPose(candidate);
    }
    removeIKConstraint(id: string): void {
        if(!this.active || !this.canEdit || !this.readyToPose()) return;
        const candidate = structuredClone(this.active), evaluated = this.displayedRig!;
        const constraint = candidate.constraints?.find(item => item.id === id); if(!constraint) return;
        // Keep the visible limb as its authored FK pose when unlinking.
        for(const boneId of [constraint.upperBoneId,constraint.lowerBoneId]) candidate.bones.find(item => item.id === boneId)!.pose = evaluated.bones.find(item => item.id === boneId)!.pose;
        candidate.constraints = candidate.constraints!.filter(item => item.id !== id);
        this.commitPose(candidate);
    }
    matchIKTarget(id: string): void {
        if(!this.active || !this.canEdit || !this.readyToPose()) return;
        const constraint = this.active.constraints?.find(item => item.id === id), displayed = this.displayedRig!; if(!constraint) return;
        const lower = displayed.bones.find(item => item.id === constraint.lowerBoneId)!;
        const world = applyMatrix(boneMatrices(displayed).get(lower.id)!,lower.length,0);
        if(this.workspace === 'rest') {
            const candidate = editableRestRig(this.editor.selectedSVG!,displayed); candidate.constraintsActive = false;
            this.placeTarget(candidate,constraint.targetBoneId,world);
            const target = candidate.bones.find(bone => bone.id === constraint.targetBoneId)!;
            target.x += target.poseX ?? 0; target.y += target.poseY ?? 0; delete target.poseX; delete target.poseY;
            this.commitRig(candidate); this.message = 'Target matched to the tip in the rest setup.';
        } else {
            const candidate = structuredClone(this.active); candidate.constraintsActive = true;
            this.placeTarget(candidate,constraint.targetBoneId,world); this.commitPose(candidate);
        }
    }
    bind(path = this.path, boneIds = this.boneId ? [this.boneId] : [], restrictInfluences = false): void {
        if(path) this.bindGroup(path,boneIds,restrictInfluences);
        else this.message = 'Select a path or group and at least one bone first.';
    }
    bindGroup(target: AnyElement, boneIds: string[], restrictInfluences = true): boolean {
        const svg = this.editor.selectedSVG, rig = this.active, ids = [...new Set(boneIds)];
        if(!svg || !rig || !this.canEdit || !ids.length || ids.some(id => !rig.bones.some(bone => bone.id === id))) { this.message = 'Select a path or group and at least one valid bone first.'; return false; }
        if(this.displayedRig!.bones.some(hasBonePose)) { this.message = REST_REQUIRED; return false; }
        const problem = weightScopeProblem(svg,target); if(problem) { this.message = problem; return false; }
        if(this.overlapsLink(target)) { this.message = 'This artwork or a descendant already has a rig link. Unbind or detach it before binding the complete group.'; return false; }
        const paths = nativeWeightPaths(target), linked = addPathBindings(svg,rig,target,ids,restrictInfluences);
        if(!validRigs({version:5,armatures:[linked]})) { this.message = 'The binding contains invalid point weights.'; return false; }
        this.mutate(() => {
            const ancestors = new Set(paths.flatMap(path => findElementChain(svg.elements,path) ?? []));
            ancestors.forEach(pinTransformOrigin); rig.bindings = linked.bindings;
        });
        this.workspace = 'weights'; this.message = `Bound ${paths.length} path${paths.length === 1 ? '' : 's'} with equal weights. Exactly overlapping anchors share weights; clipping and draw order are preserved.`;
        return true;
    }
    assignmentProblem(target: AnyElement, boneIds: readonly string[]): string | undefined {
        const svg = this.editor.selectedSVG, rig = this.active;
        if(!svg || !rig || !this.canEdit) return 'Select an armature in Edit mode.';
        try {
            if(boneIds.length && this.problem) return this.problem;
            const {candidate} = prepareArtworkAssignment(svg,rig,target,boneIds);
            if(!validRigs({version:5,armatures:[candidate]})) return 'These bones are not permitted by every shared point. Edit the shared group first.';
            return undefined;
        } catch(error) { return (error as Error).message; }
    }
    assignArtworkBones(target: AnyElement, boneIds: readonly string[]): boolean {
        const problem = this.assignmentProblem(target,boneIds);
        if(problem) { this.message = problem; return false; }
        const rig = this.active!, {candidate,pinOrigins,unbound} = prepareArtworkAssignment(this.editor.selectedSVG!,rig,target,boneIds);
        if(unbound) this.mutate(() => {
            rig.bindings = candidate.bindings;
            if(candidate.attachments) rig.attachments = candidate.attachments; else delete rig.attachments;
        },'metadata');
        else if(!this.commitPose(candidate,pinOrigins)) return false;
        this.workspace = 'weights';
        this.message = unbound ? 'Unbound. Current artwork preserved.' : boneIds.length === 1 ? 'One assigned bone: rigid binding.' : 'Bones assigned. Refine point weights below.';
        return true;
    }
    unbind(pathId: string): void {
        const pathIds = this.active?.bindings.filter(binding => binding.pathId === pathId || binding.scopeId === pathId).map(binding => binding.pathId) ?? [];
        this.unbindScope(pathIds);
    }
    unbindScope(pathIds: string[]): boolean {
        const rig = this.active; if(!rig || !this.canEdit || !pathIds.length) return false;
        const candidate = detachBindingWeights(rig,pathIds);
        if(!validRigs({version:5,armatures:[candidate]})) { this.message = 'Repair shared point links before unbinding.'; return false; }
        this.mutate(() => rig.bindings = candidate.bindings, 'metadata');
        this.message = 'Unbound. The current artwork is preserved; reset pose before binding again.';
        return true;
    }
    setWeight(anchorId: string, boneId: string, weight: number, pathId = this.path?.id): void {
        if(pathId) this.setPointWeight({pathId,pointId:anchorId},boneId,weight);
    }
    setPointWeight(ref: WeightPointRef, boneId: string, weight: number): boolean {
        const updates = this.previewPointWeights([ref],boneId,weight);
        return !!updates?.length && this.applyWeightUpdates(updates);
    }
    previewPointWeights(refs: readonly WeightPointRef[], boneId: string, value: number): WeightUpdate[] | undefined {
        return this.weightPreview(rig => refs.flatMap(ref => {
            const state = pointWeightState(rig,ref);
            if(state.rigid || !state.boneIds.includes(boneId) || state.lockedBoneIds.includes(boneId)) return [];
            return [{...state.ref,weights:editWeightInfluence(state.weights,boneId,value,state.boneIds,state.lockedBoneIds)}];
        }));
    }
    previewAutoWeights(refs: readonly WeightPointRef[]): WeightUpdate[] | undefined {
        return this.weightPreview(rig => automaticWeightUpdates(rig,refs.filter(ref => !pointWeightState(rig,ref).rigid)));
    }
    private weightPreview(build: (rig: Armature) => WeightUpdate[]): WeightUpdate[] | undefined {
        if(!this.active || !this.canEdit || !this.readyToPose()) return;
        try { return build(this.active); }
        catch(error) { this.message = (error as Error).message; return; }
    }
    setWeightLocks(refs: readonly WeightPointRef[], boneId: string, locked: boolean): boolean {
        return this.weightCommand(rig => {
            const candidate = structuredClone(rig);
            for(const ref of refs) {
                const state = pointWeightState(candidate,ref);
                if(!state.boneIds.includes(boneId)) continue;
                const point = candidate.bindings.find(binding => binding.pathId === state.ref.pathId)!.points.find(point => point.id === state.ref.pointId)!;
                const ids = new Set(state.lockedBoneIds); if(locked) ids.add(boneId); else ids.delete(boneId);
                if(ids.size) point.lockedBoneIds = [...ids]; else delete point.lockedBoneIds;
            }
            return candidate;
        });
    }
    clearPointWeights(refs: readonly WeightPointRef[]): boolean {
        return this.weightCommand(rig => {
            const updates = refs.map(ref => {
                const state = pointWeightState(rig,ref);
                if(state.rigid) throw new Error('Assign another bone before clearing point weights.');
                if(state.weights.some(weight => weight.weight > 0 && state.lockedBoneIds.includes(weight.boneId))) throw new Error('Unlock positive weights before clearing this selection.');
                return {...state.ref,weights:[]};
            });
            return assignWeightUpdates(rig,updates);
        });
    }
    applyWeightUpdates(updates: readonly WeightUpdate[]): boolean {
        if(!this.active || !this.canEdit || !this.readyToPose()) return false;
        try {
            for(const update of updates) {
                const state = pointWeightState(this.active,update);
                if(state.rigid && (update.weights.length !== 1 || update.weights[0].boneId !== state.weights[0].boneId || update.weights[0].weight !== 1)) throw new Error('Assign another bone before editing point weights.');
            }
            return this.commitWeightCandidate(assignWeightUpdates(this.active,updates));
        }
        catch(error) { this.message = (error as Error).message; return false; }
    }
    setHandleIndependent(ref: WeightPointRef, independent: boolean): boolean {
        return this.weightCommand(rig => setPointIndependent(rig,ref.pathId,ref.pointId,independent));
    }
    linkCoincidentWeights(pathIds: string[]): boolean {
        const result = this.weightCommand(rig => linkCoincidentWeights(rig,pathIds));
        if(result) this.message = 'Exactly overlapping rest points now share weights. The first point’s weights are used for each joined group.';
        return result;
    }
    unlinkPointWeights(ref: WeightPointRef): boolean {
        return this.weightCommand(rig => unlinkPointWeights(rig,ref.pathId,ref.pointId));
    }
    private weightCommand(change: (rig: Armature) => Armature): boolean {
        if(!this.active || !this.canEdit || !this.readyToPose()) return false;
        try { return this.commitWeightCandidate(change(this.active)); }
        catch(error) { this.message = (error as Error).message; return false; }
    }
    private commitWeightCandidate(candidate: Armature): boolean {
        if(!validRigs({version:5,armatures:[candidate]})) { this.message = 'Weights must use influences allowed by every linked path. Edit influences or unlink this weight group first.'; return false; }
        return this.commitPose(candidate);
    }
    setBindingInfluences(pathId: string, boneIds: string[]): boolean {
        return this.setScopeInfluences([pathId],boneIds);
    }
    setScopeInfluences(pathIds: string[], boneIds: string[]): boolean {
        const result = this.weightCommand(rig => changeScopeInfluences(rig,pathIds,boneIds));
        if(result) this.message = 'Influences updated. New bones start at zero. Shared groups update together; other points keep their weights.';
        return result;
    }
    attach(element: AnyElement, boneId: string): boolean {
        const svg = this.editor.selectedSVG, rig = this.active;
        if(!svg || !rig || !this.canEdit || !rig.bones.some(bone => bone.id === boneId)) return false;
        if(this.displayedRig!.bones.some(hasBonePose)) { this.message = REST_REQUIRED; return false; }
        const chain = findElementChain(svg.elements, element);
        if(!chain || this.overlapsLink(element)) { this.message = 'This artwork or its ancestor/descendant already has a rig link. Detach or unbind that link first.'; return false; }
        if(!isGeometryVisible(chain) || chain.some(item => item.locked || item.motion.pathId)) { this.message = 'Show and unlock artwork, and remove motion-path constraints before attaching.'; return false; }
        if(allAnimationDocuments(svg.animation).some(animation => animation.tracks.some(track => chain.some(item => item.id === track.targetId)))) { this.message = 'Attach artwork without existing animation on it or its ancestors.'; return false; }
        const matrix = parentMatrixFor(svg.elements, element);
        if(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < .000001) { this.message = 'Restore a nonzero parent scale before attaching.'; return false; }
        this.mutate(() => {
            chain.forEach(pinTransformOrigin);
            (rig.attachments ??= []).push({ elementId: element.id, boneId, parentMatrix: parentMatrixFor(svg.elements, element), worldMatrix: combinedMotionAdjustedMatrixFor(svg, element), restTransform: { ...element.transform } });
        });
        this.message = 'Attached. Artwork stays in its existing draw position.'; return true;
    }
    detach(id: string): void {
        if(!this.active || !this.canEdit) return;
        this.mutate(() => this.active!.attachments = this.active!.attachments?.filter(link => link.elementId !== id), 'metadata');
        this.message = 'Detached; current artwork and draw order preserved.';
    }
    linkFor(id: string) {
        for(const rig of this.armatures) {
            const attachment = rig.attachments?.find(link => link.elementId === id), bindings = rig.bindings.filter(link => link.pathId === id || link.scopeId === id);
            if(attachment) return { rigId: rig.id, boneId: attachment.boneId, label: 'Attached: ' + rig.bones.find(bone => bone.id === attachment.boneId)?.name };
            if(bindings.length) { const ids = [...new Set(bindings.flatMap(binding => binding.boneIds ?? binding.points.flatMap(point => effectivePointWeights(rig,binding,point).map(weight => weight.boneId))))]; return { rigId: rig.id, boneId: ids[0] ?? rig.bones[0]?.id, label: 'Bound: ' + ids.length + (ids.length === 1 ? ' bone' : ' bones') + (bindings.length > 1 ? ' · ' + bindings.length + ' paths' : '') }; }
        }
        return undefined;
    }
    private overlapsLink(element: AnyElement): boolean {
        const svg = this.editor.selectedSVG!;
        const ids = this.armatures.flatMap(rig => [...rig.bindings.map(binding => binding.pathId), ...(rig.attachments ?? []).map(link => link.elementId)]);
        const chain = findElementChain(svg.elements, element) ?? [];
        return ids.some(id => {
            if(chain.some(item => item.id === id)) return true;
            const target = findAnimationTarget(svg.elements, id); return !!target && !!findElementChain(svg.elements, target)?.includes(element);
        });
    }
    private readyToPose(): boolean {
        try { this.message = this.problem ?? ''; return !this.message; }
        catch(error) { this.message = (error as Error).message; return false; }
    }
    private restEditable(): boolean {
        if(!this.canEdit || !this.active) return false;
        this.message = this.problem ?? '';
        return !this.message;
    }
}
