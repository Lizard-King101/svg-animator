import { AnimationTrack, EasingType, evaluateTrack } from '../objects/animation.object';
import { planKeyframeRetime, RetimeOperation, RetimePivot } from './keyframe-retiming';

describe('keyframe retiming', () => {
    function track(): AnimationTrack {
        return { id: 'x', targetId: 'shape', property: 'transform.translateX', valueType: 'number', keyframes: [
            { id: 'a', time: 1, value: 10, easing: { type: 'ease-in' } },
            { id: 'b', time: 2, value: 30, easing: { type: 'ease-out' } },
            { id: 'c', time: 3, value: -5 },
        ] };
    }
    const scale = (factor = 2, pivot: RetimePivot = 'start'): RetimeOperation => ({ kind: 'scale', factor, pivot, playhead: 0 });
    function retimed(source: AnimationTrack, operation: RetimeOperation, ids = source.keyframes.map(key => key.id)): AnimationTrack {
        const plan = planKeyframeRetime([source], new Set(ids), operation);
        expect(plan.problem).toBeUndefined();
        return { ...source, keyframes: plan.updates[0]?.keyframes ?? source.keyframes };
    }
    it('scales around start, center, end and playhead without touching the source', () => {
        const source = track(), before = JSON.stringify(source);
        expect(retimed(source, scale()).keyframes.map(key => key.time)).toEqual([1, 3, 5]);
        expect(retimed(source, scale(2, 'center')).keyframes.map(key => key.time)).toEqual([0, 2, 4]);
        expect(retimed(source, scale(2, 'end')).keyframes.map(key => key.time)).toEqual([-1, 1, 3]);
        expect(retimed(source, scale(2, 'playhead')).keyframes.map(key => key.time)).toEqual([2, 4, 6]);
        expect(JSON.stringify(source)).toBe(before);
    });
    for(const type of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as EasingType[]) {
        it(`preserves ${type} evaluation when stretching and reversing`, () => {
            const source = track(); source.keyframes[0].easing = { type };
            const stretched = retimed(source, scale()), reversed = retimed(source, { kind: 'reverse' });
            for(let i = 1; i < 40; i++) {
                const time = 1 + i / 20;
                expect(Number(evaluateTrack(stretched, 1 + (time - 1) * 2))).toBeCloseTo(Number(evaluateTrack(source, time)), 6);
                expect(Number(evaluateTrack(reversed, 4 - time))).toBeCloseTo(Number(evaluateTrack(source, time)), 6);
            }
        });
    }
    it('transforms signed speed and influence, including one-sided fallback handles', () => {
        const source = track();
        source.keyframes[0].temporal = { linked: false, out: { speed: -12, influence: .15 } };
        source.keyframes[1].temporal = { linked: false, in: { speed: 48, influence: .6 }, out: { speed: 9, influence: .2 } };
        const stretched = retimed(source, scale(.5)), reversed = retimed(source, { kind: 'reverse' });
        expect(stretched.keyframes[0].temporal?.out).toEqual({ speed: -24, influence: .15 });
        expect(reversed.keyframes[2].temporal?.in).toEqual({ speed: 12, influence: .15 });
        for(let i = 1; i < 40; i++) {
            const time = 1 + i / 20;
            // The evaluator solves time iteratively; duration scaling changes its absolute error.
            expect(Number(evaluateTrack(stretched, 1 + (time - 1) * .5))).toBeCloseTo(Number(evaluateTrack(source, time)), 4);
            expect(Number(evaluateTrack(reversed, 4 - time))).toBeCloseTo(Number(evaluateTrack(source, time)), 4);
        }
    });
    it('keeps outside easing attached to range edges and scales neighboring temporal speeds', () => {
        const source = track();
        source.keyframes.unshift({ id: 'before', time: -1, value: 0, easing: { type: 'ease-in-out' }, temporal: { linked: false, out: { speed: 20, influence: .4 } } });
        source.keyframes.push({ id: 'after', time: 6, value: 10 });
        source.keyframes[3].easing = { type: 'hold' };
        const reversed = retimed(source, { kind: 'reverse' }, ['a', 'b', 'c']);
        expect(reversed.keyframes.map(key => key.id)).toEqual(['before', 'c', 'b', 'a', 'after']);
        expect(reversed.keyframes[0].easing?.type).toBe('ease-in-out');
        expect(reversed.keyframes[3].easing?.type).toBe('hold');
        const stretched = retimed(source, scale(2, 'end'), ['a', 'b']);
        expect(stretched.keyframes[0].temporal?.out?.speed).toBe(40);
    });
    it('reverses hold and discrete keys as stepped sequences', () => {
        const source = track(); source.keyframes[0].easing = { type: 'hold' };
        const reversed = retimed(source, { kind: 'reverse' });
        expect(evaluateTrack(reversed, 2.5)).toBe(30);
        source.valueType = 'boolean'; source.keyframes.forEach((key, i) => key.value = i === 1);
        expect(evaluateTrack(retimed(source, { kind: 'reverse' }), 1.5)).toBeFalse();
    });
    it('rejects sparse selections, zero spans, invalid factors and quantized collisions atomically', () => {
        const source = track(), before = JSON.stringify(source);
        for(const [ids, operation] of [
            [['a', 'c'], scale()], [['a'], scale()], [['a', 'b', 'c'], scale(0)],
            [['a', 'b', 'c'], scale(NaN)], [['a', 'b', 'c'], scale(.001)], [['a', 'b'], scale(3)],
        ] as [string[], RetimeOperation][]) {
            const plan = planKeyframeRetime([source], new Set(ids), operation);
            expect(plan.problem).toBeTruthy(); expect(plan.updates).toEqual([]);
        }
        expect(JSON.stringify(source)).toBe(before);
        expect(planKeyframeRetime([source], new Set(['a', 'b', 'c']), scale(1)).updates).toEqual([]);
    });
    it('rejects a multi-track edit entirely if any channel collides or has a linked endpoint', () => {
        const first = track(), second = track(); second.id = 'y'; second.keyframes.forEach(key => key.id += 'y');
        second.keyframes.push({ id: 'd', time: 4, value: 0 });
        const selected = new Set(['a', 'b', 'c', 'ay', 'by', 'cy']);
        expect(planKeyframeRetime([first, second], selected, scale()).updates).toEqual([]);
        second.keyframes.pop(); second.loopSeam = { startKeyId: 'ay', endKeyId: 'cy', smooth: false };
        expect(planKeyframeRetime([first, second], selected, { kind: 'reverse' }).problem).toContain('Unlink');
    });
    it('protects matched seam speed when retiming interior keys', () => {
        const source = track();
        source.keyframes.push({ id: 'd', time: 4, value: 10, temporal: { linked: false, in: { speed: 2, influence: .3 } } });
        source.keyframes[0].temporal = { linked: false, out: { speed: 2, influence: .3 } };
        source.loopSeam = { startKeyId: 'a', endKeyId: 'd', smooth: true };
        expect(planKeyframeRetime([source], new Set(['b', 'c']), scale(.5)).problem).toContain('matched seam');
    });
});
