import { ClipScheduleCache, compileClipSchedule } from './clip-schedule';

const ref = (id: string, clipId?: string) => ({ id, clipId });

describe('clip texture lifetime schedule', () => {
    it('uses two textures for ten independent nested rigs without changing paint order', () => {
        const clips = Array.from({ length: 10 }, (_, i) => [ref(`outer${i}`), ref(`inner${i}`, `outer${i}`)]).flat();
        const draws = Array.from({ length: 10 }, (_, i) => ref(`shape${i}`, `inner${i}`));
        const plan = compileClipSchedule(draws, clips);
        expect(plan.slotCount).toBe(2);
        expect(plan.operations.filter(op => op.kind === 'paint').map(op => op.start)).toEqual(Array.from({ length: 10 }, (_, i) => i));
        expect(1380 * 1104 * 16 * plan.slotCount).toBe(48752640);
    });
    it('never overwrites a parent while its child samples it', () => {
        const clips = Array.from({ length: 16 }, (_, i) => ref(`c${i}`, i ? `c${i - 1}` : undefined));
        const plan = compileClipSchedule([ref('leaf', 'c15')], clips);
        expect(plan.slotCount).toBe(2);
        for(let i = 1; i < clips.length; i++) expect(plan.slots.get(`c${i}`)).not.toBe(plan.slots.get(`c${i - 1}`));
    });
    it('retains a parent and previous sibling through later noncontiguous draws', () => {
        const plan = compileClipSchedule([ref('a', 'childA'), ref('b', 'childB'), ref('c', 'childA'), ref('d', 'root')],
            [ref('root'), ref('childA', 'root'), ref('childB', 'root')]);
        expect(plan.slotCount).toBe(3);
        expect(new Set(plan.slots.values()).size).toBe(3);
        expect(plan.operations.filter(op => op.kind === 'mask').length).toBe(3);
    });
    it('ignores unused masks and still clears an empty scene', () => {
        expect(compileClipSchedule([], [ref('unused')])).toEqual({ operations: [{ kind: 'paint', start: 0, end: 0 }], slots: new Map(), slotCount: 0 });
        expect(compileClipSchedule([ref('plain')], [ref('unused')]).slotCount).toBe(0);
    });
    it('reuses plans across pose changes but detects mutable topology replacement', () => {
        const cache = new ClipScheduleCache(), clips = [ref('root'), ref('child', 'root')], draws = [ref('a', 'child')];
        const first = cache.get(draws, clips);
        expect(cache.get([{ ...draws[0], id: 'new-artwork' }], clips.map(c => ({ ...c })))).toBe(first);
        draws[0].clipId = 'root'; const second = cache.get(draws, clips); expect(second).not.toBe(first);
        clips[1].clipId = undefined; expect(cache.get(draws, clips)).not.toBe(second);
        expect(cache.get([], []).slotCount).toBe(0);
    });
    it('rejects missing and cyclic dependencies', () => {
        expect(() => compileClipSchedule([ref('a', 'missing')], [])).toThrowError(/dependency/);
        expect(() => compileClipSchedule([ref('a', 'cycle')], [ref('cycle', 'cycle')])).toThrowError(/dependency/);
    });
    it('keeps every sampled mask live for varied shared trees and arbitrary paint order', () => {
        let seed = 7823;
        const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
        for(let trial = 0; trial < 100; trial++) {
            const clips = Array.from({ length: 30 }, (_, i) => ref(`c${i}`, i && random(3) ? `c${random(i)}` : undefined));
            const draws = Array.from({ length: 80 }, (_, i) => ref(`d${i}`, random(5) ? `c${random(30)}` : undefined));
            const plan = compileClipSchedule(draws, clips), contents = new Map<number, string>();
            let nextDraw = 0;
            for(const operation of plan.operations) {
                if(operation.kind === 'mask') {
                    const clip = clips[operation.index], slot = plan.slots.get(clip.id)!;
                    if(clip.clipId !== undefined) {
                        expect(contents.get(plan.slots.get(clip.clipId)!)).toBe(clip.clipId);
                        expect(slot).not.toBe(plan.slots.get(clip.clipId)!);
                    }
                    contents.set(slot, clip.id);
                } else {
                    expect(operation.start).toBe(nextDraw);
                    for(; nextDraw < operation.end; nextDraw++) {
                        const id = draws[nextDraw].clipId;
                        if(id !== undefined) expect(contents.get(plan.slots.get(id)!)).toBe(id);
                    }
                }
            }
            expect(nextDraw).toBe(draws.length);
        }
    });
});
