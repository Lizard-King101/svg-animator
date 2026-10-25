import { Armature, boneMatrices, hasBonePose, RigidAttachment } from './objects/armature';
import { findAnimationTarget } from './objects/animation-targets';
import { findElementChain, ownMatrix, parentMatrixFor } from './objects/element-bounds';
import { SVG } from './objects/svg.object';
import { decomposeTransform, invertMatrix, Matrix, multiplyMatrix, TransformState } from './objects/transform.object';

export function attachmentMatrix(rig: Armature, attachment: RigidAttachment): Matrix {
    const rest = boneMatrices(rig, false).get(attachment.boneId)!, posed = boneMatrices(rig).get(attachment.boneId)!;
    return multiplyMatrix(invertMatrix(attachment.parentMatrix), multiplyMatrix(multiplyMatrix(posed, invertMatrix(rest)), attachment.worldMatrix));
}
export function attachmentTransforms(rig: Armature): Map<string, TransformState> {
    const transforms = new Map<string, TransformState>();
    for(const attachment of rig.attachments ?? []) {
        const transform = !rig.bones.some(hasBonePose) ? structuredClone(attachment.restTransform) : decomposeTransform(attachmentMatrix(rig, attachment));
        if(!transform) throw new Error('This pose would introduce skew under a scaled parent. Use a uniformly scaled parent for rigid attachments, or bind path points instead.');
        transforms.set(attachment.elementId, transform);
    }
    return transforms;
}
export function attachmentProblem(svg: SVG, rig: Armature): string | undefined {
    for(const attachment of rig.attachments ?? []) {
        const element = findAnimationTarget(svg.elements, attachment.elementId);
        if(!element) return 'Attached artwork was removed. Detach its missing link before posing.';
        if(findElementChain(svg.elements, element)?.some(item => item.locked || !item.visible || item.motion.pathId)) return 'Show, unlock and remove motion-path constraints from attached artwork before posing.';
        if(!sameMatrix(parentMatrixFor(svg.elements, element), attachment.parentMatrix) || !sameMatrix(ownMatrix(element), attachmentMatrix(rig, attachment))) return 'An attached transform changed. Detach and attach again before posing.';
    }
    return undefined;
}
export function applyAttachments(svg: SVG, rig: Armature): void {
    for(const [id, transform] of attachmentTransforms(rig)) {
        const element = findAnimationTarget(svg.elements, id); if(element) element.transform = transform;
    }
}
function sameMatrix(a: Matrix, b: Matrix): boolean { return (Object.keys(a) as (keyof Matrix)[]).every(key => Math.abs(a[key] - b[key]) < .002); }
