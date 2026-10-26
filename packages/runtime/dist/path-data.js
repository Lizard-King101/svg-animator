/** Shared framework-free path reconstruction used by authoring and playback. */
export function buildRuntimePathData(contours, rounded = true) {
    return contours.map((contour) => buildContour(contour, rounded)).filter(Boolean).join(" ");
}
function buildContour(contour, rounded) {
    const lines = contour.lines.filter((line) => line.points.length >= 2);
    if (!lines.length)
        return "";
    const closed = contour.closed;
    if (!rounded) {
        const commands = [`M ${pointText(lines[0].points[0])}`];
        lines.forEach((line) => commands.push(line.type === "bezier"
            ? `C ${pointText(line.controlStart ?? line.points[0])} ${pointText(line.controlEnd ?? line.points[1])} ${pointText(line.points[1])}`
            : `L ${pointText(line.points[1])}`));
        if (closed)
            commands.push("Z");
        return commands.join(" ");
    }
    const closing = contourClosingPoints(lines, closed);
    // Keep ordinary Z-only output stable; materialize its edge when a closing corner needs rounding.
    if (closing && closing.some(point => (point.cornerRadius ?? 0) > 0)) {
        lines.push({ id: `${contour.id}:close`, type: 'line', points: closing });
    }
    const startCorner = segmentStartCorner(lines, 0, closed);
    const commands = [`M ${pointText(startCorner?.after ?? lines[0].points[0])}`];
    lines.forEach((line, index) => {
        const corner = segmentEndCorner(lines, index, closed);
        const end = corner?.before ?? line.points[1];
        const startCorner = segmentStartCorner(lines, index, closed);
        commands.push(line.type === "bezier" && line.controlStart && line.controlEnd && !(startCorner || corner)
            ? `C ${pointText(line.controlStart)} ${pointText(line.controlEnd)} ${pointText(end)}`
            : `L ${pointText(end)}`);
        if (corner)
            commands.push(`C ${pointText(corner.controlBefore)} ${pointText(corner.controlAfter)} ${pointText(corner.after)}`);
    });
    if (closed)
        commands.push("Z");
    return commands.join(" ");
}
/** The implicit Z edge, retaining the caller's endpoint identities without changing saved geometry. */
export function contourClosingPoints(lines, closed) {
    if (!closed || !lines.length)
        return undefined;
    const start = lines[0].points[0], end = lines[lines.length - 1].points[1];
    return start && end && !samePoint(start, end) ? [end, start] : undefined;
}
/** Straight geometry may be encoded as a cubic with collapsed or collinear handles. */
export function isStraightPathSegment(line) {
    if (line.type === 'line')
        return true;
    const [start, end] = line.points;
    if (!start || !end)
        return false;
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
    if (length < 1e-8)
        return false;
    return [line.controlStart ?? start, line.controlEnd ?? end].every(control => {
        const x = control.x - start.x, y = control.y - start.y;
        const along = (x * dx + y * dy) / length;
        return Math.abs(x * dy - y * dx) / length < 1e-7 && along >= -1e-7 && along <= length + 1e-7;
    });
}
function segmentStartCorner(lines, index, closed) {
    if (index === 0 && !closed)
        return null;
    return roundedCorner(lines[index === 0 ? lines.length - 1 : index - 1], lines[index]);
}
function segmentEndCorner(lines, index, closed) {
    if (index === lines.length - 1 && !closed)
        return null;
    return roundedCorner(lines[index], lines[index === lines.length - 1 ? 0 : index + 1]);
}
export function roundedCorner(incoming, outgoing) {
    if (!isStraightPathSegment(incoming) || !isStraightPathSegment(outgoing) || !samePoint(incoming.points[1], outgoing.points[0]))
        return null;
    const anchor = outgoing.points[0];
    const radius = Math.max(incoming.points[1].cornerRadius ?? 0, anchor.cornerRadius ?? 0);
    if (radius <= 0)
        return null;
    const previous = incoming.points[0];
    const next = outgoing.points[1];
    const previousLength = distance(anchor, previous);
    const nextLength = distance(anchor, next);
    if (previousLength <= 0.0001 || nextLength <= 0.0001)
        return null;
    const previousUnit = unit(anchor, previous);
    const nextUnit = unit(anchor, next);
    const angle = Math.acos(Math.max(-1, Math.min(1, previousUnit.x * nextUnit.x + previousUnit.y * nextUnit.y)));
    if (angle <= 0.001 || angle >= Math.PI - 0.001)
        return null;
    const tangent = Math.tan(angle / 2);
    if (Math.abs(tangent) <= 0.0001)
        return null;
    const offset = Math.min(radius / tangent, Math.min(previousLength, nextLength) * 0.45);
    if (offset <= 0.0001)
        return null;
    const controlLength = (4 / 3) * Math.tan((Math.PI - angle) / 4) * offset * tangent;
    const before = runtimePoint(anchor.x + previousUnit.x * offset, anchor.y + previousUnit.y * offset);
    const after = runtimePoint(anchor.x + nextUnit.x * offset, anchor.y + nextUnit.y * offset);
    return {
        before, after,
        controlBefore: runtimePoint(before.x - previousUnit.x * controlLength, before.y - previousUnit.y * controlLength),
        controlAfter: runtimePoint(after.x - nextUnit.x * controlLength, after.y - nextUnit.y * controlLength),
    };
}
function pointText(point) { return `${round(point.x)} ${round(point.y)}`; }
function samePoint(a, b) { return a.id === b.id || (Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function unit(from, to) { const length = distance(from, to); return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }; }
function runtimePoint(x, y) { return { id: "", x, y }; }
function round(value) { return Math.round(value * 1000) / 1000; }
//# sourceMappingURL=path-data.js.map