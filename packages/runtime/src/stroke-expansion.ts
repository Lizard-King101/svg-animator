import { CurvePoint } from './curve-range';

/** Shared offset/join primitives for generated stroke geometry and Stroke to Path. */
export function strokeNormal(direction: CurvePoint, side: number): CurvePoint {
    return { x: -direction.y * side, y: direction.x * side };
}
export function strokeOffset(point: CurvePoint, normal: CurvePoint, distance: number): CurvePoint {
    return { x: point.x + normal.x * distance, y: point.y + normal.y * distance };
}
export function strokeIntersection(a: CurvePoint, directionA: CurvePoint, b: CurvePoint, directionB: CurvePoint, epsilon = .0001): CurvePoint | null {
    const determinant = directionA.x * directionB.y - directionA.y * directionB.x;
    if(Math.abs(determinant) <= epsilon) return null;
    const t = ((b.x - a.x) * directionB.y - (b.y - a.y) * directionB.x) / determinant;
    return strokeOffset(a, directionA, t);
}
