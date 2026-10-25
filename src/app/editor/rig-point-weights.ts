import { Armature, BoundPoint, effectivePointWeights, WeightPointRef, weightOwner, weightOwnerLocks } from './objects/armature';
import { applyMatrix } from './objects/transform.object';

const sameRef = (a: WeightPointRef, b: WeightPointRef): boolean => a.pathId === b.pathId && a.pointId === b.pointId;
const ownCapable = (point: BoundPoint): boolean => point.id === point.anchorId || point.independent === true;
const pointAt = (rig: Armature, ref: WeightPointRef): BoundPoint => {
    const point = rig.bindings.find(binding => binding.pathId === ref.pathId)?.points.find(point => point.id === ref.pointId);
    if(!point) throw new Error('A bound point is missing.');
    return point;
};

/** Includes inherited handles so the UI can explain every point affected by one edit. */
export function weightMembers(rig: Armature, ref: WeightPointRef): WeightPointRef[] {
    const owner = weightOwner(rig, ref.pathId, ref.pointId);
    return rig.bindings.flatMap(binding => binding.points.filter(point => sameRef(weightOwner(rig, binding.pathId, point.id), owner))
        .map(point => ({ pathId: binding.pathId, pointId: point.id })));
}

/** Explicit setup operation: exact document-space rest positions, never current pose or rounded proximity. */
export function linkCoincidentWeights(rig: Armature, pathIds: readonly string[]): Armature {
    const candidate = structuredClone(rig), selected = new Set(pathIds);
    const positions = new Map<string, WeightPointRef[]>();
    for(const binding of candidate.bindings.filter(binding => selected.has(binding.pathId))) {
        for(const point of binding.points.filter(ownCapable)) {
            const world = applyMatrix(binding.matrix, point.x, point.y);
            const key = JSON.stringify([world.x, world.y]);
            const refs = positions.get(key) ?? [];
            refs.push({ pathId: binding.pathId, pointId: point.id }); positions.set(key, refs);
        }
    }
    for(const refs of positions.values()) {
        if(refs.length < 2) continue;
        const owner = weightOwner(candidate, refs[0].pathId, refs[0].pointId);
        const weights = pointAt(candidate, owner).weights;
        const locks = new Set(pointAt(candidate, owner).lockedBoneIds ?? []);
        const affected = new Set(weightMembers(candidate, owner).map(ref => ref.pathId));
        for(const ref of refs.slice(1)) {
            const prior = weightOwner(candidate, ref.pathId, ref.pointId);
            if(sameRef(prior, owner)) continue;
            const previous = pointAt(candidate, prior);
            for(const boneId of previous.lockedBoneIds ?? []) {
                if((previous.weights.find(weight => weight.boneId === boneId)?.weight ?? 0) !== (weights.find(weight => weight.boneId === boneId)?.weight ?? 0)) throw new Error('Unlock conflicting weights before joining these points.');
                locks.add(boneId);
            }
            // Existing shared sets remain shared when their owners are joined.
            const members = weightMembers(candidate, prior);
            for(const member of members) {
                affected.add(member.pathId);
                const point = pointAt(candidate, member);
                if(ownCapable(point)) { point.weights = []; point.weightSource = { ...owner }; delete point.lockedBoneIds; }
            }
        }
        const bindings = candidate.bindings.filter(binding => affected.has(binding.pathId));
        const boneIds = [...new Set(bindings.flatMap(binding => binding.boneIds ?? candidate.bones.map(bone => bone.id)).concat(weights.map(weight => weight.boneId)))];
        bindings.forEach(binding => { binding.boneIds = [...boneIds]; });
        if(locks.size) pointAt(candidate, owner).lockedBoneIds = [...locks];
    }
    return candidate;
}

