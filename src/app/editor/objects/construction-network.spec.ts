import { ConstructionNetwork } from './construction-network';

function network(...data: string[]): ConstructionNetwork { return new ConstructionNetwork(data.map((data, i) => ({ id: String(i), data }))); }

describe('construction arrangement and standalone trimming', () => {
    it('finds a bounded region from four crossing open lines, ignoring their tails', () => {
        const n = network('M -10 0 L 110 0', 'M 100 -10 L 100 110', 'M 110 100 L -10 100', 'M 0 110 L 0 -10');
        try {
            expect(n.regions.length).toBe(1);
            expect(n.regionAt({ x: 50, y: 50 })?.area).toBeCloseTo(10000, 4);
            expect(n.regionAt({ x: -5, y: 50 })).toBeUndefined();
            const tail = n.spanAt({ x: -5, y: 0 }, 1)!;
            expect(tail).toBeDefined();
            const remainder = network(n.trimmedData(tail));
            try { expect(remainder.spanAt({ x: 110, y: 0 }, 1)).toBeDefined(); expect(remainder.spanAt({ x: -5, y: 0 }, 1)).toBeUndefined(); }
            finally { remainder.dispose(); }
        } finally { n.dispose(); }
    });
    it('splits enclosed regions with an open divider and trims its interior span independently', () => {
        const n = network('M 0 0 H 100 V 100 H 0 Z', 'M -20 50 H 120');
        try {
            expect(n.regions.length).toBe(2);
            expect(n.regionAt({ x: 50, y: 25 })?.area).toBeCloseTo(5000, 4);
            const span = n.spanAt({ x: 50, y: 50 }, 1)!;
            const remainder = new ConstructionNetwork([{ id: 'trim', data: n.trimmedData(span) }]);
            try { expect(remainder.spans.length).toBe(2); expect(remainder.spanAt({ x: 50, y: 50 }, 1)).toBeUndefined(); }
            finally { remainder.dispose(); }
        } finally { n.dispose(); }
    });
    it('preserves holes between nested loops and keeps the inner region selectable', () => {
        const n = network('M 0 0 H 100 V 100 H 0 Z', 'M 25 25 H 75 V 75 H 25 Z');
        try {
            expect(n.regions.length).toBe(2);
            expect(n.regionAt({ x: 10, y: 10 })?.area).toBeCloseTo(7500, 4);
            expect(n.regionAt({ x: 50, y: 50 })?.area).toBeCloseTo(2500, 4);
        } finally { n.dispose(); }
    });
    it('retains cubic curves after trimming and does not invent a region for open artwork', () => {
        const n = network('M 0 0 C 20 100 80 100 100 0', 'M 50 -20 V 120');
        try {
            expect(n.regions.length).toBe(0);
            const left = n.spanAt({ x: 0, y: 0 }, 1)!;
            const data = n.trimmedData(left);
            expect(data.toLowerCase()).toContain('c');
            const remainder = network(data);
            try { expect(remainder.spanAt({ x: 0, y: 0 }, 1)).toBeUndefined(); expect(remainder.spanAt({ x: 100, y: 0 }, 1)).toBeDefined(); }
            finally { remainder.dispose(); }
        } finally { n.dispose(); }
    });
    it('handles duplicate boundaries and dangling interior branches without duplicate regions', () => {
        const n = network('M 0 0 H 100 V 100 H 0 Z', 'M 0 0 H 100', 'M 50 0 V 40');
        try { expect(n.regions.length).toBe(1); expect(n.regionAt({ x: 20, y: 20 })?.area).toBeCloseTo(10000, 4); }
        finally { n.dispose(); }
    });
    it('preserves an annular face when a dangling bridge connects its inner and outer outlines', () => {
        const n = network('M 0 0 H 100 V 100 H 0 Z', 'M 25 25 H 75 V 75 H 25 Z', 'M 0 50 H 25');
        try {
            expect(n.regions.length).toBe(2);
            expect(n.regionAt({ x: 10, y: 10 })?.area).toBeCloseTo(7500, 4);
            expect(n.regionAt({ x: 50, y: 50 })?.area).toBeCloseTo(2500, 4);
        } finally { n.dispose(); }
    });
    it('trims a whole isolated open contour without requiring any enclosed region', () => {
        const n = network('M 0 0 L 50 50 L 100 0');
        try { expect(n.regions.length).toBe(0); expect(n.trimmedData(n.spanAt({ x: 25, y: 25 }, 1)!)).toBe(''); }
        finally { n.dispose(); }
    });
});
