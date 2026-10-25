import { boneWeightColor, weightHeatColor } from './rig-weight-colors';

describe('rig influence colors', () => {
    it('resolves real single-bone hue collisions to distinct palette slots', () => {
        const ids = ['bone-47', 'bone-50', 'root'];
        expect(boneWeightColor(ids[0])).toBe(boneWeightColor(ids[1]));
        const colors = ids.map(id => boneWeightColor(id, ids));
        expect(new Set(colors).size).toBe(ids.length);
    });

    it('does not change assignments when bone order or bound influence subsets change', () => {
        const ids = ['root', 'bone-50', 'foot', 'bone-47', 'body'];
        const expected = new Map(ids.map(id => [id, boneWeightColor(id, ids)]));
        for(const id of [...ids].reverse()) expect(boneWeightColor(id, [...ids].reverse())).toBe(expected.get(id)!);
        // Both bindings request colors against the complete rig, including bones with zero influence.
        for(const influences of [['bone-50'], ['bone-47', 'foot'], ['body', 'bone-50', 'bone-47']]) {
            for(const id of influences) expect(boneWeightColor(id, ids)).toBe(expected.get(id)!);
        }
    });

    it('extends the palette for rigs with more bones than base slots', () => {
        const ids = Array.from({ length: 80 }, (_, index) => 'bone-' + index);
        expect(new Set(ids.map(id => boneWeightColor(id, ids))).size).toBe(ids.length);
        expect(boneWeightColor('bone-1', [...ids, 'bone-1'])).toBe(boneWeightColor('bone-1', ids));
    });

    it('uses every contrasting base slot before allocating an overflow hue', () => {
        const ids = Array.from({ length: 12 }, (_, index) => 'slot-test-' + index);
        expect(new Set(ids.map(id => boneWeightColor(id, ids))).size).toBe(12);
        for(const id of ids) expect(boneWeightColor(id, ids)).toMatch(/^hsl\(\d+ 72% 62%\)$/);
    });
    it('maps weights onto the blue-to-red heat ramp and clamps out-of-range values', () => {
        expect(weightHeatColor(0)).toBe('hsl(240 85% 55%)');
        expect(weightHeatColor(.5)).toBe('hsl(120 85% 55%)');
        expect(weightHeatColor(1)).toBe('hsl(0 85% 55%)');
        expect(weightHeatColor(-1)).toBe(weightHeatColor(0)); expect(weightHeatColor(2)).toBe(weightHeatColor(1));
    });
});
