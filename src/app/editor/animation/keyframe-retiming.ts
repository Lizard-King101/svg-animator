import { AnimationTrack, EasingSpec, Keyframe, TemporalHandle } from '../objects/animation.object';

export type RetimePivot = 'start' | 'center' | 'end' | 'playhead';
export type RetimeOperation = { kind: 'scale'; factor: number; pivot: RetimePivot; playhead: number } | { kind: 'reverse' };
export interface RetimePlan { updates: { track: AnimationTrack; keyframes: Keyframe[] }[]; problem?: string; }

/** Plans an atomic edit without touching authored keys. Times use the timeline's 0.01s grid. */
export function planKeyframeRetime(tracks: readonly AnimationTrack[], selected: ReadonlySet<string>, operation: RetimeOperation): RetimePlan {
    const fail = (problem: string): RetimePlan => ({ updates: [], problem });
    const keys = tracks.flatMap(track => track.keyframes.filter(key => selected.has(key.id)));
    const start = Math.min(...keys.map(key => key.time)), end = Math.max(...keys.map(key => key.time));
    if(keys.length < 2 || end - start < .0005) return fail('Select keys at two or more different times.');
    if(operation.kind === 'scale' && (!Number.isFinite(operation.factor) || operation.factor <= 0 || !Number.isFinite(operation.playhead))) {
        return fail('Enter a positive, finite duration percentage.');
    }
    const pivot = operation.kind === 'reverse' ? (start + end) / 2
        : operation.pivot === 'start' ? start : operation.pivot === 'end' ? end
        : operation.pivot === 'center' ? (start + end) / 2 : operation.playhead;
    const factor = operation.kind === 'reverse' ? -1 : operation.factor;
    if(factor === 1) return { updates: [] };
    const updates: RetimePlan['updates'] = [];
    for(const track of tracks) {
        const original = [...track.keyframes].sort((a, b) => a.time - b.time);
        const indices = original.flatMap((key, index) => selected.has(key.id) ? [index] : []);
        if(!indices.length) continue;
        if(track.loopSeam && [track.loopSeam.startKeyId, track.loopSeam.endKeyId].some(id => selected.has(id))) {
            return fail('Unlink loop endpoints before retiming boundary keys.');
        }
        const first = indices[0], last = indices[indices.length - 1];
        if(last - first + 1 !== indices.length) return fail('Select a continuous block of keys on each channel.');
        const ordered = operation.kind === 'reverse'
            ? [...original.slice(0, first), ...original.slice(first, last + 1).reverse(), ...original.slice(last + 1)] : original;
        const next = ordered.map(key => ({ ...key,
            time: selected.has(key.id) ? Math.round((pivot + (key.time - pivot) * factor) * 100) / 100 : key.time,
            easing: key.easing ? { ...key.easing } : undefined,
            temporal: key.temporal ? { ...key.temporal, in: key.temporal.in ? { ...key.temporal.in } : undefined,
                out: key.temporal.out ? { ...key.temporal.out } : undefined } : undefined,
        }));
        if(next.some((key, i) => !Number.isFinite(key.time) || (i > 0 && key.time - next[i - 1].time < .0005))) {
            return fail('Retiming would overlap or cross neighboring keys. Use a smaller change or select those keys too.');
        }
        // Handles and easing belong to segments. Outside segments stay attached to the
        // range edges; inside segments reverse direction along with their endpoints.
        for(let i = 0; i < next.length - 1; i++) {
            const reversed = operation.kind === 'reverse' && i >= first && i < last;
            const oldIndex = reversed ? first + last - i - 1 : i;
            const from = original[oldIndex], to = original[oldIndex + 1];
            const ratio = (to.time - from.time) / (next[i + 1].time - next[i].time) * (reversed ? -1 : 1);
            next[i].easing = reverseEasing(from.easing, reversed);
            assignHandle(next[i], 'out', reversed ? to.temporal?.in : from.temporal?.out, ratio);
            assignHandle(next[i + 1], 'in', reversed ? from.temporal?.out : to.temporal?.in, ratio);
        }
        // Unused outer handles/presets are range-edge metadata, not reversed segments.
        next[next.length - 1].easing = original[original.length - 1].easing;
        assignHandle(next[0], 'in', original[0].temporal?.in, 1);
        assignHandle(next[next.length - 1], 'out', original[original.length - 1].temporal?.out, 1);
        next.forEach(key => {
            if(key.temporal?.in && key.temporal.out && Math.abs(key.temporal.in.speed - key.temporal.out.speed) > 1e-9) key.temporal.linked = false;
            if(key.temporal && !key.temporal.in && !key.temporal.out) key.temporal = undefined;
        });
        if(next.some(key => key.temporal && [key.temporal.in, key.temporal.out].some(handle => handle && !Number.isFinite(handle.speed)))) {
            return fail('Retiming would produce an invalid speed. Use a smaller change.');
        }
        if(track.loopSeam?.smooth) {
            const out = next.find(key => key.id === track.loopSeam!.startKeyId)?.temporal?.out;
            const incoming = next.find(key => key.id === track.loopSeam!.endKeyId)?.temporal?.in;
            if(out && incoming && Math.abs(out.speed - incoming.speed) > 1e-9) {
                return fail('Unlink loop endpoints before changing matched seam speeds.');
            }
        }
        if(original.some((key, i) => key.id !== next[i].id || key.time !== next[i].time)) updates.push({ track, keyframes: next });
    }
    return { updates };
}

function reverseEasing(easing: EasingSpec | undefined, reversed: boolean): EasingSpec | undefined {
    if(!easing) return undefined;
    const type = reversed && easing.type === 'ease-in' ? 'ease-out' : reversed && easing.type === 'ease-out' ? 'ease-in' : easing.type;
    return { type };
}

function assignHandle(key: Keyframe, side: 'in' | 'out', handle: TemporalHandle | undefined, ratio: number): void {
    if(handle) {
        key.temporal ??= { linked: false };
        key.temporal[side] = { influence: handle.influence, speed: handle.speed * ratio };
    } else if(key.temporal) delete key.temporal[side];
}
