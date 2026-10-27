/** Distance to a finite segment, including a zero-length point segment. */
export function pointSegmentDistance(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): number {
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
    if(!length) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(length, (point.x - start.x) * (dx / length) + (point.y - start.y) * (dy / length)));
    return Math.hypot(point.x - start.x - t * (dx / length), point.y - start.y - t * (dy / length));
}
