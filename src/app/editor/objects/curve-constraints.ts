import { rootsInUnitInterval, polynomialValue as value, polynomialDerivative as derivative } from './polynomial-roots';
import { cubicPoint } from './curve-geometry';
import type { PathQuerySegment } from './path-geometry-query';

type Position = { x: number; y: number };
export interface CurveContact { point: Position; time: number; kind: 'tangent' | 'perpendicular' }

/** Finite contacts from a fixed line origin, measured in the supplied coordinate space. */
export function curveContacts(segment: PathQuerySegment, origin: Position): CurveContact[] {
    const { start, end } = segment;
    if(!segment.controlStart || !segment.controlEnd) {
        const dx = end.x - start.x, dy = end.y - start.y, length = dx * dx + dy * dy;
        if(length < 1e-16) return [];
        const time = ((origin.x - start.x) * dx + (origin.y - start.y) * dy) / length;
        if(time < 0 || time > 1) return [];
        const point = { x: start.x + time * dx, y: start.y + time * dy };
        return Math.hypot(point.x - origin.x, point.y - origin.y) > 1e-8 ? [{ point, time, kind: 'perpendicular' }] : [];
    }
    const c1 = segment.controlStart, c2 = segment.controlEnd;
    // Normalize before polynomial products so document position and scale do not change root tolerances.
    const scale = Math.max(...[start, c1, c2, end].map((p) => Math.hypot(p.x - origin.x, p.y - origin.y)));
    if(!Number.isFinite(scale) || scale < 1e-10) return [];
    const points = [start, c1, c2, end].map((p) => ({ x: (p.x - origin.x) / scale, y: (p.y - origin.y) / scale }));
    const coefficients = (axis: 'x' | 'y') => {
        const [a, b, c, d] = points.map((p) => p[axis]);
        return [a, 3 * (b - a), 3 * (a - 2 * b + c), d - a + 3 * (b - c)];
    };
    const x = coefficients('x'), y = coefficients('y'), dx = derivative(x), dy = derivative(y);
    const result: CurveContact[] = [];
    for(const kind of ['tangent', 'perpendicular'] as const) {
        const polynomial = kind === 'tangent' ? combine(product(x, dy), product(y, dx), -1)
            : combine(product(x, dx), product(y, dy), 1);
        for(const time of rootsInUnitInterval(polynomial)) {
            const vx = value(x, time), vy = value(y, time);
            let tx = value(dx, time), ty = value(dy, time);
            if(Math.hypot(tx, ty) < 1e-9 && (time < 1e-8 || time > 1 - 1e-8)) {
                const ordered = time < .5 ? points : [...points].reverse();
                const next = ordered.slice(1).find((p) => Math.hypot(p.x - ordered[0].x, p.y - ordered[0].y) > 1e-9);
                if(next) { tx = next.x - ordered[0].x; ty = next.y - ordered[0].y; }
            }
            if(Math.hypot(tx, ty) < 1e-7) continue; // Reject numerically near-stationary interior cusps too.
            const magnitude = Math.hypot(vx, vy) * Math.hypot(tx, ty);
            if(magnitude < 1e-12) continue;
            const error = kind === 'tangent' ? vx * ty - vy * tx : vx * tx + vy * ty;
            if(Math.abs(error) > magnitude * 1e-6) continue;
            result.push({ point: cubicPoint(start, c1, c2, end, time), time, kind });
        }
    }
    return result;
}

function product(a: number[], b: number[]): number[] {
    const result = new Array(a.length + b.length - 1).fill(0);
    a.forEach((x, i) => b.forEach((y, j) => result[i + j] += x * y));
    return result;
}
function combine(a: number[], b: number[], sign: number): number[] {
    return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + sign * (b[i] ?? 0));
}
