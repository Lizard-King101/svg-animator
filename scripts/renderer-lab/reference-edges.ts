import type { PolygonDraw, PolygonViewport } from '../../src/app/editor/rendering/polygon-scene';

/** Diagnostic only: one-pixel neighborhoods of independently projected SVG edges.
 * Flat-looking overlapping antialiased strokes can hide edges from a color-gradient
 * detector. Use geometry to identify those boundaries without widening color tolerance.
 */
export function referenceEdges(draws: readonly PolygonDraw[], viewport: PolygonViewport, width: number, height: number): Uint8Array {
    const edges = new Uint8Array(width * height);
    for(const draw of draws) for(const polygon of draw.polygons ?? []) {
        const m = draw.transform;
        const points = polygon.map(p => ({ x: ((m?.a ?? 1) * p.x + (m?.c ?? 0) * p.y + (m?.e ?? 0)) * width / viewport.width,
            y: ((m?.b ?? 0) * p.x + (m?.d ?? 1) * p.y + (m?.f ?? 0)) * height / viewport.height }));
        points.forEach((a, i) => {
            const b = points[(i + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
            const left = Math.max(0, Math.floor(Math.min(a.x, b.x) - 1)), right = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + 1));
            const top = Math.max(0, Math.floor(Math.min(a.y, b.y) - 1)), bottom = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + 1));
            for(let y = top; y <= bottom; y++) for(let x = left; x <= right; x++) {
                const px = x + .5 - a.x, py = y + .5 - a.y;
                const t = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
                if((px - t * dx) ** 2 + (py - t * dy) ** 2 <= 1) edges[y * width + x] = 1;
            }
        });
    }
    return edges;
}
