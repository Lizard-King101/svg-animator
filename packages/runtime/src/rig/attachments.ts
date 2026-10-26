import { Armature, boneMatrices, hasBonePose, RigidAttachment } from './armature';
import { decomposeTransform, invertMatrix, Matrix, multiplyMatrix, TransformState } from './transform';

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
