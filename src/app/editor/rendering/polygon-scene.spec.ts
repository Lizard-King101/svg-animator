import { PolygonDraw, PolygonFanBuffer, validatePolygonScene, validateFanVertices } from './polygon-scene';
import { WebGpuPolygonRenderer } from './webgpu-polygon-renderer';

const box = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const draw = (): PolygonDraw => ({ id: 'shape', revision: 1, polygons: [box], color: [1, 0, 0, .5] });
function signedArea(values: Float32Array): number {
    let area = 0;
    for(let i = 0; i < values.length; i += 6) area += ((values[i + 2] - values[i]) * (values[i + 5] - values[i + 1]) - (values[i + 4] - values[i]) * (values[i + 3] - values[i + 1])) / 2;
    return area;
}

describe('polygon renderer boundary', () => {
    it('preserves signed winding for a compound shape with a hole', () => {
        const buffer = new PolygonFanBuffer();
        buffer.write([box, [{ x: 2, y: 2 }, { x: 2, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 2 }]]);
        expect(signedArea(buffer.data)).toBe(64);
        expect(buffer.length).toBe(24);
        buffer.write([[...box].reverse()]);
        expect(signedArea(buffer.data)).toBe(-100);
    });
    it('reuses storage, drops stale vertices and handles empty geometry', () => {
        const buffer = new PolygonFanBuffer(); buffer.write([box]);
        const array = buffer.data.buffer, capacity = buffer.capacity;
        buffer.write([box.slice(0, 3)]);
        expect(buffer.data.buffer).toBe(array); expect(buffer.capacity).toBe(capacity); expect(buffer.length).toBe(6);
        buffer.write([[], [box[0]]]); expect(buffer.data.length).toBe(0);
    });
    it('rejects invalid coordinates and oversized draws before replacing valid packed data', () => {
        const buffer = new PolygonFanBuffer(); buffer.write([box]);
        const prior = [...buffer.data];
        expect(() => buffer.write([[{ x: NaN, y: 0 }, ...box]])).toThrowError(/coordinates/);
        expect(() => buffer.write([box], 8)).toThrowError(/budget/);
        expect([...buffer.data]).toEqual(prior);
    });
    it('appends streamed polygons while preserving earlier vertices during buffer growth', () => {
        const buffer = new PolygonFanBuffer(); buffer.append(box);
        const first = [...buffer.data];
        for(let i = 0; i < 100; i++) buffer.append(box);
        expect([...buffer.data.slice(0, first.length)]).toEqual(first);
        expect(buffer.length).toBe(101 * 12);
        const storage = buffer.data.buffer;
        buffer.reset(); buffer.append(box.slice(0, 3));
        expect(buffer.data.buffer).toBe(storage); expect(buffer.length).toBe(6);
    });
    it('validates packed triangle boundaries, finite coordinates and upload budgets', () => {
        expect(() => validateFanVertices(new Float32Array(5), 100)).toThrowError(/size/);
        expect(() => validateFanVertices(new Float32Array([0, 0, 0, 1, Infinity, 2]), 100)).toThrowError(/coordinates/);
        expect(() => validateFanVertices(new Float32Array(6), 8)).toThrowError(/size/);
        expect(() => validateFanVertices(new Float32Array(0), 100)).not.toThrow();
    });
    it('rejects duplicate identity and invalid viewports or colors', () => {
        expect(() => validatePolygonScene([draw(), draw()], { width: 100, height: 100 })).toThrowError(/unique/);
        expect(() => validatePolygonScene([], { width: 0, height: 100 })).toThrowError(/viewport/);
        expect(() => validatePolygonScene([{ ...draw(), color: [1, 0, 0, NaN] }], { width: 100, height: 100 })).toThrowError(/color/);
    });
    it('reports unavailable GPU and adapter access failures without changing canvas content', async () => {
        const canvas = document.createElement('canvas'), failed = jasmine.createSpy('failed');
        const unsupported = await WebGpuPolygonRenderer.create(canvas, failed, null);
        expect('reason' in unsupported && unsupported.reason).toContain('unavailable');
        // An empty provider exercises the rejected initialization path on all test machines.
        const absent = await WebGpuPolygonRenderer.create(canvas, failed, { requestAdapter: async () => null } as unknown as GPU);
        expect('reason' in absent && absent.reason).toContain('No WebGPU adapter');
        const denied = await WebGpuPolygonRenderer.create(canvas, failed, { requestAdapter: async () => { throw new Error('denied'); } } as unknown as GPU);
        expect('reason' in denied && denied.reason).toContain('denied');
        expect(canvas.getContext('2d')).not.toBeNull(); expect(failed).not.toHaveBeenCalled();
    });
});
