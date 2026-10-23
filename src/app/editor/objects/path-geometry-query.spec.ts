import { PathGeometryQuery, PathQuerySegment } from './path-geometry-query';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): PathQuerySegment =>
    ({ id, label: id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
const arch: PathQuerySegment = { ...line('curve', 0, 0, 100, 0), controlStart: { x: 0, y: 100 }, controlEnd: { x: 100, y: 100 } };

describe('frozen path geometry queries', () => {
    it('finds nearest finite line and cubic locations without extending the segment', () => {
        const query = new PathGeometryQuery([arch, line('line', 200, 100, 300, 100)]);
        expect(query.nearest({ x: 234, y: 104 }, 6)?.point).toEqual({ x: 234, y: 100 });
        const hit = query.nearest({ x: 50, y: 79 }, 6)!;
        expect(hit.point.x).toBeCloseTo(50, 4); expect(hit.point.y).toBeCloseTo(75, 4);
        expect(query.nearest({ x: 310, y: 100 }, 6)).toBeUndefined();
        expect(query.nearest({ x: 234, y: 104 }, 6, 'curve')).toBeUndefined();
    });

    it('solves line/line, line/curve, and curve/curve crossings including tangential contact', () => {
        const straight = new PathGeometryQuery([line('a', 0, 20, 100, 20), line('b', 30, 0, 30, 100)]);
        const intersection = straight.intersections({ x: 31, y: 22 }, 6);
        expect(intersection.length).toBe(1);
        expect(intersection[0].point.x).toBeCloseTo(30, 8); expect(intersection[0].point.y).toBeCloseTo(20, 8);
        const cut = new PathGeometryQuery([arch, line('cut', 0, 40, 100, 40)]);
        const hits = cut.intersections({ x: 50, y: 40 }, 60);
        expect(hits.length).toBe(2);
        hits.forEach((hit) => expect(hit.point.y).toBeCloseTo(40, 6));
        expect(cut.intersections({ x: 50, y: 40 }, 2)).toEqual([]);
        const tangent = new PathGeometryQuery([arch, line('tangent', 0, 75, 100, 75)]);
        expect(tangent.intersections({ x: 50, y: 76 }, 6)[0].point.y).toBeCloseTo(75, 6);
        const reflected = { ...arch, id: 'reflected', start: { x: 0, y: 100 }, end: { x: 100, y: 100 },
            controlStart: { x: 0, y: 0 }, controlEnd: { x: 100, y: 0 } };
        const curves = new PathGeometryQuery([arch, reflected]);
        const crossings = curves.intersections({ x: 50, y: 50 }, 60);
        expect(crossings.length).toBe(2);
        crossings.forEach((hit) => expect(hit.point.y).toBeCloseTo(50, 5));
    });

    it('finds a cubic self-crossing, deduplicates shared crossings, and ignores overlapping continua', () => {
        const loop = new PathGeometryQuery([{ ...line('loop', 100, 100, 200, 100),
            controlStart: { x: 300, y: 300 }, controlEnd: { x: 0, y: 300 } }]);
        const hits = loop.intersections({ x: 150, y: 160 }, 6);
        expect(hits.length).toBe(1); expect(hits[0].point.x).toBeCloseTo(150, 5); expect(hits[0].point.y).toBeCloseTo(160, 5);
        const three = new PathGeometryQuery([line('a', 0, 20, 100, 20), line('b', 30, 0, 30, 100), line('c', 10, 0, 80, 70)]);
        expect(three.intersections({ x: 30, y: 20 }, 6).length).toBe(1);
        const overlap = new PathGeometryQuery([line('a', 0, 20, 100, 20), line('b', 10, 20, 80, 20)]);
        expect(overlap.intersections({ x: 10, y: 20 }, 6)).toEqual([]);
    });

    it('freezes input geometry, keeps repeat queries stable, and skips collapsed or invalid segments', () => {
        const a = line('a', 0, 20, 100, 20), b = line('b', 30, 0, 30, 100);
        const query = new PathGeometryQuery([a, b, line('zero', 500, 500, 500, 500), line('invalid', NaN, 0, 1, 1)]);
        const first = query.intersections({ x: 30, y: 20 }, 6);
        a.start.y = 500; a.end.y = 500;
        expect(query.intersections({ x: 30, y: 20 }, 6)).toEqual(first);
        expect(query.nearest({ x: 60, y: 21 }, 6)?.point.y).toBe(20);
        expect(query.nearest({ x: 500, y: 500 }, 6)).toBeUndefined();
    });
});
