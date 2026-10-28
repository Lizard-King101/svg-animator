import type { PolygonDraw } from './polygon-scene';

type ClipReference = Pick<PolygonDraw, 'id' | 'clipId'>;
export type ClipOperation = { kind: 'mask'; index: number } | { kind: 'paint'; start: number; end: number };
export interface ClipSchedule {
    readonly operations: readonly ClipOperation[];
    readonly slots: ReadonlyMap<string, number>;
    readonly slotCount: number;
}

/** Compile validated, parent-first clip references into painter-ordered passes.
 * Masks are produced once, immediately before first use. A physical texture can
 * be reused only AFTER its last sampling pass, never by its own child pass.
 * Geometry, colors and transforms are deliberately absent from this plan.
 */
export function compileClipSchedule(draws: readonly ClipReference[], clips: readonly ClipReference[]): ClipSchedule {
    const indexes = new Map(clips.map((clip, index) => [clip.id, index]));
    const emitted = new Set<string>(), visiting = new Set<string>();
    const operations: ClipOperation[] = [];
    const emit = (id: string): void => {
        if(emitted.has(id)) return;
        const index = indexes.get(id);
        if(index === undefined || visiting.has(id)) throw new Error('Invalid clip dependency.');
        visiting.add(id);
        const parent = clips[index].clipId;
        if(parent !== undefined) emit(parent);
        visiting.delete(id); emitted.add(id);
        operations.push({ kind: 'mask', index });
    };
    for(let index = 0; index < draws.length; index++) {
        const clipId = draws[index].clipId;
        if(clipId !== undefined) emit(clipId);
        const previous = operations.at(-1);
        if(previous?.kind === 'paint') previous.end = index + 1;
        else operations.push({ kind: 'paint', start: index, end: index + 1 });
    }
    // Even an empty scene must clear the previous canvas contents.
    if(!operations.length) operations.push({ kind: 'paint', start: 0, end: 0 });
    const lastUse = new Map<string, number>();
    operations.forEach((operation, index) => {
        if(operation.kind === 'mask') {
            const parent = clips[operation.index].clipId;
            if(parent !== undefined) lastUse.set(parent, index);
        } else for(let draw = operation.start; draw < operation.end; draw++) {
            const id = draws[draw].clipId;
            if(id !== undefined) lastUse.set(id, index);
        }
    });
    const releases = new Map<number, string[]>();
    for(const [id, index] of lastUse) releases.set(index, [...(releases.get(index) ?? []), id]);
    const slots = new Map<string, number>(), free: number[] = [];
    let slotCount = 0;
    operations.forEach((operation, index) => {
        if(operation.kind === 'mask') slots.set(clips[operation.index].id, free.pop() ?? slotCount++);
        for(const id of releases.get(index) ?? []) free.push(slots.get(id)!);
    });
    return { operations, slots, slotCount };
}

/** Own a topology snapshot, rather than retaining mutable caller references. */
export class ClipScheduleCache {
    private draws: (string | undefined)[] = [];
    private clips: ClipReference[] = [];
    private schedule?: ClipSchedule;
    get(draws: readonly ClipReference[], clips: readonly ClipReference[]): ClipSchedule {
        if(!this.schedule || draws.length !== this.draws.length || clips.length !== this.clips.length
            || draws.some((draw, index) => draw.clipId !== this.draws[index])
            || clips.some((clip, index) => clip.id !== this.clips[index].id || clip.clipId !== this.clips[index].clipId)) {
            this.schedule = compileClipSchedule(draws, clips);
            this.draws = draws.map(draw => draw.clipId);
            this.clips = clips.map(({ id, clipId }) => ({ id, clipId }));
        }
        return this.schedule;
    }
}
