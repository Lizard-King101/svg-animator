import { cubicRange, curveLengthSamples, curvePoint, lerpCurvePoint, splitCubic } from './curve-range';
import { buildRuntimePathData, roundedCorner } from './path-data';
import { strokeNormal, strokeOffset } from './stroke-expansion';
const EPSILON = 1e-8;
/** Includes the implicit Z edge without ever adding an editable point. */
export function outlineContourSegments(contour) {
    const lines = contour.lines.filter(line => line.points.length >= 2);
    const first = lines[0]?.points[0], last = lines[lines.length - 1]?.points[1];
    // Keep the address stable even when deformation collapses this edge to zero length.
    return contour.closed && first && last && first.id !== last.id
        ? [...lines, { id: `${contour.id}:close`, type: 'line', points: [last, first] }] : lines;
}
export function outlinePositionPoint(contour, position, rounded = true) {
    const segments = outlineContourSegments(contour), index = segments.findIndex(line => line.id === position.segmentId);
    if (index < 0)
        return undefined;
    const t = clamp(position.t), pieces = mappedPieces(segments, index, contour.closed, rounded);
    const piece = pieces.find(piece => t <= piece.to + EPSILON) ?? pieces[pieces.length - 1];
    return piece && curvePoint(piece.line, clamp((t - piece.from) / Math.max(EPSILON, piece.to - piece.from)));
}
/** Nearest source-local address, used by endpoint dragging without changing topology. */
export function closestOutlinePosition(contour, point, rounded = true) {
    const segments = outlineContourSegments(contour);
    let best, distance = Infinity;
    segments.forEach((segment, index) => mappedPieces(segments, index, contour.closed, rounded).forEach(piece => {
        let t = 0, step = 1 / 48;
        for (let i = 0; i <= 48; i++) {
            const candidate = curvePoint(piece.line, i / 48), d = squaredDistance(candidate, point);
            if (d < distance) {
                distance = d;
                t = i / 48;
                best = { segmentId: segment.id, t: piece.from + (piece.to - piece.from) * t };
            }
        }
        if (best?.segmentId !== segment.id || best.t < piece.from || best.t > piece.to)
            return;
        t = (best.t - piece.from) / Math.max(EPSILON, piece.to - piece.from);
        for (let i = 0; i < 16; i++) {
            const left = clamp(t - step), right = clamp(t + step);
            const dl = squaredDistance(curvePoint(piece.line, left), point), dr = squaredDistance(curvePoint(piece.line, right), point);
            if (dl < distance || dr < distance) {
                t = dl < dr ? left : right;
                distance = Math.min(dl, dr);
            }
            step /= 2;
        }
        best = { segmentId: segment.id, t: piece.from + (piece.to - piece.from) * t };
    }));
    return best;
}
export function outlineSectionLines(contour, section, rounded = true) {
    const segments = outlineContourSegments(contour);
    const start = segments.findIndex(line => line.id === section.start.segmentId), end = segments.findIndex(line => line.id === section.end.segmentId);
    if (start < 0 || end < 0)
        return [];
    const from = start + clamp(section.start.t);
    let to = end + clamp(section.end.t);
    if (section.fullContour && contour.closed)
        to = from + segments.length;
    else if (contour.closed && to < from)
        to += segments.length;
    if (to <= from + EPSILON)
        return [];
    const result = [];
    for (let index = Math.floor(from); index < Math.ceil(to); index++) {
        const local = index % segments.length, rangeStart = Math.max(0, from - index), rangeEnd = Math.min(1, to - index);
        mappedPieces(segments, local, contour.closed, rounded).forEach(piece => {
            const a = Math.max(rangeStart, piece.from), b = Math.min(rangeEnd, piece.to);
            if (b - a > EPSILON)
                result.push(rangeLine(piece.line, (a - piece.from) / (piece.to - piece.from), (b - piece.from) / (piece.to - piece.from)));
        });
    }
    return result;
}
export function outlineSectionPathData(contour, section, rounded = true) {
    return buildRuntimePathData([{ id: section.id, closed: !!section.fullContour && contour.closed, lines: outlineSectionLines(contour, section, rounded) }], false);
}
/** The only stroke projection used by editor, export and portable playback. */
export function projectOutlineSections(contours, sections, style) {
    const completeSamples = new Map();
    const projected = sections.flatMap(section => {
        const contour = contours.find(contour => contour.id === section.contourId);
        if (!contour)
            return [];
        const lines = outlineSectionLines(contour, section, style.rounded !== false), samples = flatten(lines);
        if (samples.length < 2 || samples[samples.length - 1].distance <= EPSILON)
            return [];
        const length = samples[samples.length - 1].distance;
        const full = fullSection(contour);
        if (section.start.segmentId === full.start.segmentId && section.start.t === 0
            && section.end.segmentId === full.end.segmentId && section.end.t === 1
            && !!section.fullContour === !!full.fullContour)
            completeSamples.set(contour, samples);
        return [{ section, contour, lines, samples: taperSamples(samples, section, length), length }];
    });
    const total = projected.reduce((sum, item) => sum + item.length, 0);
    let budget = total * clamp(style.drawProgress ?? 1);
    const problem = outlineDashComplexityProblem(total, style.dasharray ?? []);
    const stroke = [];
    projected.forEach(item => {
        const visible = Math.min(item.length, Math.max(0, budget));
        budget -= item.length;
        const ranges = problem ? [] : dashRanges(visible, style.dasharray ?? [], style.dashoffset ?? 0);
        const wholeClosed = !!item.section.fullContour && item.contour.closed && visible === item.length
            && !(item.section.startTaper?.length || item.section.endTaper?.length);
        // A painted dash spanning the contour seam is one run and must not acquire two caps there.
        if (wholeClosed && ranges.length > 1 && ranges[0][0] === 0 && ranges[ranges.length - 1][1] === item.length) {
            const first = ranges.shift(), last = ranges.pop();
            stroke.push(expandStroke([...sampleRange(item.samples, last[0], last[1]), ...sampleRange(item.samples, first[0], first[1]).slice(1)], item.length, item.section, style, false));
        }
        ranges.forEach(([start, end]) => {
            const samples = sampleRange(item.samples, start, end);
            const closed = wholeClosed && start === 0 && end === item.length;
            stroke.push(expandStroke(samples, item.length, item.section, style, closed));
        });
    });
    const source = contours.flatMap(contour => completeSamples.get(contour) ?? flatten(outlineSectionLines(contour, fullSection(contour), style.rounded !== false)));
    return {
        strokeData: stroke.filter(Boolean).join(' '),
        sections: projected.map(item => ({ id: item.section.id, data: buildRuntimePathData([{ id: item.section.id, closed: !!item.section.fullContour && item.contour.closed, lines: item.lines }], false), length: item.length, start: item.samples[0], end: item.samples[item.samples.length - 1] })),
        sourceBounds: bounds(source),
        ...(problem ? { problem } : {}),
    };
}
export function fullOutlineSections(contours) {
    return contours.filter(contour => outlineContourSegments(contour).length).map(fullSection);
}
/** Validates authored addresses without projecting or silently repairing their geometry. */
export function outlineSectionsProblem(contours, sections) {
    if (!Array.isArray(sections))
        return 'Outline sections must be a list.';
    const ids = new Set(), occupied = new Map();
    for (const section of sections) {
        if (!section || typeof section.id !== 'string' || !section.id || ids.has(section.id))
            return 'Outline section IDs must be unique.';
        ids.add(section.id);
        const contour = contours.find(contour => contour.id === section.contourId);
        if (!contour)
            return 'An outline section refers to a missing contour.';
        const segments = outlineContourSegments(contour);
        for (const position of [section.start, section.end])
            if (!position || !Number.isFinite(position.t) || position.t < 0 || position.t > 1 || !segments.some(line => line.id === position.segmentId))
                return 'An outline endpoint refers to a missing segment or invalid curve position.';
        for (const taper of [section.startTaper, section.endTaper])
            if (taper !== undefined && (!taper || typeof taper !== 'object' || ![taper.length, taper.tipWidth].every(value => Number.isFinite(value) && value >= 0 && value <= 1)))
                return 'Outline taper values must be between zero and one.';
        if (section.fullContour !== undefined && typeof section.fullContour !== 'boolean')
            return 'The full-contour flag must be a boolean.';
        if ((section.startTaper?.length ?? 0) + (section.endTaper?.length ?? 0) > 1 + EPSILON)
            return 'The two outline tapers cannot overlap.';
        if (section.fullContour && !contour.closed)
            return 'A whole-contour outline requires a closed contour.';
        const start = segments.findIndex(line => line.id === section.start.segmentId) + section.start.t;
        let end = segments.findIndex(line => line.id === section.end.segmentId) + section.end.t;
        if (section.fullContour)
            end = start + segments.length;
        else if (end < start && contour.closed)
            end += segments.length;
        else if (end < start)
            return 'An open outline must end after its start.';
        const ranges = end <= segments.length ? [[start, end]] : [[start, segments.length], [0, end - segments.length]];
        const others = occupied.get(contour.id) ?? [];
        if (ranges.some(([a, b]) => others.some(([c, d]) => Math.min(b, d) - Math.max(a, c) > EPSILON)))
            return 'Outline sections cannot overlap.';
        occupied.set(contour.id, [...others, ...ranges]);
    }
    return undefined;
}
function fullSection(contour) {
    const lines = outlineContourSegments(contour);
    return { id: `${contour.id}:outline`, contourId: contour.id, start: { segmentId: lines[0]?.id ?? '', t: 0 }, end: { segmentId: lines[lines.length - 1]?.id ?? '', t: 1 }, ...(contour.closed ? { fullContour: true } : {}) };
}
function mappedPieces(lines, index, closed, rounded) {
    const line = lines[index];
    if (!rounded)
        return [{ line, from: 0, to: 1 }];
    const neighbor = (step) => {
        for (let offset = 1; offset < lines.length; offset++) {
            const at = index + step * offset;
            if (!closed && (at < 0 || at >= lines.length))
                return undefined;
            const candidate = lines[(at + lines.length) % lines.length];
            if (candidate.type === 'bezier' || distance(candidate.points[0], candidate.points[1]) > EPSILON)
                return candidate;
        }
        return undefined;
    };
    const previous = neighbor(-1), next = neighbor(1);
    const start = previous ? roundedCorner(previous, line) : null;
    const end = next ? roundedCorner(line, next) : null;
    if (!start && !end)
        return [{ line, from: 0, to: 1 }];
    const length = distance(line.points[0], line.points[1]);
    if (length <= EPSILON)
        return [{ line, from: 0, to: 1 }];
    const from = start ? distance(line.points[0], start.after) / length : 0;
    const to = end ? 1 - distance(line.points[1], end.before) / length : 1;
    const pieces = [];
    if (start)
        pieces.push({ line: cubicLine(line.id, splitCubic(start.before, start.controlBefore, start.controlAfter, start.after, .5)[1]), from: 0, to: from });
    pieces.push({ line: { id: line.id, type: 'line', points: [start?.after ?? line.points[0], end?.before ?? line.points[1]] }, from, to });
    if (end)
        pieces.push({ line: cubicLine(line.id, splitCubic(end.before, end.controlBefore, end.controlAfter, end.after, .5)[0]), from: to, to: 1 });
    return pieces;
}
function rangeLine(line, start, end) {
    if (line.type === 'bezier' && line.controlStart && line.controlEnd)
        return cubicLine(line.id, cubicRange(line.points[0], line.controlStart, line.controlEnd, line.points[1], start, end));
    return { id: line.id, type: 'line', points: [runtimePoint(lerpCurvePoint(line.points[0], line.points[1], start)), runtimePoint(lerpCurvePoint(line.points[0], line.points[1], end))] };
}
function cubicLine(id, points) {
    return { id, type: 'bezier', points: [runtimePoint(points[0]), runtimePoint(points[3])], controlStart: runtimePoint(points[1]), controlEnd: runtimePoint(points[2]) };
}
function runtimePoint(point) { return { id: '', ...point }; }
function flatten(lines) {
    const result = [];
    let length = 0;
    for (const line of lines) {
        const samples = curveLengthSamples(line);
        for (let index = 0; index < samples.length; index++) {
            const point = curvePoint(line, samples[index].t), previous = result[result.length - 1];
            if (previous) {
                const delta = distance(point, previous);
                if (delta <= EPSILON)
                    continue;
                length += delta;
            }
            result.push({ x: point.x, y: point.y, distance: length });
        }
    }
    return result;
}
function sampleRange(source, start, end) {
    if (end - start <= EPSILON)
        return [sampleAtDistance(source, start)];
    return [sampleAtDistance(source, start), ...source.filter(point => point.distance > start + EPSILON && point.distance < end - EPSILON), sampleAtDistance(source, end)];
}
function sampleAtDistance(source, desired) {
    // Samples are ordered by cumulative distance. Taper sampling queries every
    // vertex, so a linear scan here made dense outlines quadratic per frame.
    let low = 0, high = source.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (source[middle].distance < desired)
            low = middle + 1;
        else
            high = middle;
    }
    const after = low === source.length ? -1 : low;
    if (after < 0) {
        const last = source[source.length - 1];
        return { x: last.x, y: last.y, distance: desired, tangent: direction(source[source.length - 2] ?? source[0], last) };
    }
    if (after === 0)
        return { x: source[0].x, y: source[0].y, distance: desired, tangent: direction(source[0], source[1] ?? source[0]) };
    const a = source[after - 1], b = source[after], t = (desired - a.distance) / (b.distance - a.distance);
    const point = lerpCurvePoint(a, b, t);
    return { x: point.x, y: point.y, distance: desired, tangent: direction(a, b) };
}
/** Sample width variation once per authored end, not once for every dash fragment. */
function taperSamples(source, section, length) {
    const distances = source.map(point => point.distance);
    for (const [taper, end] of [[section.startTaper, false], [section.endTaper, true]]) {
        if (!taper || taper.length <= 0 || taper.tipWidth === 1)
            continue;
        for (let index = 0; index <= 32; index++)
            distances.push(end ? length * (1 - taper.length * index / 32) : length * taper.length * index / 32);
    }
    return [...new Set(distances)].sort((a, b) => a - b).map(value => sampleAtDistance(source, value));
}
/** Prevent authoring or importing patterns that would create unbounded per-frame geometry. */
export function outlineDashComplexityProblem(length, input) {
    const pattern = input.filter(value => Number.isFinite(value) && value >= 0), total = pattern.reduce((sum, value) => sum + value, 0);
    if (total > 0 && length / total * pattern.length > 40000)
        return 'This dash pattern creates more than 20,000 outline dashes. Increase the dash lengths or remove dashes before editing the outline.';
    return undefined;
}
export function outlineProjectionProblem(contours, sections, style) {
    const length = sections.reduce((total, section) => {
        const contour = contours.find(contour => contour.id === section.contourId);
        if (!contour)
            return total;
        return total + outlineSectionLines(contour, section, style.rounded !== false).reduce((sum, line) => {
            const samples = curveLengthSamples(line);
            return sum + samples[samples.length - 1].length;
        }, 0);
    }, 0);
    return outlineDashComplexityProblem(length, style.dasharray ?? []);
}
function dashRanges(length, input, offset) {
    const normalized = input.filter(value => Number.isFinite(value) && value >= 0);
    const pattern = normalized.length % 2 ? [...normalized, ...normalized] : normalized;
    const total = pattern.reduce((sum, value) => sum + value, 0);
    if (length <= EPSILON)
        return [];
    if (total <= EPSILON)
        return [[0, length]];
    let phase = ((offset % total) + total) % total, index = 0;
    while (phase > EPSILON && phase >= pattern[index] && index < pattern.length - 1) {
        phase -= pattern[index];
        index++;
    }
    let remaining = pattern[index] - phase, consumed = 0;
    const result = [];
    while (consumed <= length + EPSILON) {
        if (remaining <= EPSILON) {
            if (index % 2 === 0 && pattern[index] === 0)
                result.push([consumed, consumed]);
            index = (index + 1) % pattern.length;
            remaining = pattern[index];
            continue;
        }
        if (consumed >= length - EPSILON)
            break;
        const next = Math.min(length, consumed + remaining);
        if (index % 2 === 0)
            result.push([consumed, next]);
        remaining -= next - consumed;
        consumed = next;
    }
    return result;
}
function expandStroke(source, sectionLength, section, style, closed) {
    if (!source.length || style.width <= 0)
        return '';
    if (source.length === 1) {
        const point = source[0], half = style.width * (style.alignment && style.alignment !== 'center' ? 1 : .5) * taperAt(point.distance / sectionLength, section);
        if (style.lineCap === 'round')
            return polygon(Array.from({ length: 32 }, (_, index) => ({ x: point.x + Math.cos(index * Math.PI / 16) * half, y: point.y + Math.sin(index * Math.PI / 16) * half })));
        if (style.lineCap === 'square') {
            const tangent = point.tangent ?? { x: 1, y: 0 }, normal = strokeNormal(tangent, 1);
            return polygon([add(add(point, tangent, -half), normal, -half), add(add(point, tangent, half), normal, -half), add(add(point, tangent, half), normal, half), add(add(point, tangent, -half), normal, half)]);
        }
        return '';
    }
    let points = source;
    if (closed && distance(points[0], points[points.length - 1]) <= EPSILON)
        points = points.slice(0, -1);
    const half = style.width * (style.alignment && style.alignment !== 'center' ? 1 : .5);
    const radius = (point) => half * taperAt(point.distance / sectionLength, section);
    const left = [], right = [];
    points.forEach((point, index) => {
        const previous = points[index - 1] ?? (closed ? points[points.length - 1] : undefined);
        const next = points[index + 1] ?? (closed ? points[0] : undefined);
        const before = previous ? direction(previous, point) : direction(point, next);
        const after = next ? direction(point, next) : before;
        const width = radius(point);
        left.push(...joinPoints(point, before, after, width, 1, style));
        right.push(...joinPoints(point, before, after, width, -1, style));
    });
    if (closed)
        return polygon(left) + ' ' + polygon([...right].reverse());
    const start = points[0], end = points[points.length - 1];
    const startDirection = direction(points[0], points[1]), endDirection = direction(points[points.length - 2], end);
    if (style.lineCap === 'square') {
        for (const edge of [left, right]) {
            edge[0] = add(edge[0], startDirection, -radius(start));
            edge[edge.length - 1] = add(edge[edge.length - 1], endDirection, radius(end));
        }
    }
    const endCap = style.lineCap === 'round' ? arc(end, left[left.length - 1], right[right.length - 1], -1) : [];
    const startCap = style.lineCap === 'round' ? arc(start, right[0], left[0], -1) : [];
    return polygon([...left, ...endCap, ...right.reverse(), ...startCap]);
}
function joinPoints(point, before, after, width, side, style) {
    const a = strokeNormal(before, side), b = strokeNormal(after, side);
    const p = add(point, a, width), q = add(point, b, width), cross = before.x * after.y - before.y * after.x;
    if (Math.abs(cross) < 1e-6)
        return [q];
    const denominator = 1 + a.x * b.x + a.y * b.y;
    const miter = denominator > 1e-6 ? { x: point.x + (a.x + b.x) * width / denominator, y: point.y + (a.y + b.y) * width / denominator } : q;
    const outer = cross * side < 0;
    if (!outer)
        return [distance(miter, point) < width * 20 ? miter : q];
    if (style.lineJoin === 'round')
        return [p, ...arc(point, p, q, Math.sign(cross)), q];
    if (style.lineJoin === 'bevel' || distance(miter, point) > width * (style.miterLimit ?? 4))
        return [p, q];
    return [miter];
}
function taperAt(t, section) {
    const start = section.startTaper, end = section.endTaper;
    const startLength = clamp(start?.length ?? 0), endLength = Math.min(1 - startLength, clamp(end?.length ?? 0));
    if (start && startLength > 0 && t < startLength)
        return clamp(start.tipWidth) + (1 - clamp(start.tipWidth)) * smooth(t / startLength);
    if (end && endLength > 0 && t > 1 - endLength)
        return clamp(end.tipWidth) + (1 - clamp(end.tipWidth)) * smooth((1 - t) / endLength);
    return 1;
}
function smooth(t) { t = clamp(t); return t * t * (3 - 2 * t); }
function arc(center, start, end, orientation) {
    const radius = distance(center, start);
    if (radius <= EPSILON)
        return [];
    const a = Math.atan2(start.y - center.y, start.x - center.x);
    let delta = Math.atan2(end.y - center.y, end.x - center.x) - a;
    if (orientation > 0 && delta < 0)
        delta += Math.PI * 2;
    if (orientation < 0 && delta > 0)
        delta -= Math.PI * 2;
    const count = Math.max(2, Math.ceil(Math.abs(delta) * 8));
    return Array.from({ length: count - 1 }, (_, index) => { const angle = a + delta * (index + 1) / count; return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }; });
}
function polygon(points) { return points.length < 3 ? '' : `M ${points.map(point => `${round(point.x)} ${round(point.y)}`).join(' L ')} Z`; }
function bounds(points) {
    if (!points.length)
        return { x: 0, y: 0, width: 0, height: 0 };
    const xs = points.map(point => point.x), ys = points.map(point => point.y), x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
function direction(a, b) { const length = distance(a, b); return { x: (b.x - a.x) / Math.max(EPSILON, length), y: (b.y - a.y) / Math.max(EPSILON, length) }; }
const add = strokeOffset;
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function squaredDistance(a, b) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }
function clamp(value) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
function round(value) { return Math.round(value * 10000) / 10000; }
//# sourceMappingURL=outline.js.map