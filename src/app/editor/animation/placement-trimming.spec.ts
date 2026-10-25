import { trimPlacement } from './placement-trimming';
import { placementTiming } from '../objects/animation.object';

describe('placement trimming', () => {
    const p = { id: 'p', actionId: 'a', start: 2, sourceStart: .2, sourceEnd: .8, rate: 2, repeat: 3 };
    it('trims each repetition while preserving the opposite scene edge', () => {
        const left = { ...p, ...trimPlacement(p, 1, 'in', 2.3) };
        expect(left.sourceStart).toBe(.4);
        expect(left.start + placementTiming(left, 1).duration).toBeCloseTo(p.start + placementTiming(p, 1).duration);
        const right = { ...p, ...trimPlacement(p, 1, 'out', 2.6) };
        expect(right.start).toBe(2); expect(right.sourceEnd).toBe(.6);
        expect(placementTiming(right, 1).duration).toBeCloseTo(.6);
    });
    it('clamps at source bounds, zero scene time and a nonempty trimmed interval', () => {
        expect(trimPlacement(p, 1, 'in', -100)?.sourceStart).toBe(0);
        expect(trimPlacement(p, 1, 'out', 100)?.sourceEnd).toBe(1);
        expect(trimPlacement(p, 1, 'out', -100)?.sourceEnd).toBeCloseTo(.201);
        expect(trimPlacement({ ...p, start: 0 }, 1, 'in', -10)).toBeUndefined();
        expect(trimPlacement(p, 1, 'in', 2)).toBeUndefined();
        expect(trimPlacement(p, 1, 'out', NaN)).toBeUndefined();
    });
    it('keeps exact scene nudges when the source trim is a recurring fraction', () => {
        const change = trimPlacement({ ...p, start: 1.5, sourceStart: .25, sourceEnd: .75 }, 1, 'in', 1.6);
        expect(change?.start).toBe(1.6); expect(change?.sourceStart).toBeCloseTo(1 / 15 + .25, 11);
    });
});
