import type { Armature, TwoBoneIKConstraint } from './armature';
import type { SpringConstraint } from './spring-chain';
import { constraintPlan } from './constraint-plan';

export type RigMotionStep = { kind: 'ik'; constraint: TwoBoneIKConstraint } | { kind: 'spring'; constraint: SpringConstraint; ids: string[] };

/** Sort all motion writers together: an IK target may ride on a simulated bone,
 * and a spring may ride on an IK chain. Feedback cycles cannot be evaluated. */
export function rigMotionOrder(rig: Armature, springs: { constraint: SpringConstraint; ids: string[] }[]): RigMotionStep[] {
    const ik = constraintPlan(rig);
    if(ik.problem) throw new Error(ik.problem);
    const steps: RigMotionStep[] = [
        ...ik.ordered.map(constraint => ({ kind: 'ik' as const, constraint })),
        ...springs.filter(({constraint}) => constraint.enabled).map(spring => ({kind:'spring' as const,...spring})),
    ];
    const bones = new Map(rig.bones.map(bone => [bone.id,bone]));
    const ancestors = (id: string | null | undefined) => {
        const result = new Set<string>();
        while(id && !result.has(id)) { result.add(id); id=bones.get(id)?.parentId; }
        return result;
    };
    const writes = steps.map(step => new Set(step.kind==='ik' ? [step.constraint.upperBoneId,step.constraint.lowerBoneId] : step.ids));
    const dependencies = steps.map((step,index) => {
        const reads = step.kind==='ik' ? new Set([...ancestors(step.constraint.upperBoneId),...ancestors(step.constraint.targetBoneId)])
            : ancestors(bones.get(step.ids[0])?.parentId);
        return steps.map((_,other)=>other).filter(other=>other!==index && [...writes[other]].some(id=>reads.has(id)));
    });
    const result: RigMotionStep[] = [], done = new Set<number>();
    while(result.length<steps.length) {
        const ready=steps.map((_,index)=>index).filter(index=>!done.has(index) && dependencies[index].every(other=>done.has(other)))
            .sort((a,b)=>steps[a].constraint.id<steps[b].constraint.id?-1:steps[a].constraint.id>steps[b].constraint.id?1:a-b);
        if(!ready.length) throw new Error('Physics and IK dependencies contain a cycle. Move the target outside the dependent chains.');
        for(const index of ready) { done.add(index); result.push(steps[index]); }
    }
    return result;
}
