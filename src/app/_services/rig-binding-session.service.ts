import { Injectable } from '@angular/core';
import { RigEditingService } from './rig-editing.service';
import { DocumentMutationService } from './document-mutation.service';
import { findAnimationTarget } from '../editor/objects/animation-targets';
import { Path } from '../editor/objects/elements/path.object';
import { AnyElement } from '../editor/objects/svg.object';
import { boneWeightColor } from '../editor/rig-weight-colors';
import { Group } from '../editor/objects/elements/group.object';
import { BoundPoint, PathBinding, WeightPointRef, effectivePointWeights, weightOwner } from '../editor/objects/armature';
import { weightMembers } from '../editor/rig-point-weights';
import { nativeWeightPaths } from '../editor/rig-artwork-scope';
import { WeightUpdate } from '../editor/rig-weight-commands';
import { bindingBoneIds, bindingWeightMode, pointWeightState } from '../editor/rig-weight-editing';

interface ArtworkScope { targetId: string; documentId: string; rigId?: string; }
interface LinkPicking extends ArtworkScope { revision: number; bones: string[]; initialBones: readonly string[]; editing: boolean; workspace: RigEditingService['workspace']; tool: unknown; }
type PreviewKind = 'numeric' | 'auto' | 'brush';
interface WeightPreview { kind: PreviewKind; updates: readonly WeightUpdate[]; revision: number; scope: string; selection: string; workspace: string; tool: unknown; }
export interface WeightPointEntry extends WeightPointRef { point: BoundPoint; binding: PathBinding; pathName: string; label: string; }
export type WeightPaintMode = 'select' | 'add' | 'subtract' | 'set' | 'smooth';
/** One list drives the tool bar, the canvas HUD and the 1–5 shortcuts. */
export const WEIGHT_TOOLS: readonly { mode: WeightPaintMode; label: string; key: string; hint: string }[] = [
    { mode: 'select', label: 'Select', key: '1', hint: 'Click points or drag a box; Shift adds' },
    { mode: 'add', label: 'Add', key: '2', hint: 'Raise the active bone’s weight' },
    { mode: 'subtract', label: 'Subtract', key: '3', hint: 'Lower the active bone’s weight' },
    { mode: 'set', label: 'Set', key: '4', hint: 'Paint toward an exact value' },
    { mode: 'smooth', label: 'Smooth', key: '5', hint: 'Blend with nearby points' },
];
export type BrushSetting = 'brushRadius' | 'brushStrength' | 'brushValue';
export const BRUSH_LIMITS: Readonly<Record<BrushSetting, readonly [number, number]>> = { brushRadius: [4, 300], brushStrength: [0, 1], brushValue: [0, 1] };

/** Owns the pinned artwork scope and cancellable bone picking; commands remain with RigEditingService. */
@Injectable()
export class RigBindingSessionService {
    pending?: LinkPicking;
    scopeMode: 'artwork' | 'bone' = 'artwork';
    pointRef?: WeightPointRef;
    controlledOnly = false;
    paintMode: WeightPaintMode = 'select';
    brushRadius = 45;
    brushStrength = .35;
    brushValue = 1;
    /** Mix colors points by every bone's share; Heat shows the active bone from blue (0%) to red (100%). */
    weightDisplay: 'mix' | 'heat' = 'mix';
    selectedRefs: WeightPointRef[] = [];
    private preview?: WeightPreview;
    private scope?: ArtworkScope;
    private boneDocumentId?: string;
    private boneScopeElementId?: string;
    constructor(public rigs: RigEditingService, private mutations: DocumentMutationService) {}

