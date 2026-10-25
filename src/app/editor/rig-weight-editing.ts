import { Armature, boneMatrices, BoneWeight, effectivePointWeights, PathBinding, WeightPointRef, weightOwner, weightOwnerLocks } from './objects/armature';
import { applyMatrix } from './objects/transform.object';
import { weightMembers } from './rig-point-weights';
import type { WeightUpdate } from './rig-weight-commands';
import { pointSegmentDistance } from './point-segment-distance';

export type BindingWeightMode = 'unbound' | 'rigid' | 'weighted' | 'custom';
export interface PointWeightState { ref: WeightPointRef; weights: BoneWeight[]; boneIds: string[]; lockedBoneIds: string[]; rigid: boolean; }
const keyOf = (ref: WeightPointRef) => JSON.stringify([ref.pathId, ref.pointId]);
const valueOf = (weights: readonly BoneWeight[], boneId: string) => weights.find(weight => weight.boneId === boneId)?.weight ?? 0;

/** Explicit assignment membership counts even when an assigned influence is currently zero. */
export function bindingBoneIds(rig: Armature, binding: PathBinding): string[] {
    return binding.boneIds?.slice() ?? [...new Set(binding.points.flatMap(point => effectivePointWeights(rig, binding, point).map(weight => weight.boneId)))];
}

export function bindingWeightMode(rig: Armature, bindings: readonly PathBinding[]): BindingWeightMode {
    if(!bindings.length) return 'unbound';
    if(bindings.some(binding => !binding.boneIds)) return 'custom';
    const ids = [...new Set(bindings.flatMap(binding => bindingBoneIds(rig, binding)))];
    if(ids.length > 1) return 'weighted';
    if(ids.length === 1 && bindings.every(binding => binding.points.every(point => {
        const weights = effectivePointWeights(rig, binding, point);
        return weights.length === 1 && weights[0].boneId === ids[0] && weights[0].weight === 1;
    }))) return 'rigid';
    return 'custom';
}

/** Intersect all member memberships so a shared edit remains valid on every bound path. */
export function pointWeightState(rig: Armature, ref: WeightPointRef): PointWeightState {
    const owner = weightOwner(rig, ref.pathId, ref.pointId), members = weightMembers(rig, owner);
    const bindings = [...new Set(members.map(member => rig.bindings.find(binding => binding.pathId === member.pathId)!))];
    const ownerBinding = rig.bindings.find(binding => binding.pathId === owner.pathId)!;
    const point = ownerBinding.points.find(point => point.id === owner.pointId)!;
    const boneIds = rig.bones.map(bone => bone.id).filter(id => bindings.every(binding => !binding.boneIds || binding.boneIds.includes(id)));
    return { ref: owner, weights: point.weights.map(weight => ({ ...weight })), boneIds,
        lockedBoneIds: [...weightOwnerLocks(rig, owner)], rigid: bindings.every(binding => bindingWeightMode(rig, [binding]) === 'rigid') };
}

/** One normalization rule for numeric edits, painting and automatic assignment. */
export function editWeightInfluence(weights: readonly BoneWeight[], boneId: string, value: number, allowedIds: readonly string[], lockedIds: readonly string[] = []): BoneWeight[] {
    if(!Number.isFinite(value) || value < 0 || value > 1) throw new Error('An influence must be between zero and one.');
    const ids = [...new Set(allowedIds)], locks = new Set(lockedIds);
    if(!ids.includes(boneId)) throw new Error('This bone is not assigned to every member of the shared point group.');
    if(lockedIds.some(id => !ids.includes(id))) throw new Error('A locked influence is outside the assigned bones.');
    if(locks.has(boneId) || valueOf(weights, boneId) === value) return weights.map(weight => ({ ...weight }));
    const locked = weights.filter(weight => locks.has(weight.boneId)).map(weight => ({ ...weight }));
    const budget = Math.max(0, 1 - locked.reduce((sum, weight) => sum + weight.weight, 0));
    const others = ids.filter(id => id !== boneId && !locks.has(id));
    const next = others.length ? Math.min(value, budget) : budget;
    const rest = budget - next, total = others.reduce((sum, id) => sum + valueOf(weights, id), 0);
    const values = new Map(locked.map(weight => [weight.boneId, weight.weight]));
    values.set(boneId, next);
    others.forEach(id => values.set(id, rest * (total ? valueOf(weights, id) / total : 1 / others.length)));
    return orderedWeights(weights, ids, values);
}

/** Rest-space nearest two bones; shared owners and inherited handles are evaluated only once. */
export function automaticWeightUpdates(rig: Armature, refs: readonly WeightPointRef[]): WeightUpdate[] {
    const matrices = boneMatrices(rig, false), seen = new Set<string>(), updates: WeightUpdate[] = [];
    for(const ref of refs) {
        const state = pointWeightState(rig, ref), key = keyOf(state.ref);
        if(seen.has(key)) continue;
        seen.add(key);
        const binding = rig.bindings.find(binding => binding.pathId === state.ref.pathId)!;
        const point = binding.points.find(point => point.id === state.ref.pointId)!;
        const world = applyMatrix(binding.matrix, point.x, point.y), locks = new Set(state.lockedBoneIds);
        const locked = state.weights.filter(weight => locks.has(weight.boneId));
        const budget = Math.max(0, 1 - locked.reduce((sum, weight) => sum + weight.weight, 0));
        const candidates = rig.bones.filter(bone => state.boneIds.includes(bone.id) && !locks.has(bone.id)).map(bone => {
            const matrix = matrices.get(bone.id)!, start = applyMatrix(matrix, 0, 0), end = applyMatrix(matrix, bone.length, 0);
            return { id: bone.id, distance: pointSegmentDistance(world, start, end) };
        }).sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 2);
        if(!candidates.length) { updates.push({ ...state.ref, weights: state.weights }); continue; }
        const zeros = candidates.filter(candidate => candidate.distance === 0);
        const selected = zeros.length ? zeros : candidates;
        // Ratios avoid overflow when a point is extremely close to a segment.
        const ratios = selected.map(candidate => zeros.length ? 1 : (selected[0].distance / candidate.distance) ** 2);
        const total = ratios.reduce((sum, ratio) => sum + ratio, 0), values = new Map(locked.map(weight => [weight.boneId, weight.weight]));
        selected.forEach((candidate, index) => values.set(candidate.id, budget * ratios[index] / total));
        updates.push({ ...state.ref, weights: orderedWeights(state.weights, state.boneIds, values) });
    }
    return updates;
}

function orderedWeights(previous: readonly BoneWeight[], ids: readonly string[], values: ReadonlyMap<string, number>): BoneWeight[] {
    return [...new Set([...previous.map(weight => weight.boneId), ...ids])].flatMap(boneId => {
        const weight = values.get(boneId) ?? 0;
        return weight > 0 ? [{ boneId, weight }] : [];
    });
}

