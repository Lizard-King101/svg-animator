/** Bone channels address authored pose offsets; solved IK angles are never keys. */
export function rigAnimationProperty(boneId, field) {
    return `bones.${boneId}.${field}`;
}
export function parseRigAnimationProperty(property) {
    const match = /^bones\.(.+)\.(pose|poseX|poseY)$/.exec(property);
    return match ? { boneId: match[1], field: match[2] } : undefined;
}
export function readRigAnimationProperty(rigs, targetId, property) {
    const parsed = parseRigAnimationProperty(property);
    const bone = parsed && rigs?.armatures.find(rig => rig.id === targetId)?.bones.find(bone => bone.id === parsed.boneId);
    return bone && parsed ? bone[parsed.field] ?? 0 : undefined;
}
//# sourceMappingURL=channels.js.map