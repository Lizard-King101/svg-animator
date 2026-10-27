import { Armature, BoneWeight, normalizeWeights, WeightPointRef, weightOwner } from './objects/armature';
import { weightMembers } from './rig-point-weights';
import { pointWeightState } from './rig-weight-editing';

export interface WeightUpdate extends WeightPointRef { weights: BoneWeight[]; }
const keyOf = (ref: WeightPointRef) => JSON.stringify([ref.pathId,ref.pointId]);
const pointAt = (rig: Armature, ref: WeightPointRef) => rig.bindings.find(binding => binding.pathId === ref.pathId)!.points.find(point => point.id === ref.pointId)!;
const equalWeights = (a: readonly BoneWeight[], b: readonly BoneWeight[]) => a.length === b.length && a.every(entry => b.some(other => entry.boneId === other.boneId && Math.abs(entry.weight-other.weight) < 1e-12));

/** Numeric and brush writes share canonical-owner resolution and semantic no-op handling. */
export function assignWeightUpdates(rig: Armature, updates: readonly WeightUpdate[]): Armature {
    const candidate = structuredClone(rig), owners = new Map<string, BoneWeight[]>();
    for(const update of updates) {
        const state = pointWeightState(candidate, update), owner = state.ref, key = keyOf(owner);
        for(const id of state.lockedBoneIds) if((update.weights.find(weight => weight.boneId === id)?.weight ?? 0) !== (state.weights.find(weight => weight.boneId === id)?.weight ?? 0)) throw new Error('Unlock this influence before changing its weight.');
        const weights = normalizedWithLocks(update.weights, state.boneIds, state.lockedBoneIds);
        if(weights.some(weight => !candidate.bones.some(bone => bone.id === weight.boneId))) throw new Error('A weight references a missing bone.');
        const prior = owners.get(key);
        if(prior && !equalWeights(prior,weights)) throw new Error('Shared points must receive one consistent weight value.');
        owners.set(key,weights);
        const point = pointAt(candidate,owner);
        if(!equalWeights(point.weights,weights)) point.weights = weights;
    }
    return candidate;
}

/** Retain unedited points on other paths while allowing their shared points to use new influences. */
export function changeScopeInfluences(rig: Armature, pathIds: readonly string[], boneIds: readonly string[]): Armature {
    const candidate = structuredClone(rig), paths = new Set(pathIds), ids = [...new Set(boneIds)];
    if(!ids.length || ids.some(id => !rig.bones.some(bone => bone.id === id))) throw new Error('Keep at least one valid influence, or unbind the artwork.');
    if(!paths.size || [...paths].some(id => !rig.bindings.some(binding => binding.pathId === id))) throw new Error('A scoped path is no longer bound.');
    const owners = new Map<string,WeightPointRef>();
    for(const binding of candidate.bindings.filter(binding => paths.has(binding.pathId))) {
        binding.boneIds = ids.slice();
        for(const point of binding.points) { const owner = weightOwner(candidate,binding.pathId,point.id); owners.set(keyOf(owner),owner); }
    }
    for(const owner of owners.values()) {
        const point = pointAt(candidate,owner), locks = point.lockedBoneIds ?? [];
        if(locks.some(id => !ids.includes(id))) throw new Error('Unlock an influence before removing its assigned bone.');
        if(ids.length === 1 && locks.some(id => (point.weights.find(weight => weight.boneId === id)?.weight ?? 0) !== 1)) throw new Error('Unlock conflicting weights before making this binding rigid.');
        const retained = point.weights.filter(weight => ids.includes(weight.boneId));
        const weights = ids.length === 1 ? [{ boneId: ids[0], weight: 1 }] : normalizedWithLocks(retained, ids, locks);
        if(!equalWeights(point.weights,weights)) point.weights = weights;
        for(const member of weightMembers(candidate,owner)) {
            const binding = candidate.bindings.find(binding => binding.pathId === member.pathId)!;
            if(!paths.has(binding.pathId) && binding.boneIds) binding.boneIds = [...new Set([...binding.boneIds,...ids])];
        }
    }
    return candidate;
}

/** Normalize only the editable budget; locked values must not drift during rounding. */
function normalizedWithLocks(weights: readonly BoneWeight[], ids: readonly string[], locks: readonly string[]): BoneWeight[] {
    if(weights.some(weight => !ids.includes(weight.boneId))) throw new Error('A weight uses a bone not assigned to every shared point.');
    const normalized = normalizeWeights(weights);
    if(!locks.length) return normalized;
    const locked = weights.filter(weight => locks.includes(weight.boneId)).map(weight => ({ ...weight }));
    const sum = locked.reduce((total, weight) => total + weight.weight, 0);
    if(sum > 1) throw new Error('Locked influences exceed the weight budget.');
    const unlocked = weights.filter(weight => !locks.includes(weight.boneId));
    const budget = 1 - sum, total = unlocked.reduce((sum, weight) => sum + weight.weight, 0);
    if(!weights.length) return [];
    if(!total && budget > 0) {
        const available = ids.filter(id => !locks.includes(id));
        if(!available.length) throw new Error('Unlock an influence to redistribute the remaining weight.');
        return [...locked, ...available.map(boneId => ({ boneId, weight: budget / available.length }))];
    }
    return [...locked, ...unlocked.map(weight => ({ ...weight, weight: total ? weight.weight / total * budget : 0 }))].filter(weight => weight.weight > 0);
}
