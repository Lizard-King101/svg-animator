/** Shared offset/join primitives for generated stroke geometry and Stroke to Path. */
export function strokeNormal(direction, side) {
    return { x: -direction.y * side, y: direction.x * side };
}
export function strokeOffset(point, normal, distance) {
    return { x: point.x + normal.x * distance, y: point.y + normal.y * distance };
}
export function strokeIntersection(a, directionA, b, directionB, epsilon = .0001) {
    const determinant = directionA.x * directionB.y - directionA.y * directionB.x;
    if (Math.abs(determinant) <= epsilon)
        return null;
    const t = ((b.x - a.x) * directionB.y - (b.y - a.y) * directionB.x) / determinant;
    return strokeOffset(a, directionA, t);
}
//# sourceMappingURL=stroke-expansion.js.map