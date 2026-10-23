import { curveContacts } from './curve-constraints';
import { PathQuerySegment } from './path-geometry-query';
import { cubicPoint } from './curve-geometry';

const arch: PathQuerySegment = { id: 'arch', label: 'Arch', start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
    controlStart: { x: 0, y: 100 }, controlEnd: { x: 100, y: 100 } };

describe('tangent and perpendicular curve contacts', () => {
    it('finds cubic contacts from an external line origin and validates both relationships', () => {
        const tangent = curveContacts(arch, { x: -96.875, y: -93.75 }).find((hit) => hit.kind === 'tangent' && Math.abs(hit.time - .25) < 1e-6);
        expect(tangent).toBeDefined();
        expect(tangent!.point.x).toBeCloseTo(15.625, 6); expect(tangent!.point.y).toBeCloseTo(56.25, 6);
        const normal = curveContacts(arch, { x: -134.375, y: 168.75 }).find((hit) => hit.kind === 'perpendicular' && Math.abs(hit.time - .25) < 1e-6);
        expect(normal).toBeDefined();
        for(const origin of [{ x: -50, y: 75 }, { x: 50, y: 130 }, { x: 50, y: -50 }]) {
            const hits = curveContacts(arch, origin);
            expect(hits.length).toBeGreaterThan(0);
            hits.forEach((hit) => {
                const t = hit.time, dx = 600 * t * (1 - t), dy = 300 * (1 - 2 * t);
                const x = hit.point.x - origin.x, y = hit.point.y - origin.y;
                const residual = hit.kind === 'tangent' ? x * dy - y * dx : x * dx + y * dy;
                expect(residual / (Math.hypot(x, y) * Math.hypot(dx, dy))).toBeCloseTo(0, 6);
            });
        }
    });

    it('keeps endpoint tangents and finite line normals, but rejects extensions and zero-length contacts', () => {
        expect(curveContacts(arch, { x: 0, y: -30 }).some((hit) => hit.kind === 'tangent' && hit.time === 0)).toBeTrue();
        const line: PathQuerySegment = { id: 'line', label: 'Line', start: { x: 20, y: 20 }, end: { x: 100, y: 20 } };
        expect(curveContacts(line, { x: 60, y: 60 })).toEqual([{ point: { x: 60, y: 20 }, time: .5, kind: 'perpendicular' }]);
        expect(curveContacts(line, { x: 120, y: 60 })).toEqual([]);
        expect(curveContacts(line, { x: 60, y: 20 })).toEqual([]);
        expect(curveContacts({ ...line, end: line.start }, { x: 60, y: 60 })).toEqual([]);
        const cusp = { ...arch, start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, controlStart: { x: 100, y: 0 }, controlEnd: { x: 100, y: 0 } };
        expect(curveContacts(cusp, { x: 75, y: 30 }).some((hit) => Math.abs(hit.time - .5) < 1e-6)).toBeFalse();
    });

    it('solves in canvas space under reflection, nonuniform scale, and large translations', () => {
        const project = (p: { x: number; y: number }) => ({ x: 100000 + p.y * .4, y: -80000 - p.x * 3 });
        const transformed = { ...arch, start: project(arch.start), end: project(arch.end),
            controlStart: project(arch.controlStart!), controlEnd: project(arch.controlEnd!) };
        const point = cubicPoint(transformed.start, transformed.controlStart, transformed.controlEnd, transformed.end, .25);
        const tangent = { x: 60, y: -337.5 };
        const origin = { x: point.x - tangent.y, y: point.y + tangent.x };
        const normal = curveContacts(transformed, origin).find((hit) => hit.kind === 'perpendicular' && Math.abs(hit.time - .25) < 1e-6);
        expect(normal).toBeDefined(); expect(normal!.point.x).toBeCloseTo(point.x, 6); expect(normal!.point.y).toBeCloseTo(point.y, 6);
    });
});
