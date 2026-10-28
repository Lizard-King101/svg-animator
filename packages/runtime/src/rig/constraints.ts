import { Armature, boneMatrices, isConnectedBoneJoint, TwoBoneIKConstraint } from './armature';
import { applyMatrix } from './transform';
import { solveTwoBoneIK, twoBoneChain } from './two-bone-ik';

import { constraintChainProblem, constraintPlan } from './constraint-plan';
import { springConstraintsProblem } from './spring-chain';

/** Shared structural checks for persistence and commands, including disabled records. */
export function rigConstraintProblem(rig: Armature): string | undefined {
    return constraintPlan(rig).problem ?? springConstraintsProblem(rig);
}

/** The joint a two-bone chain needs before it can solve; a gap is repairable with Reconnect joint. */
export function constraintJointGap(rig: Armature, constraint: TwoBoneIKConstraint): { upper: string; lower: string; lowerId: string } | undefined {
    const upper = rig.bones.find(bone => bone.id === constraint.upperBoneId), lower = rig.bones.find(bone => bone.id === constraint.lowerBoneId);
    return upper && lower && lower.parentId === upper.id && !isConnectedBoneJoint(upper, lower) ? { upper: upper.name, lower: lower.name, lowerId: lower.id } : undefined;
}

/** First reason one constraint cannot solve, phrased for the bones it names. */
export function constraintIssue(rig: Armature, constraint: TwoBoneIKConstraint): string | undefined {
    const problem = constraintChainProblem(rig, constraint); if(problem) return problem[0].toUpperCase() + problem.slice(1);
    const gap = constraintJointGap(rig, constraint);
    return gap && `${gap.lower} must start at ${gap.upper}'s tip.`;
}

/** Evaluate authored FK followed by target constraints without mutating persisted poses. */
export function evaluateRigConstraints(rig: Armature): Armature {
    const plan = constraintPlan(rig);
    if(plan.problem) throw new Error(plan.problem);
    let result = structuredClone(rig);
    if(rig.constraintsActive === false) return result;
    for(const constraint of plan.ordered) {
        if(!twoBoneChain(result, constraint.lowerBoneId)) {
            throw new Error(`${constraint.name}: ${constraintIssue(result, constraint)} Use Reconnect joint in Bone setup before posing.`);
        }
        const targetMatrix = boneMatrices(result).get(constraint.targetBoneId)!;
        const target = applyMatrix(targetMatrix, 0, 0);
        const solved = solveTwoBoneIK(result, constraint.lowerBoneId, target, constraint.bend);
        if(!solved) throw new Error(`${constraint.name}: this two-bone chain cannot reach a valid pose.`);
        result = solved;
    }
    return result;
}
