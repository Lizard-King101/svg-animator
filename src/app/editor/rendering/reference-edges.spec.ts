import { referenceEdges } from '../../../../scripts/renderer-lab/reference-edges';
import { compare } from '../../../../scripts/renderer-lab/verify';
import type { PolygonDraw } from './polygon-scene';

describe('stress raster reference boundaries', () => {
    const draw: PolygonDraw = { id: 'box', revision: 1, color: [1, 1, 1, 1],
        polygons: [[{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }]] };
    it('marks only one-pixel geometric boundaries, preserving interior coverage', () => {
        const edges = referenceEdges([draw], { width: 10, height: 10 }, 10, 10);
        expect(edges[2 * 10 + 4]).toBe(1); expect(edges[4 * 10 + 4]).toBe(0); expect(edges[0]).toBe(0);
    });
    it('uses world matrices and backing-pixel scaling for edge distance', () => {
        const edges = referenceEdges([{ ...draw, transform: { a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 } }], { width: 10, height: 10 }, 20, 20);
        expect(edges[10 * 20 + 6]).toBe(1); expect(edges[10 * 20 + 4]).toBe(0); expect(edges[10 * 20 + 10]).toBe(0);
    });
    it('reports edge differences separately without accepting a wrong interior color', () => {
        const expected = new Uint8ClampedArray(10 * 10 * 4).fill(255), actual = expected.slice();
        actual[(2 * 10 + 4) * 4] = 240; actual[(4 * 10 + 4) * 4] = 240;
        const result = compare(expected, actual, 10, 10, referenceEdges([draw], { width: 10, height: 10 }, 10, 10));
        expect(result.mismatches).toBe(1); expect(result.geometricBoundaryDifferences).toBe(1);
        expect(result.maximumInteriorError).toBe(15); expect(result.paintedInterior).toBeGreaterThan(0);
    });
});
