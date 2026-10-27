import { AnimationDocument, AnimationTrack, Keyframe, evaluateTrack, makeAnimationId, temporalTangentsForPreset } from '../objects/animation.object';

export function loopEndpoints(track: AnimationTrack): { start: Keyframe; end: Keyframe } | undefined {
    const seam = track.loopSeam;
    const start = track.keyframes.find(key => key.id === seam?.startKeyId);
    const end = track.keyframes.find(key => key.id === seam?.endKeyId);
    return start && end && start.time < end.time ? { start, end } : undefined;
}

/** Establish a value link using an explicitly chosen boundary as the source. */
export function linkLoopSeam(track: AnimationTrack, start: number, end: number, source: 'start' | 'end', smooth: boolean): void {
    if(!Number.isFinite(start) || !Number.isFinite(end) || end - start < .001 || !track.keyframes.length) return;
    const value = structuredClone(evaluateTrack({ ...track, enabled: true }, source === 'start' ? start : end));
    const boundary = (time: number): Keyframe => {
        let key = track.keyframes.find(key => Math.abs(key.time - time) < .0005);
        if(!key) { key = { id: makeAnimationId('key'), time, value: structuredClone(value) }; track.keyframes.push(key); }
        key.value = structuredClone(value);
        return key;
    };
    const first = boundary(start), last = boundary(end);
    track.keyframes.sort((a,b) => a.time - b.time);
    track.loopSeam = { startKeyId: first.id, endKeyId: last.id, smooth: smooth && track.valueType === 'number' };
    syncLoopSeam(track, undefined, source === 'start' ? first.id : last.id);
}

function seamHandle(track: AnimationTrack, key: Keyframe, side: 'in' | 'out') {
    const index = track.keyframes.indexOf(key);
    const from = side === 'out' ? key : track.keyframes[index - 1];
    const to = side === 'in' ? key : track.keyframes[index + 1];
    if(!from || !to || from.easing?.type === 'hold') return undefined;
    const preset = temporalTangentsForPreset(from.easing, Number(from.value), Number(to.value), to.time - from.time);
    // Preserve the other end's preset when converting a segment to temporal handles.
    from.temporal ??= { linked: false };
    to.temporal ??= { linked: false };
    from.temporal.out ??= { ...preset.out };
    to.temporal.in ??= { ...preset.in };
    return side === 'out' ? from.temporal.out : to.temporal.in;
}

/** All authoring paths share this reconciliation; deletion breaks the relationship. */
export function syncLoopSeam(track: AnimationTrack, previous?: AnimationTrack, editedKeyId?: string): void {
    const pair = loopEndpoints(track);
    if(!pair) { delete track.loopSeam; return; }
    const old = previous && loopEndpoints(previous);
    const changed = (value: unknown, before: unknown) => JSON.stringify(value) !== JSON.stringify(before);
    const endEdited = editedKeyId ? editedKeyId === pair.end.id
        : !!old && changed(pair.end.value, old.end.value) && !changed(pair.start.value, old.start.value);
    if(changed(pair.start.value, pair.end.value)) {
        if(endEdited) pair.start.value = structuredClone(pair.end.value);
        else pair.end.value = structuredClone(pair.start.value);
    }
    if(!track.loopSeam?.smooth || track.valueType !== 'number') return;
    const endSpeedEdited = editedKeyId ? editedKeyId === pair.end.id
        : !!old && changed(pair.end.temporal?.in?.speed, old.end.temporal?.in?.speed)
            && !changed(pair.start.temporal?.out?.speed, old.start.temporal?.out?.speed);
    const out = seamHandle(track, pair.start, 'out'), incoming = seamHandle(track, pair.end, 'in');
    if(!out || !incoming) return;
    if(endSpeedEdited) out.speed = incoming.speed;
    else incoming.speed = out.speed;
}

export function syncDocumentLoopSeams(animation: AnimationDocument, previous?: AnimationDocument): void {
    for(const track of animation.tracks) if(track.loopSeam) syncLoopSeam(track, previous?.tracks.find(old => old.id === track.id));
    for(const action of animation.composition?.actions ?? []) {
        syncDocumentLoopSeams(action.animation, previous?.composition?.actions.find(old => old.id === action.id)?.animation);
    }
}

/** Duplicated channels retain independent links using their newly assigned key IDs. */
export function remapLoopSeam(track: AnimationTrack, ids: ReadonlyMap<string, string>): void {
    if(!track.loopSeam) return;
    const startKeyId = ids.get(track.loopSeam.startKeyId), endKeyId = ids.get(track.loopSeam.endKeyId);
    if(startKeyId && endKeyId) track.loopSeam = { ...track.loopSeam, startKeyId, endKeyId };
    else delete track.loopSeam;
}
