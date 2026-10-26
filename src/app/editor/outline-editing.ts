import type { OutlinePosition, OutlineSection, OutlineTaper } from '../../../packages/runtime/src/outline';
import { Path, PathContour } from './objects/elements/path.object';
import { outlineContourSegments } from '../../../packages/runtime/src/outline';
import { pathOutlineContour } from './path-outline';

const EPSILON = 1e-8;
const fullWidth = (): OutlineTaper => ({ length: 0, tipWidth: 1 });
type Span = { start: number; end: number; section: OutlineSection };

export function outlinePositionValue(contour: PathContour, position: OutlinePosition): number {
    const index = outlineContourSegments(pathOutlineContour(contour)).findIndex(line => line.id === position.segmentId);
    return index < 0 ? 0 : index + Math.max(0, Math.min(1, position.t));
}
export function outlinePositionFromValue(contour: PathContour, value: number): OutlinePosition {
    const lines = outlineContourSegments(pathOutlineContour(contour)), count = lines.length;
    if(!count) return { segmentId: '', t: 0 };
    let normalized = value;
    if(contour.closed && (value < 0 || value > count)) normalized = ((value % count) + count) % count;
    normalized = Math.max(0, Math.min(count, normalized));
    const index = Math.min(count - 1, Math.floor(normalized));
    return { segmentId: lines[index].id, t: normalized - index };
}
export function fullOutlineSections(path: Path, id: () => string): OutlineSection[] {
    return path.contours.filter(contour => outlineContourSegments(pathOutlineContour(contour)).length).map(contour => ({
        id: id(), contourId: contour.id, start: outlinePositionFromValue(contour, 0),
        end: outlinePositionFromValue(contour, outlineContourSegments(pathOutlineContour(contour)).length),
        ...(contour.closed ? { fullContour: true } : {}),
    }));
}
export function outlineSectionSpan(contour: PathContour, section: OutlineSection): [number, number] {
    const count = outlineContourSegments(pathOutlineContour(contour)).length, start = outlinePositionValue(contour, section.start);
    let end = outlinePositionValue(contour, section.end);
    if(section.fullContour) end = start + count;
    else if(contour.closed && end < start) end += count;
    return [start, end];
}