    get target(): AnyElement | undefined {
        const svg = this.rigs.editor.selectedSVG, scope = this.pending ?? this.scope;
        if(scope) return svg?.id === scope.documentId ? findAnimationTarget(svg.elements, scope.targetId) : undefined;
        return this.rigs.editor.selectedElement;
    }
    /** Binding needs artwork; only Weights also offers bone-first editing without it. */
    get showsBindingControls(): boolean { return !!this.target || (!!this.rigs.bone && this.rigs.workspace === 'weights'); }
    get path(): Path | undefined { const target = this.target; return target instanceof Path ? target : undefined; }
    get paths(): Path[] { const target = this.target; return target ? nativeWeightPaths(target) : []; }
    get isGroup(): boolean { return this.target instanceof Group; }
    get canWeight(): boolean { return this.target instanceof Path || this.target instanceof Group; }
    private get artworkRigs() { const ids = new Set(this.paths.map(path => path.id)); return this.rigs.armatures.filter(rig => rig.bindings.some(binding => ids.has(binding.pathId))); }
    get mixedArmatures(): boolean { return this.scopeMode === 'artwork' && this.artworkRigs.length > 1; }
    get weightRig() { if(this.scopeMode === 'bone') return this.rigs.active; const rigs = this.artworkRigs; return rigs.length === 1 ? rigs[0] : undefined; }
    get bindings(): PathBinding[] {
        const rig = this.weightRig;
        if(!rig) return [];
        if(this.scopeMode === 'bone') return rig.bindings.filter(binding => !binding.boneIds || binding.boneIds.includes(this.rigs.boneId ?? ''));
        const ids = new Set(this.paths.map(path => path.id));
        return rig.bindings.filter(binding => ids.has(binding.pathId));
    }
    get binding(): PathBinding | undefined { return this.bindings.find(binding => binding.pathId === this.pointRef?.pathId) ?? this.bindings[0]; }
    get scopeBindings(): { path: Path; binding: PathBinding }[] {
        const elements = this.rigs.editor.selectedSVG?.elements ?? [];
        return this.bindings.flatMap(binding => { const path = findAnimationTarget(elements, binding.pathId); return path instanceof Path ? [{ path, binding }] : []; });
    }
    get scopeKey(): string { return [this.rigs.editor.selectedSVG?.id, this.scopeMode, this.target?.id, this.weightRig?.id, this.rigs.boneId, this.controlledOnly, ...this.bindings.map(binding => binding.pathId)].join(':'); }
    get selectionKey(): string { return this.selectedRefs.map(ref => this.pointKey(ref)).sort().join(':'); }
    get editContextKey(): string { return [this.mutations.revision, this.scopeKey, this.selectionKey, this.rigs.workspace].join('|'); }
    get selectedCount(): number { return this.selectedRefs.length; }
    get previewKind(): PreviewKind | undefined { return this.preview?.kind; }
    get previewUpdates(): readonly WeightUpdate[] { return this.preview?.updates ?? []; }
    get assignedBoneIds(): string[] { return this.attachment ? [this.attachment.boneId] : this.weightRig ? [...new Set(this.bindings.flatMap(binding => bindingBoneIds(this.weightRig!, binding)))] : []; }
    get assignmentCount(): number { return this.pending?.bones.length ?? this.assignedBoneIds.length; }
    get assignmentRig() { return this.pending?.rigId ? this.rigs.armatures.find(rig => rig.id === this.pending!.rigId) : this.weightRig ?? this.attachmentRig; }
    get assignmentLabel(): string { return this.assignmentCount === 0 ? 'Unbound' : this.assignmentCount === 1 ? 'Rigid' : 'Weighted'; }
    /** Applying an unchanged pick set only closes picking; it never rewrites the binding. */
    get assignmentChanged(): boolean { const pending = this.pending; return !!pending && (pending.bones.length !== pending.initialBones.length || pending.bones.some(id => !pending.initialBones.includes(id))); }
    get assignmentProblem(): string | undefined { return this.pending && this.target ? this.rigs.assignmentProblem(this.target, this.pending.bones) : undefined; }
    get bindingLabel(): string { const mode = this.weightRig ? bindingWeightMode(this.weightRig, this.bindings) : 'unbound'; return this.attachment ? 'Rigid' : mode === 'custom' ? 'Custom weights' : mode[0].toUpperCase() + mode.slice(1); }
    get editableRefs(): WeightPointRef[] { return this.uniqueOwners(this.pointEntries.filter(ref => this.canPaint(ref))); }
    get editRefs(): WeightPointRef[] { return this.selectedRefs.filter(ref => this.canPaint(ref)); }
    get canEditWeights(): boolean { return this.editableRefs.length > 0; }
    get autoRefs(): WeightPointRef[] { return this.selectedCount ? this.editRefs : this.editableRefs; }
    canPaint(ref: WeightPointRef): boolean { const rig = this.weightRig; if(!rig) return false; try { return !pointWeightState(rig, ref).rigid; } catch { return false; } }
    ownerRef(ref: WeightPointRef): WeightPointRef | undefined {
        const rig = this.weightRig;
        if(!rig) return;
        try { return weightOwner(rig, ref.pathId, ref.pointId); } catch { return; }
    }
    private uniqueOwners(refs: readonly WeightPointRef[]): WeightPointRef[] {
        const owners = new Map<string, WeightPointRef>();
        for(const ref of refs) { const owner = this.ownerRef(ref); if(owner) owners.set(this.pointKey(owner), owner); }
        return [...owners.values()];
    }
    isSelected(ref: WeightPointRef): boolean { const owner = this.ownerRef(ref); return !!owner && this.selectedRefs.some(item => this.pointKey(item) === this.pointKey(owner)); }
    selectPoints(refs: readonly WeightPointRef[], additive = false): void {
        this.cancelPreview();
        this.selectedRefs = this.uniqueOwners(additive ? [...this.selectedRefs, ...refs] : refs);
        if(refs.length) this.inspectPoint(refs[refs.length - 1]);
    }
    selectAll(): void { this.selectPoints(this.pointEntries); }
    clearSelection(): void { this.cancelPreview(); this.selectedRefs = []; this.pointRef = undefined; }
    pointWeights(ref: WeightPointRef) {
        const rig = this.weightRig, binding = rig?.bindings.find(item => item.pathId === ref.pathId), point = binding?.points.find(item => item.id === ref.pointId), owner = this.ownerRef(ref);
        return (owner && this.previewUpdates.find(item => this.pointKey(item) === this.pointKey(owner))?.weights) ?? (rig && binding && point ? effectivePointWeights(rig, binding, point) : []);
    }
    weightValue(boneId: string): number | undefined {
        const values = this.editRefs.map(ref => this.pointWeights(ref).find(weight => weight.boneId === boneId)?.weight ?? 0);
        return values.length && values.every(value => Math.abs(value - values[0]) < 1e-9) ? Math.round(values[0] * 10000) / 100 : undefined;
    }
    private ownerPoint(ref: WeightPointRef): BoundPoint | undefined { const owner = this.ownerRef(ref); return this.weightRig?.bindings.find(binding => binding.pathId === owner?.pathId)?.points.find(point => point.id === owner?.pointId); }
    influenceRefs(boneId: string): WeightPointRef[] { const rig = this.weightRig; return rig ? this.editRefs.filter(ref => pointWeightState(rig, ref).boneIds.includes(boneId)) : []; }
    lockState(boneId: string): 'locked' | 'mixed' | 'unlocked' {
        const refs = this.influenceRefs(boneId), locked = refs.filter(ref => this.ownerPoint(ref)?.lockedBoneIds?.includes(boneId)).length;
        return locked && locked === refs.length ? 'locked' : locked ? 'mixed' : 'unlocked';
    }
    canEditInfluence(boneId: string): boolean {
        const rig = this.weightRig;
        return !!rig && this.editRefs.some(ref => { const state = pointWeightState(rig, ref); return !state.lockedBoneIds.includes(boneId) && state.boneIds.includes(boneId); });
    }
    setLock(boneId: string): void { this.cancelPreview(); this.focusWeightRig(); this.rigs.setWeightLocks(this.influenceRefs(boneId), boneId, this.lockState(boneId) !== 'locked'); }
    clearWeights(): void { this.cancelPreview(); this.focusWeightRig(); this.rigs.clearPointWeights(this.editRefs); }
    previewWeight(boneId: string, value: number): void {
        if(!Number.isFinite(value) || value < 0 || value > 1 || !this.editRefs.length) { this.cancelPreview('numeric'); return; }
        this.focusWeightRig(); const refs = this.influenceRefs(boneId).filter(ref => !this.ownerPoint(ref)?.lockedBoneIds?.includes(boneId));
        const updates = this.rigs.previewPointWeights(refs, boneId, value);
        if(updates) this.setPreview('numeric', updates);
    }
    setSelectedWeight(boneId: string, value: number): void { this.previewWeight(boneId, value); if(this.previewKind === 'numeric') this.applyPreview(); }
    previewAutoWeights(): void { this.cancelPreview(); this.focusWeightRig(); const updates = this.rigs.previewAutoWeights(this.autoRefs); if(updates) this.setPreview('auto', updates); }
    setBrushPreview(updates: readonly WeightUpdate[]): void { this.setPreview('brush', updates); }
    private setPreview(kind: PreviewKind, updates: readonly WeightUpdate[]): void {
        this.preview = { kind, updates, revision: this.mutations.revision, scope: this.scopeKey, selection: this.selectionKey, workspace: this.rigs.workspace, tool: this.rigs.editor.activeTool };
        // Brush hit-testing uses frozen point positions, so only non-spatial previews deform posed artwork.
        if(kind !== 'brush') this.rigs.previewWeights(updates);
    }
    applyPreview(): boolean { this.validate(); const preview = this.preview; if(!preview) return false; this.preview = undefined; this.rigs.clearPosePreview(); return this.rigs.applyWeightUpdates(preview.updates); }
    cancelPreview(kind?: PreviewKind): void {
        const preview = this.preview;
        if(!preview || (kind && preview.kind !== kind)) return;
        this.preview = undefined;
        if(preview.kind !== 'brush') this.rigs.clearPosePreview();
    }
    /** Painting needs at least one weighted point; Select is always available. */
    setPaintMode(mode: WeightPaintMode): boolean {
        if(mode !== 'select' && !this.canEditWeights) return false;
        this.cancelPreview(); this.paintMode = mode; return true;
    }
    setBrush(key: BrushSetting, value: number): void {
        if(!Number.isFinite(value)) return;
        const [min, max] = BRUSH_LIMITS[key]; this[key] = Math.max(min, Math.min(max, value));
    }
    /** Shortcut steps: size scales by 20% (at least 1px), strength moves in 5% steps. */
    stepBrushSize(direction: 1 | -1): void { this.setBrush('brushRadius', Math.round(direction > 0 ? Math.max(this.brushRadius + 1, this.brushRadius * 1.2) : Math.min(this.brushRadius - 1, this.brushRadius / 1.2))); }
    stepBrushStrength(direction: 1 | -1): void { this.setBrush('brushStrength', Math.round((this.brushStrength + direction * .05) * 100) / 100); }
    get pointEntries(): WeightPointEntry[] {
        const rig = this.weightRig;
        if(!rig) return [];
        return this.scopeBindings.flatMap(({ path, binding }) => {
            const anchors = binding.points.filter(point => point.id === point.anchorId);
            return binding.points.filter(point => this.scopeMode !== 'bone' || !this.controlledOnly || effectivePointWeights(rig, binding, point).some(weight => weight.boneId === this.rigs.boneId && weight.weight > 0))
                .map(point => ({ pathId: path.id, pointId: point.id, point, binding, pathName: path.name,
                    label: (point.id === point.anchorId ? 'Point ' : 'Handle ' + (binding.points.filter(item => item.id !== item.anchorId && item.anchorId === point.anchorId).findIndex(item => item.id === point.id) + 1) + ' of point ') + (anchors.findIndex(anchor => anchor.id === point.anchorId) + 1) }));
        });
    }
    get selectedPoint(): WeightPointEntry | undefined {
        const points = this.pointEntries;
        return points.find(point => point.pathId === this.pointRef?.pathId && point.pointId === this.pointRef.pointId)
            ?? (!this.pointRef ? points.find(point => point.pointId === this.rigs.anchorId) : undefined) ?? points[0];
    }
    get selectedWeights() { const point = this.selectedPoint; return point ? this.pointWeights(point) : []; }
    get selectedIsHandle(): boolean { const point = this.selectedPoint?.point; return !!point && point.id !== point.anchorId; }
    get selectedIsIndependent(): boolean { return !!this.selectedPoint?.point.independent; }
    selectedAllows(boneId: string): boolean { const binding = this.selectedPoint?.binding; return !!binding && (!binding.boneIds || binding.boneIds.includes(boneId)); }
    get selectedSharedCount(): number {
        const point = this.selectedPoint, rig = this.weightRig;
        return point && rig ? weightMembers(rig, point).filter(ref => {
            const item = rig.bindings.find(binding => binding.pathId === ref.pathId)?.points.find(candidate => candidate.id === ref.pointId);
            return item && (item.id === item.anchorId || item.independent);
        }).length : 0;
    }
    get attachmentRig() { return this.rigs.armatures.find(rig => rig.attachments?.some(link => link.elementId === this.target?.id)); }
    get attachment() { return this.attachmentRig?.attachments?.find(link => link.elementId === this.target?.id); }
    get attachmentName(): string { return this.attachmentRig?.bones.find(bone => bone.id === this.attachment?.boneId)?.name ?? ''; }
    get isPinned(): boolean { return this.scopeMode === 'artwork' && !!this.scope; }
    get canUseSelected(): boolean { return !!this.rigs.editor.selectedElement && this.rigs.editor.selectedElement.id !== this.target?.id; }
    get influences() {
        const rig = this.weightRig, bindings = this.scopeMode === 'bone' && this.selectedPoint ? [this.selectedPoint.binding] : this.bindings;
        return rig ? rig.bones.filter(bone => bindings.some(binding => !binding.boneIds || binding.boneIds.includes(bone.id))) : [];
    }
    get pickedBones() {
        const pending = this.pending;
        return this.rigs.armatures.find(rig => rig.id === pending?.rigId)?.bones.filter(bone => pending?.bones.includes(bone.id)) ?? [];
    }
    color(boneId: string): string {
        const rig = this.rigs.armatures.find(rig => rig.bones.some(bone => bone.id === boneId));
        return boneWeightColor(boneId, rig?.bones.map(bone => bone.id));
    }

