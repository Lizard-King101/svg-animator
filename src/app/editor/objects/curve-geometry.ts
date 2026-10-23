/** Shared cubic evaluation for geometry queries; callers own coordinate projection. */
export function cubicPoint(
    start: { x: number; y: number },
    controlStart: { x: number; y: number },
    controlEnd: { x: number; y: number },
    end: { x: number; y: number },
    t: number,
): { x: number; y: number } {
    const mt = 1 - t;
    return {
        x: (mt * mt * mt * start.x) + (3 * mt * mt * t * controlStart.x) + (3 * mt * t * t * controlEnd.x) + (t * t * t * end.x),
        y: (mt * mt * mt * start.y) + (3 * mt * mt * t * controlStart.y) + (3 * mt * t * t * controlEnd.y) + (t * t * t * end.y),
    };
}
