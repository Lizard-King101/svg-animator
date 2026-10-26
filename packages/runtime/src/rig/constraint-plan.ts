import type { Armature, TwoBoneIKConstraint } from './armature';

interface ConstraintPlan { ordered: TwoBoneIKConstraint[]; problem?: string; }

/** Structural reason one record cannot form a chain; shared by the solve plan and the constraint list. */
export function constraintChainProblem(rig: Armature, constraint: TwoBoneIKConstraint): string | undefined {
    const bones = new Map(rig.bones.map(bone => [bone.id, bone]));
    const upper = bones.get(constraint.upperBoneId), lower = bones.get(constraint.lowerBoneId), target = bones.get(constraint.targetBoneId);
    if(!upper || !lower || !target) return 'a constrained bone or target is missing.';
    if(lower.parentId !== upper.id || upper.kind === 'point' || lower.kind === 'point' || upper.length <= 0 || lower.length <= 0) {
        return 'choose two length bones in a parent-child chain.';
    }
    for(let current: typeof target | undefined = target, seen = new Set<string>(); current && !seen.has(current.id); current = current.parentId ? bones.get(current.parentId) : undefined) {
        if(current.id === upper.id || current.id === lower.id) return `the target must be outside the leg or arm it controls. ${target.name} is attached inside ${upper.name} → ${lower.name}.`;
        seen.add(current.id);
    }
    return undefined;
}

/** Ancestor dependencies are sorted stably so record order never changes the pose. */
export function constraintPlan(rig: Armature): ConstraintPlan {
    const fail = (problem: string): ConstraintPlan => ({ ordered: [], problem });
    if(rig.constraints === undefined) return { ordered: [] };
    if(!Array.isArray(rig.constraints)) return fail('Armature constraints must be a list.');
    const bones = new Map(rig.bones.map(bone => [bone.id, bone]));
    const ancestors = (id: string): Set<string> => {
        const result = new Set<string>();
        let current = bones.get(id);
        while(current && !result.has(current.id)) {
            result.add(current.id);
            current = current.parentId ? bones.get(current.parentId) : undefined;
        }
        return result;
    };
    const ids = new Set<string>();
    const validId = (id: unknown) => typeof id === 'string' && id.length > 0;
    for(const constraint of rig.constraints) {
        if(!constraint || typeof constraint !== 'object' || !validId(constraint.id) || ids.has(constraint.id)
            || typeof constraint.name !== 'string' || constraint.type !== 'two-bone-ik'
            || typeof constraint.enabled !== 'boolean' || ![1, -1].includes(constraint.bend)
            || ![constraint.upperBoneId, constraint.lowerBoneId, constraint.targetBoneId].every(validId)) {
            return fail('Each IK constraint needs a unique ID, name, enabled state, bend direction and bone references.');
        }
        ids.add(constraint.id);
        const problem = constraintChainProblem(rig, constraint);
        if(problem) return fail(`${constraint.name}: ${problem}`);
    }
    const enabled = rig.constraints.filter(constraint => constraint.enabled);
    const writers = new Map<string, string>();
    for(const constraint of enabled) {
        for(const boneId of [constraint.upperBoneId, constraint.lowerBoneId]) {
            if(writers.has(boneId)) return fail(`${constraint.name}: a bone already belongs to another enabled IK constraint.`);
            writers.set(boneId, constraint.id);
        }
    }
    const dependencies = new Map<string, Set<string>>();
    for(const constraint of enabled) {
        const readBones = new Set([...ancestors(constraint.upperBoneId), ...ancestors(constraint.targetBoneId)]);
        const required = new Set<string>();
        for(const boneId of readBones) {
            const writer = writers.get(boneId);
            if(writer && writer !== constraint.id) required.add(writer);
        }
        dependencies.set(constraint.id, required);
    }
    const ordered: TwoBoneIKConstraint[] = [], completed = new Set<string>();
    while(ordered.length < enabled.length) {
        // Lexical IDs are stable across persistence, UI reordering and locale changes.
        const ready = enabled.filter(constraint => !completed.has(constraint.id)
            && [...dependencies.get(constraint.id)!].every(id => completed.has(id)))
            .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        if(!ready.length) return fail('IK target dependencies contain a cycle. Move a target outside the dependent chains.');
        for(const constraint of ready) {
            completed.add(constraint.id);
            ordered.push(constraint);
        }
    }
    return { ordered };
}
