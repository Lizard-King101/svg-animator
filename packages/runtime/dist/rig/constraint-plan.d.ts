import type { Armature, TwoBoneIKConstraint } from './armature';
interface ConstraintPlan {
    ordered: TwoBoneIKConstraint[];
    problem?: string;
}
/** Structural reason one record cannot form a chain; shared by the solve plan and the constraint list. */
export declare function constraintChainProblem(rig: Armature, constraint: TwoBoneIKConstraint): string | undefined;
/** Ancestor dependencies are sorted stably so record order never changes the pose. */
export declare function constraintPlan(rig: Armature): ConstraintPlan;
export {};
//# sourceMappingURL=constraint-plan.d.ts.map