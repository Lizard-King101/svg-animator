import { Armature, Bone } from './armature';
export declare function twoBoneChain(rig: Armature, endId: string): {
    upper: Bone;
    lower: Bone;
} | undefined;
export declare function chainBend(rig: Armature, endId: string): 1 | -1;
/** Analytic two-link solve in the upper bone's parent space; unreachable targets never stretch. */
export declare function solveTwoBoneIK(rig: Armature, endId: string, target: {
    x: number;
    y: number;
}, bend: 1 | -1): Armature | undefined;
//# sourceMappingURL=two-bone-ik.d.ts.map