/** Split one explicit point from its shared set without changing anyone's effective weights. */
export function unlinkPointWeights(rig: Armature, pathId: string, pointId: string): Armature {
    const candidate = structuredClone(rig), ref = { pathId, pointId }, point = pointAt(candidate, ref);
    if(!ownCapable(point)) return candidate;
    const owner = weightOwner(candidate, pathId, pointId), weights = structuredClone(pointAt(candidate, owner).weights), locks = [...weightOwnerLocks(candidate, ref)];
    if(sameRef(ref, owner)) rehomeOwner(candidate, owner, member => !sameRef(member, ref));
    delete point.weightSource; point.weights = weights;
    if(locks.length) point.lockedBoneIds = locks; else delete point.lockedBoneIds;
    return candidate;
}

/** Enabling starts from the inherited values; disabling intentionally restores anchor inheritance. */
export function setPointIndependent(rig: Armature, pathId: string, pointId: string, independent: boolean): Armature {
    const binding = rig.bindings.find(binding => binding.pathId === pathId);
    const source = binding?.points.find(point => point.id === pointId);
    if(!binding || !source) throw new Error('A bound point is missing.');
    if(source.id === source.anchorId) return structuredClone(rig);
    const weights = structuredClone(effectivePointWeights(rig, binding, source));
    const locks = [...weightOwnerLocks(rig, { pathId, pointId })];
    const candidate = source.independent && !independent ? unlinkPointWeights(rig, pathId, pointId) : structuredClone(rig);
    const point = pointAt(candidate, { pathId, pointId });
    if(independent) {
        if(!point.independent) { point.independent = true; point.weights = weights; if(locks.length) point.lockedBoneIds = locks; }
    } else {
        const anchorOwner = weightOwner(candidate, pathId, source.anchorId), anchor = pointAt(candidate, anchorOwner);
        for(const boneId of locks) {
            if((weights.find(weight => weight.boneId === boneId)?.weight ?? 0) !== (anchor.weights.find(weight => weight.boneId === boneId)?.weight ?? 0)) throw new Error('Unlock conflicting weights before restoring anchor inheritance.');
            if(weightMembers(candidate, anchorOwner).some(member => {
                const memberBinding = candidate.bindings.find(binding => binding.pathId === member.pathId)!;
                return memberBinding.boneIds && !memberBinding.boneIds.includes(boneId);
            })) throw new Error('The anchor group does not allow a locked handle influence.');
        }
        if(locks.length) anchor.lockedBoneIds = [...new Set([...(anchor.lockedBoneIds ?? []), ...locks])];
        delete point.independent; delete point.weightSource; delete point.lockedBoneIds; point.weights = [];
    }
    return candidate;
}

/** Remove bindings atomically, moving any shared owner to a surviving member first. */
export function detachBindingWeights(rig: Armature, pathIds: readonly string[]): Armature {
    const candidate = structuredClone(rig), removed = new Set(pathIds);
    for(const binding of candidate.bindings.filter(binding => removed.has(binding.pathId))) {
        for(const point of binding.points.filter(point => ownCapable(point) && !point.weightSource)) {
            rehomeOwner(candidate, { pathId: binding.pathId, pointId: point.id }, ref => !removed.has(ref.pathId));
        }
    }
    candidate.bindings = candidate.bindings.filter(binding => !removed.has(binding.pathId));
    return candidate;
}

function rehomeOwner(rig: Armature, owner: WeightPointRef, keep: (ref: WeightPointRef) => boolean): void {
    const members = weightMembers(rig, owner).filter(ref => keep(ref) && ownCapable(pointAt(rig, ref)));
    if(!members.length) return;
    const next = members[0], weights = structuredClone(pointAt(rig, owner).weights), locks = [...weightOwnerLocks(rig, owner)];
    const nextPoint = pointAt(rig, next); delete nextPoint.weightSource; nextPoint.weights = weights;
    if(locks.length) nextPoint.lockedBoneIds = locks; else delete nextPoint.lockedBoneIds;
    for(const ref of members.slice(1)) {
        const point = pointAt(rig, ref); point.weightSource = { ...next }; point.weights = []; delete point.lockedBoneIds;
    }
}
