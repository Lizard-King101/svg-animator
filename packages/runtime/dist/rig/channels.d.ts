import type { Armature, RigDocument } from './armature';
export type RigAnimationField = 'pose' | 'poseX' | 'poseY';
export type RigWindField = 'windX' | 'windY';
export type RigAnimationProperty = {
    boneId: string;
    field: RigAnimationField;
} | {
    boneId?: never;
    field: RigWindField;
};
export interface RigChannelWriter {
    read(): number;
    write(value: number): void;
}
/** Bone channels address authored pose offsets; solved IK angles are never keys. */
export declare function rigAnimationProperty(boneId: string, field: RigAnimationField): string;
export declare function rigWindProperty(field: RigWindField): string;
export declare function parseRigAnimationProperty(property: string): RigAnimationProperty | undefined;
/** Resolve once per plan, so bone and armature channels share the same write path. */
export declare function resolveRigAnimationChannel(rig: Armature | undefined, property: string): RigChannelWriter | undefined;
export declare function readRigAnimationProperty(rigs: RigDocument | undefined, targetId: string, property: string): number | undefined;
export declare function hasRigWindData(rig: Armature): boolean;
//# sourceMappingURL=channels.d.ts.map