/** Interval edits operate on source segment coordinates, never on deformed arc lengths. */
export function setOutlineSegmentsVisible(path: Path, sections: OutlineSection[], segmentIds: Set<string>, visible: boolean, id: () => string): OutlineSection[] {
    const result: OutlineSection[] = [];
    for(const contour of path.contours) {
        const lines = outlineContourSegments(pathOutlineContour(contour)), count = lines.length;
        const current = sections.filter(section => section.contourId === contour.id);
        const cuts = lines.flatMap((line, index) => segmentIds.has(line.id) ? [{ start: index, end: index + 1 }] : []);
        if(!cuts.length) { result.push(...structuredClone(current)); continue; }
        let spans: Span[] = current.flatMap(section => {
            const [start, end] = outlineSectionSpan(contour, section);
            if(section.fullContour) return [{start: 0, end: count, section}];
            return end > count ? [{ start, end: count, section }, { start: 0, end: end - count, section }] : [{ start, end, section }];
        });
        if(visible && cuts.every(cut => spans.some(span => span.start <= cut.start && span.end >= cut.end))) {
            result.push(...structuredClone(current)); continue;
        }
        if(visible) {
            for(const cut of cuts) spans.push({ ...cut, section: { id: id(), contourId: contour.id, start: outlinePositionFromValue(contour, cut.start), end: outlinePositionFromValue(contour, cut.end) } });
            spans.sort((a, b) => a.start - b.start);
            const merged: Span[] = [];
            for(const span of spans) {
                const last = merged.at(-1);
                const bridge = cuts.some(cut => cut.start <= span.start + EPSILON && cut.end >= span.start - EPSILON);
                if(last && (span.start < last.end - EPSILON || bridge && span.start <= last.end + EPSILON)) {
                    if(span.end > last.end) { last.end = span.end; last.section = { ...last.section, endTaper: span.section.endTaper }; }
                } else merged.push({ ...span, section: structuredClone(span.section) });
            }
            spans = merged;
        } else {
            for(const cut of cuts) spans = spans.flatMap(span => {
                if(cut.end <= span.start || cut.start >= span.end) return [span];
                const parts: Span[] = [];
                if(cut.start > span.start) parts.push({ start: span.start, end: cut.start, section: { ...span.section, fullContour: false, endTaper: fullWidth() } });
                if(cut.end < span.end) parts.push({ start: cut.end, end: span.end, section: { ...span.section, fullContour: false, startTaper: fullWidth() } });
                return parts;
            });
        }
        spans.sort((a, b) => a.start - b.start);
        // The contour seam is not a new cap when the visible range crosses it.
        const joinedSeam = spans.length > 1 && (spans[0].section.id === spans.at(-1)!.section.id || visible && cuts.some(cut => cut.start === 0 || cut.end === count));
        if(contour.closed && joinedSeam && spans[0].start < EPSILON && spans.at(-1)!.end >= count - EPSILON) {
            const first = spans.shift()!, last = spans.pop()!;
            spans.push({ start: last.start, end: first.end + count, section: { ...last.section, endTaper: first.section.endTaper } });
        }
        const used = new Set<string>();
        for(const span of spans) {
            const sectionId = used.has(span.section.id) ? id() : span.section.id; used.add(sectionId);
            result.push({ ...span.section, id: sectionId, contourId: contour.id,
                start: outlinePositionFromValue(contour, span.start), end: outlinePositionFromValue(contour, span.end),
                fullContour: contour.closed && span.end - span.start >= count - EPSILON });
        }
    }
    return result;
}

/** Stop a dragged end at its opposite end and at the nearest authored neighbour. */
export function moveOutlineEndpoint(contour: PathContour, sections: OutlineSection[], sectionId: string, end: 'start' | 'end', position: OutlinePosition): OutlineSection[] {
    const next = structuredClone(sections), section = next.find(section => section.id === sectionId);
    if(!section) return next;
    const count = outlineContourSegments(pathOutlineContour(contour)).length, [a, b] = outlineSectionSpan(contour, section);
    const original = end === 'start' ? a : b, value = outlinePositionValue(contour, position);
    const candidates = contour.closed ? [value - count, value, value + count, value + count * 2] : [value];
    let target = candidates.reduce((best, candidate) => Math.abs(candidate - original) < Math.abs(best - original) ? candidate : best);
    let min = end === 'start' ? (contour.closed ? b - count : 0) : a;
    let max = end === 'start' ? b : (contour.closed ? a + count : count);
    for(const other of sections.filter(other => other.contourId === contour.id && other.id !== sectionId)) {
        const [x, y] = outlineSectionSpan(contour, other);
        for(const offset of contour.closed ? [-count, 0, count] : [0]) {
            if(end === 'start' && y + offset <= a + EPSILON) min = Math.max(min, y + offset);
            if(end === 'end' && x + offset >= b - EPSILON) max = Math.min(max, x + offset);
        }
    }
    target = Math.max(min, Math.min(max, target));
    section[end] = outlinePositionFromValue(contour, target);
    section.fullContour = contour.closed && (end === 'start' ? b - target : target - a) >= count - EPSILON;
    return next;
}
export function editOutlineTaper(section: OutlineSection, end: 'start' | 'end', field: 'length' | 'tipWidth', value: number): void {
    const key = end === 'start' ? 'startTaper' : 'endTaper', other = end === 'start' ? section.endTaper : section.startTaper;
    const taper = { ...(section[key] ?? fullWidth()) };
    const next = Math.max(0, Math.min(field === 'length' ? 1 - (other?.length ?? 0) : 1, value));
    if(next === taper[field]) return;
    taper[field] = next;
    section[key] = taper;
}
