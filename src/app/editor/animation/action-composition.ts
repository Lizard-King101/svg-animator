import { AnimationDocument, AnimationTrack, placementTiming } from '../objects/animation.object';

import { ActionTimeMapping } from '../../../../packages/runtime/src/composition.internal';

export interface ActionWindow<T> { timing?: ActionTimeMapping; start: number; end: number; track: T; }
export interface CompositionChannel { base: AnimationTrack; windows: ActionWindow<AnimationTrack>[]; }

/** Resolve links once per revision. Direct tracks remain the underlying scene contribution. */
export function compositionChannels(animation: AnimationDocument, baseValue: (track: AnimationTrack) => unknown): CompositionChannel[] {
    if(!animation.composition?.placements.length) return animation.tracks.filter(track => track.enabled !== false).map(base => ({ base, windows: [] }));
    const channels = new Map<string, CompositionChannel>();
    const key = (track: AnimationTrack) => JSON.stringify([track.targetId, track.property]);
    animation.tracks.filter(track => track.enabled !== false).forEach(track => channels.set(key(track), { base: track, windows: [] }));
    const composition = animation.composition;
    if(!composition) return [...channels.values()];
    const actions = new Map(composition.actions.map(action => [action.id, action]));
    [...composition.placements].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)).forEach(placement => {
        const action = actions.get(placement.actionId);
        if(!action) return;
        action.animation.tracks.filter(track => track.enabled !== false && track.keyframes.length && action.targetIds.includes(track.targetId)).forEach(track => {
            let channel = channels.get(key(track));
            if(!channel) {
                channel = { base: { ...track, id: `base:${track.id}`, keyframes: [{ id: 'base', time: 0, value: baseValue(track) }] }, windows: [] };
                channels.set(key(track), channel);
            }
            const timing = placementTiming(placement, action.animation.duration);
            channel.windows.push({ start: placement.start, end: placement.start + timing.duration, track,
                ...(placement.sourceStart !== undefined || placement.sourceEnd !== undefined || placement.rate !== undefined || placement.repeat !== undefined
                    ? { timing: { sourceStart: timing.sourceStart, sourceEnd: timing.sourceEnd, rate: timing.rate } } : {}) });
        });
    });
    return [...channels.values()];
}