    useSelected(): void {
        const target = this.rigs.editor.selectedElement;
        if(!target) return;
        this.cancel(); this.scope = undefined; this.scopeMode = 'artwork'; this.clearSelection();
        if(this.rigs.workspace === 'weights') this.pin(target);
        this.focusWeightRig();
    }
    openWeights(): void {
        const target = this.target;
        if(!target || !this.rigs.canEdit) return;
        this.scopeMode = 'artwork'; this.clearSelection();
        this.rigs.workspace = 'weights'; this.pin(target); this.rigs.visible = true;
        this.focusWeightRig();
    }
    openBoneWeights(): void {
        if(!this.rigs.canEdit || !this.rigs.bone) return;
        this.cancel(); this.scopeMode = 'bone'; this.clearSelection(); this.controlledOnly = true;
        this.boneDocumentId = this.rigs.editor.selectedSVG?.id; this.boneScopeElementId = this.rigs.editor.selectedElement?.id;
        this.rigs.workspace = 'weights'; this.rigs.visible = true;
    }
    setScopeMode(mode: 'artwork' | 'bone'): void { if(mode === 'bone') this.openBoneWeights(); else this.openWeights(); }
    private pin(target: AnyElement): void {
        const svg = this.rigs.editor.selectedSVG;
        if(svg) this.scope = { targetId: target.id, documentId: svg.id, rigId: this.rigs.linkFor(target.id)?.rigId };
    }
    private focusWeightRig(): void {
        const rig = this.weightRig;
        if(!rig) return;
        const influences = this.influences;
        const selected = influences.find(bone => bone.id === this.rigs.boneId) ?? influences[0] ?? rig.bones[0];
        if(selected) this.rigs.selectBone(rig.id, selected.id);
    }
    selectPoint(ref: WeightPointRef, additive?: boolean): void;
    selectPoint(pathId: string, pointId: string): void;
    selectPoint(refOrPath: WeightPointRef | string, pointIdOrAdditive?: string | boolean): void {
        const ref = typeof refOrPath === 'string' ? { pathId: refOrPath, pointId: typeof pointIdOrAdditive === 'string' ? pointIdOrAdditive : '' } : refOrPath;
        const owner = this.ownerRef(ref), additive = pointIdOrAdditive === true;
        if(!owner) return;
        this.cancelPreview();
        this.selectedRefs = additive ? this.isSelected(ref) ? this.selectedRefs.filter(item => this.pointKey(item) !== this.pointKey(owner)) : [...this.selectedRefs, owner] : [owner];
        this.inspectPoint(ref);
    }
    private inspectPoint(ref: WeightPointRef): void {
        const entry = this.pointEntries.find(point => point.pathId === ref.pathId && point.pointId === ref.pointId);
        if(entry) { this.pointRef = { pathId: entry.pathId, pointId: entry.pointId }; this.rigs.anchorId = entry.point.anchorId; }
    }
    selectAnchor(anchorId: string): void { const entry = this.pointEntries.find(point => point.pointId === anchorId); if(entry) this.selectPoint(entry); }
    selectPointKey(key: string): void { const entry = this.pointEntries.find(point => this.pointKey(point) === key); if(entry) this.selectPoint(entry); }
    pointKey(ref: WeightPointRef): string { return JSON.stringify([ref.pathId, ref.pointId]); }
    setHandleIndependent(independent: boolean): void {
        const point = this.selectedPoint;
        if(point) { this.cancelPreview(); this.focusWeightRig(); if(this.rigs.setHandleIndependent(point, independent)) this.selectPoint(point); }
    }
    linkOverlapping(): void { if(this.scopeMode === 'artwork') { this.cancelPreview(); this.focusWeightRig(); this.rigs.linkCoincidentWeights(this.bindings.map(binding => binding.pathId)); this.selectedRefs = this.uniqueOwners(this.selectedRefs); } }
    unlinkSelectedWeights(): void { const point = this.selectedPoint; if(point) { this.cancelPreview(); this.focusWeightRig(); this.rigs.unlinkPointWeights(point); this.selectPoint(point); } }
    begin(_legacyMode?: 'weighted' | 'rigid'): void {
        const target = this.target, svg = this.rigs.editor.selectedSVG;
        if(!target || !svg || !this.rigs.canEdit) {
            this.rigs.message = 'Select one artwork layer or group first.'; return;
        }
        this.cancelPreview(); this.scopeMode = 'artwork';
        if(this.mixedArmatures) { this.rigs.message = 'This group contains artwork bound to different armatures. Edit its paths separately.'; return; }
        const rig = this.weightRig ?? this.attachmentRig, editing = !!this.binding || !!this.attachment;
        const bones = this.assignedBoneIds;
        this.rigs.editor.tools.find(tool => tool.preferenceKey === 'select')?.restoreSelection();
        this.pin(target);
        this.rigs.workspace = 'weights';
        this.pending = { targetId: target.id, documentId: svg.id, revision: this.mutations.revision,
            rigId: editing ? rig?.id : undefined, bones, initialBones: [...bones], editing,
            workspace: this.rigs.workspace, tool: this.rigs.editor.activeTool };
        if(editing) this.focusWeightRig();
        this.rigs.visible = true;
        this.rigs.message = '';
    }
    toggle(rigId: string, boneId: string): void {
        this.validate();
        if(this.rigs.ikPick) { if(rigId === this.rigs.activeId) this.rigs.pickIKTarget(boneId); else this.rigs.message = 'Pick an IK target from the same armature.'; return; }
        const pending = this.pending;
        if(!pending) {
            this.cancelPreview();
            if(this.scopeMode === 'artwork' && this.scope && this.rigs.workspace === 'weights' && this.weightRig && this.weightRig.id !== rigId) {
                this.rigs.message = 'This artwork is bound to ' + this.weightRig.name + '. Choose one of its bones.'; return;
            }
            this.rigs.selectBone(rigId, boneId);
            if(this.scopeMode === 'bone') { this.clearSelection(); this.rigs.anchorId = ''; }
            return;
        }
        if(pending.rigId && pending.rigId !== rigId && (pending.editing || pending.bones.length)) { this.rigs.message = 'Choose bones from one armature per artwork link.'; return; }
        if(!this.rigs.armatures.find(rig => rig.id === rigId)?.bones.some(bone => bone.id === boneId)) return;
        pending.rigId = rigId;
        pending.bones = pending.bones.includes(boneId) ? pending.bones.filter(id => id !== boneId) : [...pending.bones, boneId];
        this.rigs.selectBone(rigId, boneId);
    }
    /** Assignments read artwork as rest geometry; resetting keeps the bones picked so far. */
    resetToRest(): void {
        const pending = this.pending;
        if(!this.rigs.resetToRest() || !pending) return;
        this.begin();
        if(this.pending) { this.pending.rigId = pending.rigId; this.pending.bones = [...pending.bones]; }
    }
    confirm(): void {
        this.validate(); const pending = this.pending, svg = this.rigs.editor.selectedSVG;
        if(!pending || !svg || (pending.bones.length && !pending.rigId)) return;
        if(!this.assignmentChanged) { this.cancel(); return; }
        const target = findAnimationTarget(svg.elements, pending.targetId); if(!target) return;
        if(pending.rigId) this.rigs.selectBone(pending.rigId, pending.bones[0] ?? this.rigs.boneId ?? '');
        this.pending = undefined;
        const succeeded = this.rigs.assignArtworkBones(target, pending.bones);
        if(!succeeded) this.pending = pending;
        else { this.pin(target); this.clearSelection(); this.rigs.workspace = 'weights'; }
    }
    removeInfluence(boneId: string): void {
        if(!this.bindings.length || this.influences.length <= 1 || !this.target) return;
        this.focusWeightRig();
        if(this.rigs.assignArtworkBones(this.target, this.influences.filter(bone => bone.id !== boneId).map(bone => bone.id))) this.focusWeightRig();
    }
    unlink(): void {
        const target = this.target, rig = this.weightRig ?? this.attachmentRig;
        if(!target || !rig) return;
        this.cancelPreview(); this.clearSelection();
        this.rigs.select(rig.id);
        this.rigs.assignArtworkBones(target, []);
    }
    validate(): void {
        const svg = this.rigs.editor.selectedSVG;
        const pending = this.pending;
        if(pending && (!this.rigs.canEdit || pending.documentId !== svg?.id || !findAnimationTarget(svg?.elements ?? [], pending.targetId) || pending.revision !== this.mutations.revision || pending.workspace !== this.rigs.workspace || pending.tool !== this.rigs.editor.activeTool)) this.cancel();
        if(this.scope && (!this.rigs.canEdit || this.scope.documentId !== svg?.id || !findAnimationTarget(svg?.elements ?? [], this.scope.targetId))) this.scope = undefined;
        if(this.scopeMode === 'bone' && (!this.rigs.canEdit || this.boneDocumentId !== svg?.id || this.rigs.workspace !== 'weights')) { this.scopeMode = 'artwork'; this.clearSelection(); }
        if(!this.pending && this.rigs.workspace !== 'weights') this.scope = undefined;
        // Choosing different artwork while editing by bone means "edit this artwork".
        const selected = this.rigs.editor.selectedElement;
        if(this.scopeMode === 'bone' && !this.pending && this.rigs.workspace === 'weights' && this.rigs.canEdit && selected && selected.id !== this.boneScopeElementId) { this.scopeMode = 'artwork'; this.clearSelection(); this.pin(selected); this.focusWeightRig(); }
        if(this.scopeMode === 'artwork' && !this.pending && this.rigs.workspace === 'weights' && this.rigs.canEdit && this.rigs.editor.selectedElement && this.rigs.editor.selectedElement.id !== this.scope?.targetId) {
            this.clearSelection(); this.pin(this.rigs.editor.selectedElement); this.focusWeightRig();
        }
        const preview = this.preview;
        if(preview && (!this.rigs.canEdit || preview.revision !== this.mutations.revision || preview.scope !== this.scopeKey || preview.selection !== this.selectionKey || preview.workspace !== this.rigs.workspace || preview.tool !== this.rigs.editor.activeTool)) this.cancelPreview();
        this.selectedRefs = this.uniqueOwners(this.selectedRefs).filter(ref => this.pointEntries.some(point => this.pointKey(this.ownerRef(point) ?? point) === this.pointKey(ref)));
        if(!this.canEditWeights && this.paintMode !== 'select') this.paintMode = 'select';
    }
    cancel(): void { if(this.pending) this.rigs.message = ''; this.pending = undefined; this.cancelPreview(); }
    close(): void { this.cancel(); this.scope = undefined; this.scopeMode = 'artwork'; this.clearSelection(); this.paintMode = 'select'; }
}
