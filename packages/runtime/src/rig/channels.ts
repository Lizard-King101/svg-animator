import type { RigDocument } from './armature';

export type RigAnimationField = 'pose' | 'poseX' | 'poseY';
export interface RigAnimationProperty { boneId: string; field: RigAnimationField; }

/** Bone channels address authored pose offsets; solved IK angles are never keys. */
export function rigAnimationProperty(boneId: string, field: RigAnimationField): string {
    return `bones.${boneId}.${field}`;
}

export function parseRigAnimationProperty(property: string): RigAnimationProperty | undefined {
    const match = /^bones\.(.+)\.(pose|poseX|poseY)$/.exec(property);
    return match ? { boneId: match[1], field: match[2] as RigAnimationField } : undefined;
}

export function readRigAnimationProperty(rigs: RigDocument | undefined, targetId: string, property: string): number | undefined {
    const parsed = parseRigAnimationProperty(property);
    const bone = parsed && rigs?.armatures.find(rig => rig.id === targetId)?.bones.find(bone => bone.id === parsed.boneId);
    return bone && parsed ? bone[parsed.field] ?? 0 : undefined;
}
