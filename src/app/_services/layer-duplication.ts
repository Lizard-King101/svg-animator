import { AnimationTrack, makeAnimationId } from '../editor/objects/animation.object';
import { matchingAnimationProperty, parsePathPointProperty, pathPointAnimationProperty } from '../editor/objects/animation-targets';
import { Armature, BoundPoint, PathBinding, RigidAttachment, WeightPointRef, weightOwner } from '../editor/objects/armature';
import { ElementCloneSelection } from './element-factory.service';

/** Clone artwork channels only; armature channels and reusable sources remain shared. */
export function duplicateArtworkTracks(tracks: readonly AnimationTrack[], copies: ElementCloneSelection): AnimationTrack[] {
    return tracks.flatMap(track => {
        const pair = copies.elements.get(track.targetId);
        if(!pair) return [];
        const point = parsePathPointProperty(track.property);
        const pointId = point && copies.ids.get(point.pointId);
        const property = point && pointId ? pathPointAnimationProperty(pointId, point.axis)
            : matchingAnimationProperty(pair.original, pair.duplicate, track.property);
        if(!property) return [];
        return [{
            ...structuredClone(track), id: makeAnimationId('track'), targetId: pair.duplicate.id, property,
            keyframes: track.keyframes.map(key => ({
                ...structuredClone(key), id: makeAnimationId('key'),
                value: track.property === 'motion.pathId' && typeof key.value === 'string'
                    ? copies.ids.get(key.value) ?? key.value : structuredClone(key.value),
            })),
        }];
    });
}

export interface DuplicatedRigArtwork { bindings: PathBinding[]; attachments: RigidAttachment[]; }

/** Prepare all references before inserting anything, so shared groups can span selected roots. */
export function duplicateRigArtwork(rig: Armature, copies: ElementCloneSelection): DuplicatedRigArtwork {
    const sourceBindings = rig.bindings.filter(binding => copies.elements.has(binding.pathId));
    const mappedRef = (ref: WeightPointRef): WeightPointRef => ({ pathId: copies.ids.get(ref.pathId)!, pointId: copies.ids.get(ref.pointId)! });
    const key = (ref: WeightPointRef) => JSON.stringify([ref.pathId, ref.pointId]);
    const owners = new Map<string, WeightPointRef>();
    const ownCapable = (point: BoundPoint) => point.id === point.anchorId || point.independent;
    for(const binding of sourceBindings) for(const point of binding.points.filter(ownCapable)) {
        const owner = weightOwner(rig, binding.pathId, point.id);
        if(!owners.has(key(owner))) owners.set(key(owner), copies.elements.has(owner.pathId)
            ? mappedRef(owner) : mappedRef({ pathId: binding.pathId, pointId: point.id }));
    }
    const bindings = sourceBindings.map(binding => {
        const pathId = copies.ids.get(binding.pathId)!;
        return {
            ...structuredClone(binding), pathId,
            ...(binding.scopeId ? { scopeId: copies.ids.get(binding.scopeId) ?? pathId } : {}),
            // Keep a pre-existing stale topology stale instead of silently repairing it.
            topology: remapTopology(binding.topology, copies.ids),
            points: binding.points.map(point => {
                const copy = { ...structuredClone(point), id: copies.ids.get(point.id)!, anchorId: copies.ids.get(point.anchorId)! };
                delete copy.weightSource;
                delete copy.lockedBoneIds;
                copy.weights = [];
                if(!ownCapable(point)) return copy;
                const owner = weightOwner(rig, binding.pathId, point.id);
                const copiedOwner = owners.get(key(owner))!;
                if(copiedOwner.pathId === pathId && copiedOwner.pointId === copy.id) {
                    const source = rig.bindings.find(value => value.pathId === owner.pathId)!.points.find(value => value.id === owner.pointId)!;
                    copy.weights = structuredClone(source.weights);
                    if(source.lockedBoneIds) copy.lockedBoneIds = [...source.lockedBoneIds];
                } else copy.weightSource = { ...copiedOwner };
                return copy;
            }),
        };
    });
    const attachments = (rig.attachments ?? []).filter(attachment => copies.elements.has(attachment.elementId))
        .map(attachment => ({ ...structuredClone(attachment), elementId: copies.ids.get(attachment.elementId)! }));
    return { bindings, attachments };
}

function remapTopology(topology: string, ids: ReadonlyMap<string, string>): string {
    const visit = (value: unknown): unknown => Array.isArray(value) ? value.map(visit)
        : typeof value === 'string' ? ids.get(value) ?? value : value;
    try { return JSON.stringify(visit(JSON.parse(topology))); }
    catch { return topology; }
}
