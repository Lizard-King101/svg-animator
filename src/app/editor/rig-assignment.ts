import { Armature, hasBonePose, WeightPointRef } from './objects/armature';
import { allAnimationDocuments } from './objects/animation.object';
import { findAnimationTarget } from './objects/animation-targets';
import { findElementChain, parentMatrixFor, resolvedOrigin } from './objects/element-bounds';
import { Group } from './objects/elements/group.object';
import { Path } from './objects/elements/path.object';
import { combinedMotionAdjustedMatrixFor } from './objects/motion-path.object';
import { AnyElement, SVG } from './objects/svg.object';
import { nativeWeightPaths, weightScopeProblem } from './rig-artwork-scope';
import { createPathBinding } from './rig-binding';
import { evaluateRigConstraints } from './rig-constraints';
import { REST_REQUIRED } from './rig-rest-edit';
import { detachBindingWeights, linkCoincidentWeights } from './rig-point-weights';
import { assignWeightUpdates, changeScopeInfluences } from './rig-weight-commands';
import { automaticWeightUpdates, pointWeightState } from './rig-weight-editing';

export interface ArtworkAssignment { candidate: Armature; pinOrigins: AnyElement[]; unbound: boolean; }

export function bindingPointRefs(rig: Armature, pathIds: readonly string[]): WeightPointRef[] {
    return rig.bindings.filter(binding => pathIds.includes(binding.pathId)).flatMap(binding => binding.points.map(point => ({ pathId: binding.pathId, pointId: point.id })));
}

/** Shared construction for native paths, including clipping and canonical seam ownership. */
export function addPathBindings(svg: SVG, rig: Armature, target: AnyElement, ids: string[], restrict = true): Armature {
    const candidate = structuredClone(rig), paths = nativeWeightPaths(target);
    for(const path of paths) {
        const binding = createPathBinding(svg, path, ids[0]);
        if(target instanceof Group) binding.scopeId = target.id;
        if(restrict) binding.boneIds = ids.slice();
        binding.points.filter(point => point.id === point.anchorId).forEach(point => point.weights = ids.map(boneId => ({ boneId, weight: 1 / ids.length })));
        candidate.bindings.push(binding);
    }
    return linkCoincidentWeights(candidate, paths.map(path => path.id));
}

/** Prepares the entire assignment without touching artwork, hierarchy, or history. */
export function prepareArtworkAssignment(svg: SVG, rig: Armature, target: AnyElement, boneIds: readonly string[]): ArtworkAssignment {
    const ids = [...new Set(boneIds)], chain = findElementChain(svg.elements, target);
    if(!chain) throw new Error('This artwork is no longer in the document.');
    if(ids.some(id => !rig.bones.some(bone => bone.id === id))) throw new Error('Choose bones from this armature.');
    const paths = nativeWeightPaths(target), pathIds = paths.map(path => path.id);
    const bindings = rig.bindings.filter(binding => pathIds.includes(binding.pathId));
    const attachment = rig.attachments?.find(link => link.elementId === target.id);
    for(const other of svg.rigs.armatures) {
        for(const id of [...other.bindings.map(binding => binding.pathId), ...(other.attachments ?? []).map(link => link.elementId)]) {
            const linked = findAnimationTarget(svg.elements, id);
            const overlaps = chain.some(item => item.id === id) || (linked && findElementChain(svg.elements, linked)?.includes(target));
            const editable = other.id === rig.id && (bindings.some(binding => binding.pathId === id) || attachment?.elementId === id);
            if(overlaps && !editable) throw new Error('Unbind the existing ancestor or descendant link before assigning this artwork.');
        }
    }
    let candidate = structuredClone(rig);
    if(!ids.length) {
        candidate = detachBindingWeights(candidate, bindings.map(binding => binding.pathId));
        if(attachment) candidate.attachments = candidate.attachments!.filter(link => link.elementId !== target.id);
        return { candidate, pinOrigins: [], unbound: true };
    }
    if(bindings.length) {
        const problem = weightScopeProblem(svg, target);
        if(problem) throw new Error(problem);
        if(bindings.length !== paths.length) throw new Error('This group is partly bound. Unbind its paths before assigning the complete group.');
        const rigidRefs = bindingPointRefs(rig,pathIds).filter(ref => pointWeightState(rig,ref).rigid);
        candidate = changeScopeInfluences(rig, pathIds, ids);
        if(ids.length > 1 && rigidRefs.length) candidate = assignWeightUpdates(candidate, automaticWeightUpdates(candidate, rigidRefs));
        return { candidate, pinOrigins: [], unbound: false };
    }
    if(attachment && ids.length === 1 && attachment.boneId === ids[0]) return { candidate, pinOrigins: [], unbound: false };
    if(evaluateRigConstraints(rig).bones.some(hasBonePose)) throw new Error(REST_REQUIRED);
    const nativeOnly = (element: AnyElement): boolean => element instanceof Path || (element instanceof Group && element.elements.length > 0 && element.elements.every(nativeOnly));
    if(ids.length > 1 || nativeOnly(target)) {
        const problem = weightScopeProblem(svg, target); if(problem) throw new Error(problem);
        if(attachment) candidate.attachments = candidate.attachments!.filter(link => link.elementId !== target.id);
        candidate = addPathBindings(svg, candidate, target, ids);
        if(ids.length > 1) candidate = assignWeightUpdates(candidate, automaticWeightUpdates(candidate, bindingPointRefs(candidate, pathIds)));
        return { candidate, pinOrigins: [...new Set(paths.flatMap(path => findElementChain(svg.elements, path) ?? []))], unbound: false };
    }
    if(chain.some(item => item.locked || !item.visible || item.motion.pathId)) throw new Error('Show and unlock artwork, and remove motion-path constraints before assigning bones.');
    if(allAnimationDocuments(svg.animation).some(animation => animation.tracks.some(track => chain.some(item => item.id === track.targetId)))) throw new Error('Remove existing animation on this artwork or its ancestors before assigning bones.');
    const parentMatrix = parentMatrixFor(svg.elements, target);
    if(Math.abs(parentMatrix.a * parentMatrix.d - parentMatrix.b * parentMatrix.c) < .000001) throw new Error('Restore a nonzero parent scale before assigning bones.');
    const origin = resolvedOrigin(target);
    candidate.attachments = [...(candidate.attachments ?? []).filter(link => link.elementId !== target.id), {
        elementId: target.id, boneId: ids[0], parentMatrix, worldMatrix: combinedMotionAdjustedMatrixFor(svg, target),
        restTransform: { ...target.transform, originX: origin.x, originY: origin.y },
    }];
    return { candidate, pinOrigins: chain, unbound: false };
}
