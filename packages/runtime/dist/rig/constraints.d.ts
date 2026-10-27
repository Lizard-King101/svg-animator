import { Armature, TwoBoneIKConstraint } from './armature';
/** Shared structural checks for persistence and commands, including disabled records. */
export declare function rigConstraintProblem(rig: Armature): string | undefined;
/** The joint a two-bone chain needs before it can solve; a gap is repairable with Reconnect joint. */
export declare function constraintJointGap(rig: Armature, constraint: TwoBoneIKConstraint): {
    upper: string;
    lower: string;
    lowerId: string;
} | undefined;
/** First reason one constraint cannot solve, phrased for the bones it names. */
export declare function constraintIssue(rig: Armature, constraint: TwoBoneIKConstraint): string | undefined;
/** Evaluate authored FK followed by target constraints without mutating persisted poses. */
export declare function evaluateRigConstraints(rig: Armature): Armature;
//# sourceMappingURL=constraints.d.ts.map