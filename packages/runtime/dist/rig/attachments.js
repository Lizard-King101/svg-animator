import { boneMatrices, hasBonePose } from './armature';
import { decomposeTransform, invertMatrix, multiplyMatrix } from './transform';
export function attachmentMatrix(rig, attachment) {
    const rest = boneMatrices(rig, false).get(attachment.boneId), posed = boneMatrices(rig).get(attachment.boneId);
    return multiplyMatrix(invertMatrix(attachment.parentMatrix), multiplyMatrix(multiplyMatrix(posed, invertMatrix(rest)), attachment.worldMatrix));
}
export function attachmentTransforms(rig) {
    const transforms = new Map();
    for (const attachment of rig.attachments ?? []) {
        const transform = !rig.bones.some(hasBonePose) ? structuredClone(attachment.restTransform) : decomposeTransform(attachmentMatrix(rig, attachment));
        if (!transform)
            throw new Error('This pose would introduce skew under a scaled parent. Use a uniformly scaled parent for rigid attachments, or bind path points instead.');
        transforms.set(attachment.elementId, transform);
    }
    return transforms;
}
//# sourceMappingURL=attachments.js.map