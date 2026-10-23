import { rootsInUnitInterval } from './polynomial-roots';

type Position = { x: number; y: number };

/** Exact affine ellipse: center + axisX*cos(t) + axisY*sin(t), in canvas space. */
export interface EllipseQueryTarget {
    id: string;
    label: string;
    center: Position;
    axisX: Position;
    axisY: Position;
}

export function ellipseTangentContacts(ellipse: EllipseQueryTarget, origin: Position): Position[] {
    const { center, axisX, axisY } = ellipse;
    const scale = Math.max(Math.hypot(axisX.x, axisX.y), Math.hypot(axisY.x, axisY.y));
    if(!Number.isFinite(scale) || scale < 1e-10) return [];
    const a = { x: axisX.x / scale, y: axisX.y / scale }, b = { x: axisY.x / scale, y: axisY.y / scale };
    const determinant = a.x * b.y - a.y * b.x;
    if(Math.abs(determinant) < 1e-12) return [];
    const dx = (origin.x - center.x) / scale, dy = (origin.y - center.y) / scale;
    // Map the origin to the unit circle. Tangency is invariant under an invertible affine map.
    const x = (dx * b.y - dy * b.x) / determinant, y = (a.x * dy - a.y * dx) / determinant;
    const radius = Math.hypot(x, y);
    if(!Number.isFinite(radius) || radius <= 1 + 1e-10) return []; // Inside, on the outline, or no finite direction.
    const nx = x / radius, ny = y / radius, along = 1 / radius, across = Math.sqrt(1 - along * along);
    return [-1, 1].map((sign) => {
        const qx = nx * along - sign * ny * across, qy = ny * along + sign * nx * across;
        return { x: center.x + axisX.x * qx + axisY.x * qy, y: center.y + axisX.y * qx + axisY.y * qy };
    });
}

/** Finite normal contacts, solved in canvas space: affine maps do not preserve right angles. */
export function ellipsePerpendicularContacts(ellipse: EllipseQueryTarget, origin: Position): Position[] {
    const { center, axisX, axisY } = ellipse;
    const scale = Math.max(Math.hypot(axisX.x, axisX.y), Math.hypot(axisY.x, axisY.y));
    if(![scale, center.x, center.y, origin.x, origin.y].every(Number.isFinite) || scale < 1e-10) return [];
    const a = { x: axisX.x / scale, y: axisX.y / scale }, b = { x: axisY.x / scale, y: axisY.y / scale };
    const c = { x: (center.x - origin.x) / scale, y: (center.y - origin.y) / scale };
    if(Math.abs(a.x * b.y - a.y * b.x) < 1e-12 || ![c.x, c.y].every(Number.isFinite)) return [];
    const result: Position[] = [];
    // Two rational half-circles avoid the pole of tan(theta/2). With t=2u-1,
    // cos(theta)=(1-t²)/(1+t²), sin(theta)=2t/(1+t²), u in [0,1].
    // Clearing the denominator in (ellipse-origin) dot tangent gives a quartic.
    for(const sign of [1, -1]) {
        const denominator = [2, -4, 4], cosine = [0, 4, -4], sine = [-2, 4, 0];
        const position = (axis: 'x' | 'y') => denominator.map((d, i) => c[axis] * d + sign * (a[axis] * cosine[i] + b[axis] * sine[i]));
        const tangent = (axis: 'x' | 'y') => cosine.map((cos, i) => sign * (b[axis] * cos - a[axis] * sine[i]));
        const x = position('x'), y = position('y'), dx = tangent('x'), dy = tangent('y');
        const polynomial = [0, 0, 0, 0, 0];
        for(let i = 0; i < 3; i++) for(let j = 0; j < 3; j++) polynomial[i + j] += x[i] * dx[j] + y[i] * dy[j];
        for(const root of rootsInUnitInterval(polynomial)) {
            const t = 2 * root - 1, divisor = 1 + t * t;
            const cos = sign * (1 - t * t) / divisor, sin = sign * 2 * t / divisor;
            const vx = c.x + a.x * cos + b.x * sin, vy = c.y + a.y * cos + b.y * sin;
            const tx = -a.x * sin + b.x * cos, ty = -a.y * sin + b.y * cos;
            const length = Math.hypot(vx, vy), magnitude = length * Math.hypot(tx, ty);
            if(length * scale < 1e-8 || magnitude < 1e-14 || Math.abs(vx * tx + vy * ty) > magnitude * 1e-7) continue;
            const point = { x: center.x + axisX.x * cos + axisY.x * sin, y: center.y + axisX.y * cos + axisY.y * sin };
            if(!result.some(other => Math.hypot(other.x - point.x, other.y - point.y) < 1e-7)) result.push(point);
        }
    }
    return result;
}

