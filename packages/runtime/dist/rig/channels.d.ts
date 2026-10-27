import type { RigDocument } from './armature';
export type RigAnimationField = 'pose' | 'poseX' | 'poseY';
export interface RigAnimationProperty {
    boneId: string;
    field: RigAnimationField;
}
/** Bone channels address authored pose offsets; solved IK angles are never keys. */
export declare function rigAnimationProperty(boneId: string, field: RigAnimationField): string;
export declare function parseRigAnimationProperty(property: string): RigAnimationProperty | undefined;
export declare function readRigAnimationProperty(rigs: RigDocument | undefined, targetId: string, property: string): number | undefined;
//# sourceMappingURL=channels.d.ts.map