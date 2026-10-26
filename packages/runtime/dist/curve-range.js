export function lerpCurvePoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
export function cubicPoint(a, b, c, d, t) {
    const m = 1 - t;
    return { x: m * m * m * a.x + 3 * m * m * t * b.x + 3 * m * t * t * c.x + t * t * t * d.x, y: m * m * m * a.y + 3 * m * m * t * b.y + 3 * m * t * t * c.y + t * t * t * d.y };
}
export function splitCubic(a, b, c, d, t) {
    const ab = lerpCurvePoint(a, b, t), bc = lerpCurvePoint(b, c, t), cd = lerpCurvePoint(c, d, t);
    const abc = lerpCurvePoint(ab, bc, t), bcd = lerpCurvePoint(bc, cd, t), point = lerpCurvePoint(abc, bcd, t);
    return [[{ ...a }, ab, abc, point], [point, bcd, cd, { ...d }]];
}
export function cubicRange(a, b, c, d, start, end) {
    const left = splitCubic(a, b, c, d, end)[0];
    return start <= 0 ? left : splitCubic(...left, start / Math.max(end, 1e-12))[1];
}
export function curvePoint(line, t) {
    return line.type === 'bezier' && line.controlStart && line.controlEnd
        ? cubicPoint(line.points[0], line.controlStart, line.controlEnd, line.points[1], t)
        : lerpCurvePoint(line.points[0], line.points[1], t);
}
export function curveLengthSamples(line, steps = 64) {
    if (line.type !== 'bezier' || !line.controlStart || !line.controlEnd)
        return [{ t: 0, length: 0 }, { t: 1, length: Math.hypot(line.points[1].x - line.points[0].x, line.points[1].y - line.points[0].y) }];
    const samples = [{ t: 0, length: 0 }];
    let previous = line.points[0], length = 0;
    for (let index = 1; index <= steps; index++) {
        const t = index / steps, point = curvePoint(line, t);
        length += Math.hypot(point.x - previous.x, point.y - previous.y);
        samples.push({ t, length });
        previous = point;
    }
    return samples;
}
export function curveTAtLength(samples, target) {
    if (target <= 0)
        return 0;
    if (target >= samples[samples.length - 1].length)
        return 1;
    let low = 0, high = samples.length - 1;
    while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (samples[middle].length < target)
            low = middle;
        else
            high = middle;
    }
    const a = samples[low], b = samples[high];
    return a.t + (b.t - a.t) * (target - a.length) / Math.max(1e-12, b.length - a.length);
}
//# sourceMappingURL=curve-range.js.map