/** Closest contact on an affine ellipse, with its exact analytic tangent. */
export function nearestEllipseContact(ellipse: EllipseQueryTarget, point: Position): { point: Position; tangent: Position } | undefined {
    const { center, axisX: a, axisY: b } = ellipse;
    if(![center.x, center.y, a.x, a.y, b.x, b.y, point.x, point.y].every(Number.isFinite) ||
        Math.abs(a.x * b.y - a.y * b.x) < 1e-12) return undefined;
    const at = (t: number) => ({ x: center.x + a.x * Math.cos(t) + b.x * Math.sin(t), y: center.y + a.y * Math.cos(t) + b.y * Math.sin(t) });
    const distance = (t: number) => { const q = at(t); return (q.x - point.x) ** 2 + (q.y - point.y) ** 2; };
    // Minimize every sampled local minimum; this also handles highly eccentric ellipses.
    const step = 2 * Math.PI / 64;
    let best = 0, bestDistance = Infinity;
    for(let i = 0; i < 64; i++) {
        const t = i * step;
        if(distance(t) > distance(t - step) || distance(t) > distance(t + step)) continue;
        let lo = t - step, hi = t + step;
        for(let n = 0; n < 48; n++) {
            const x = lo + (hi - lo) * .38196601125, y = lo + (hi - lo) * .61803398875;
            if(distance(x) < distance(y)) hi = y; else lo = x;
        }
        const angle = (lo + hi) / 2, d = distance(angle);
        if(d < bestDistance) { best = angle; bestDistance = d; }
    }
    return { point: at(best), tangent: { x: -a.x * Math.sin(best) + b.x * Math.cos(best), y: -a.y * Math.sin(best) + b.y * Math.cos(best) } };
}

/** Preserve handle length and its side of the anchor in the caller's coordinate space. */
export function tangentAlignedHandle(anchor: Position, handle: Position, tangent: Position): Position {
    const dx = handle.x - anchor.x, dy = handle.y - anchor.y;
    const length = Math.hypot(dx, dy), magnitude = Math.hypot(tangent.x, tangent.y);
    if(magnitude < 1e-12 || length < 1e-12) return { ...handle };
    const scale = length / magnitude * (dx * tangent.x + dy * tangent.y < 0 ? -1 : 1);
    return { x: anchor.x + tangent.x * scale, y: anchor.y + tangent.y * scale };
}

/** Common supporting lines, including the two crossing tangents of disjoint ellipses. */
export function ellipseCommonTangents(first: EllipseQueryTarget, second: EllipseQueryTarget): Array<{ start: Position; end: Position }> {
    const support = (e: EllipseQueryTarget, t: number) => {
        const nx = Math.cos(t), ny = Math.sin(t);
        const x = e.axisX.x * nx + e.axisX.y * ny, y = e.axisY.x * nx + e.axisY.y * ny;
        const radius = Math.hypot(x, y);
        return { radius, derivative: (x * (-e.axisX.x * ny + e.axisX.y * nx) + y * (-e.axisY.x * ny + e.axisY.y * nx)) / radius,
            offset: { x: (e.axisX.x * x + e.axisY.x * y) / radius, y: (e.axisX.y * x + e.axisY.y * y) / radius } };
    };
    const dx = first.center.x - second.center.x, dy = first.center.y - second.center.y;
    const result: Array<{ start: Position; end: Position }> = [];
    const bisect = (f: (t: number) => number, lo: number, hi: number) => {
        for(let i = 0; i < 60; i++) {
            const mid = (lo + hi) / 2;
            if(f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
        }
        return (lo + hi) / 2;
    };
    for(const sign of [1, -1]) {
        const f = (t: number) => dx * Math.cos(t) + dy * Math.sin(t) + support(first, t).radius - sign * support(second, t).radius;
        const df = (t: number) => -dx * Math.sin(t) + dy * Math.cos(t) + support(first, t).derivative - sign * support(second, t).derivative;
        const stops = [0, 2 * Math.PI];
        for(let i = 0; i < 128; i++) {
            const lo = i * Math.PI / 64, hi = (i + 1) * Math.PI / 64;
            if(df(lo) * df(hi) < 0) stops.push(bisect(df, lo, hi));
        }
        stops.sort((a, b) => a - b);
        if(stops.every(t => Math.abs(f(t)) < 1e-9)) continue; // Coincident outlines have infinitely many tangents.
        for(let i = 1; i < stops.length; i++) {
            const lo = stops[i - 1], hi = stops[i];
            if(f(lo) * f(hi) > 0 && Math.min(Math.abs(f(lo)), Math.abs(f(hi))) > 1e-9) continue;
            const t = Math.abs(f(lo)) < 1e-9 ? lo : Math.abs(f(hi)) < 1e-9 ? hi : bisect(f, lo, hi);
            const a = support(first, t).offset, b = support(second, t).offset;
            const start = { x: first.center.x + a.x, y: first.center.y + a.y };
            const end = { x: second.center.x + sign * b.x, y: second.center.y + sign * b.y };
            if(![start.x, start.y, end.x, end.y].every(Number.isFinite) || Math.hypot(end.x - start.x, end.y - start.y) < 1e-7) continue;
            if(!result.some(pair => Math.hypot(pair.start.x - start.x, pair.start.y - start.y) < 1e-7 && Math.hypot(pair.end.x - end.x, pair.end.y - end.y) < 1e-7)) result.push({ start, end });
        }
    }
    return result;
}
