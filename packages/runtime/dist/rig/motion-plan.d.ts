import type { Armature, TwoBoneIKConstraint } from './armature';
import type { SpringConstraint } from './spring-chain';
export type RigMotionStep = {
    kind: 'ik';
    constraint: TwoBoneIKConstraint;
} | {
    kind: 'spring';
    constraint: SpringConstraint;
    ids: string[];
};
/** Sort all motion writers together: an IK target may ride on a simulated bone,
 * and a spring may ride on an IK chain. Feedback cycles cannot be evaluated. */
export declare function rigMotionOrder(rig: Armature, springs: {
    constraint: SpringConstraint;
    ids: string[];
}[]): RigMotionStep[];
//# sourceMappingURL=motion-plan.d.ts.map