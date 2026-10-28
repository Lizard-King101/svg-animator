import { Matrix, TransformState } from './transform';
import { SpringConstraint } from './spring-chain';
/** Rest joints are parent-local; pose angles are offsets from rest, in degrees. */
export interface Bone {
    kind?: 'bone' | 'point';
    id: string;
    name: string;
    parentId: string | null;
    x: number;
    y: number;
    angle: number;
    length: number;
    pose: number;
    poseX?: number;
    poseY?: number;
}
export interface BoneWeight {
    boneId: string;
    weight: number;
}
export interface WeightPointRef {
    pathId: string;
    pointId: string;
}
export interface BoundPoint {
    id: string;
    anchorId: string;
    x: number;
    y: number;
    weights: BoneWeight[];
    independent?: boolean;
    weightSource?: WeightPointRef;
    lockedBoneIds?: string[];
}
export interface PathBinding {
    pathId: string;
    scopeId?: string;
    matrix: Matrix;
    topology: string;
    boneIds?: string[];
    points: BoundPoint[];
}
export interface RigidAttachment {
    elementId: string;
    boneId: string;
    parentMatrix: Matrix;
    worldMatrix: Matrix;
    restTransform: TransformState;
}
export interface TwoBoneIKConstraint {
    id: string;
    name: string;
    type: 'two-bone-ik';
    enabled: boolean;
    upperBoneId: string;
    lowerBoneId: string;
    targetBoneId: string;
    bend: 1 | -1;
}
export interface Armature {
    windX?: number;
    windY?: number;
    springs?: SpringConstraint[];
    attachments?: RigidAttachment[];
    constraints?: TwoBoneIKConstraint[];
    constraintsActive?: boolean;
    id: string;
    name: string;
    bones: Bone[];
    bindings: PathBinding[];
}
export interface RigDocument {
    version: 1 | 2 | 3 | 4 | 5 | 6;
    armatures: Armature[];
}
/** Drawing may leave subpixel joint differences; IK requires the same connected joint. */
export declare function isConnectedBoneJoint(upper: Bone, lower: Bone): boolean;
export declare function boneLocalMatrix(bone: Bone, posed?: boolean): Matrix;
export declare function boneMatrices(rig: Armature, posed?: boolean): Map<string, Matrix>;
export declare function normalizeWeights(weights: readonly BoneWeight[]): BoneWeight[];
/** Preserve the other influences' relative proportions when changing one normalized weight. */
export declare function weightsWithInfluence(weights: readonly BoneWeight[], boneId: string, value: number): BoneWeight[];
/** Geometry ownership (anchorId) is independent from weight ownership. */
export declare function weightOwner(rig: Armature, pathId: string, pointId: string): WeightPointRef;
export declare function effectivePointWeights(rig: Armature, binding: PathBinding, point: BoundPoint): BoneWeight[];
/** Locks follow the same canonical owner as weights, including inherited handles. */
export declare function weightOwnerLocks(rig: Armature, ref: WeightPointRef): string[];
/** Empty independent weights leave a point at rest; legacy handles inherit their anchor. */
export declare function deformBinding(rig: Armature, binding: PathBinding): Map<string, {
    x: number;
    y: number;
}>;
export declare function validRigs(value: unknown): value is RigDocument;
export declare function hasBonePose(bone: Bone): boolean;
//# sourceMappingURL=armature.d.ts.map