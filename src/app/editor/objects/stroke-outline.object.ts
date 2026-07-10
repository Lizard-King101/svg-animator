import { EditorService } from "src/app/_services/editor.service";
import { Color } from "./color.object";
import { Path, PathContour, RoundedCorner } from "./elements/path.object";
import { Line } from "./line.object";
import { unionFilledPathContours } from "./path-boolean.object";
import { Point } from "./point.object";
import { clonePaint } from "./paint.object";

interface Vec {
    x: number;
    y: number;
}

interface OutlineSegment {
    type: 'line' | 'bezier';
    start: Point;
    end: Point;
    controlStart?: Point;
    controlEnd?: Point;
}

interface OffsetPiece {
    segment: OutlineSegment;
    sourceIndex: number;
}

interface StrokeSourceSegment {
    line: Line;
    joinAnchor?: Point;
}

interface StraightRun {
    start: Point;
    end: Point;
    points: Point[];
}

interface SourceOffsets {
    left: OutlineSegment[];
    right: OutlineSegment[];
}

type Side = 1 | -1;
export type StrokeToPathProfile = 'precise' | 'optimized';

const EPSILON = 0.0001;
const OFFSET_TOLERANCE = 0.08;
const MAX_OFFSET_DEPTH = 7;
const MITER_LIMIT = 4;

export function canConvertStrokeToPath(path: Path): boolean {
    return path.settings.stroke_width > 0
        && !!path.settings.stroke
        && path.contours.some((contour) => completeLines(contour).length > 0);
}

export function convertStrokeToPath(path: Path, editor: EditorService, profile: StrokeToPathProfile = 'optimized'): Path | null {
    const strokeWidth = path.settings.stroke_width;
    if(strokeWidth <= 0 || !path.settings.stroke) {
        return null;
    }

    const halfWidth = strokeWidth / 2;
    const converted = new Path(editor);
    converted.name = `${path.name} Outline (${profile === 'optimized' ? 'Optimized' : 'Precise'})`;
    converted.visible = path.visible;
    converted.locked = false;
    converted.opacity = path.opacity;
    converted.transform = { ...path.transform };
    converted.motion = { ...path.motion };
    converted.fillRule = 'evenodd';
    converted.settings = {
        ...path.settings,
        fill_enabled: true,
        fill: clonePaint(path.settings.stroke),
        stroke: null,
        stroke_width: 0,
        line_cap: null,
        line_join: null,
    };
    converted.contours = [];

    path.contours.forEach((contour) => {
        const source = strokeSourceSegments(path, contour, editor);
        if(source.length === 0) {
            return;
        }

        if(contourIsClosed(contour)) {
            const left = sideSegments(source, halfWidth, 1, true, path.settings.line_join);
            const right = sideSegments(source, halfWidth, -1, true, path.settings.line_join);
            if(left.length >= 2) {
                converted.contours.push(converted.createContour(linesFromSegments(prepareOutputSegments(left, profile, halfWidth, true), editor, true), true));
            }
            if(right.length >= 2) {
                converted.contours.push(converted.createContour(linesFromSegments(prepareOutputSegments(reverseSegments(right), profile, halfWidth, true), editor, true), true));
            }
            return;
        }

        const left = sideSegments(source, halfWidth, 1, false, path.settings.line_join);
        const right = sideSegments(source, halfWidth, -1, false, path.settings.line_join);
        if(left.length === 0 || right.length === 0) {
            return;
        }

        const firstLine = source[0].line;
        const lastLine = source[source.length - 1].line;
        const startDirection = lineStartDirection(firstLine);
        const endDirection = lineEndDirection(lastLine);
        const outline = [
            ...left,
            ...capSegments(lastLine.points[1], left[left.length - 1].end, right[right.length - 1].end, path.settings.line_cap, endDirection, halfWidth),
            ...reverseSegments(right),
            ...capSegments(firstLine.points[0], right[0].start, left[0].start, path.settings.line_cap, negate(startDirection), halfWidth),
        ];
        converted.contours.push(converted.createContour(linesFromSegments(prepareOutputSegments(outline, profile, halfWidth, true), editor, true), true));
    });

    if(profile === 'optimized') {
        const pieces = strokePieceContours(path, editor, halfWidth, profile);
        const resolved = unionFilledPathContours(pieces, editor);
        if(resolved?.length) {
            converted.contours = resolved;
            converted.fillRule = 'nonzero';
        }
    }

    return converted.contours.length ? converted : null;
}

function strokePieceContours(path: Path, editor: EditorService, halfWidth: number, profile: StrokeToPathProfile): PathContour[] {
    const pieces: PathContour[] = [];
    const addPiece = (segments: OutlineSegment[]) => {
        const prepared = prepareOutputSegments(segments, profile, halfWidth, true);
        if(prepared.length >= 2) {
            pieces.push({
                id: editor.ID,
                closed: true,
                lines: linesFromSegments(prepared, editor, true),
            });
        }
    };

    path.contours.forEach((contour) => {
        const source = strokeSourceSegments(path, contour, editor);
        const closed = contourIsClosed(contour);
        const offsets: SourceOffsets[] = source.map(({ line }) => ({
            left: offsetLine(line, halfWidth, 1),
            right: offsetLine(line, halfWidth, -1),
        }));

        offsets.forEach(({ left, right }) => {
            if(left.length === 0 || right.length === 0) {
                return;
            }

            addPiece([
                ...left,
                lineSegment(left[left.length - 1].end, right[right.length - 1].end),
                ...reverseSegments(right),
                lineSegment(right[0].start, left[0].start),
            ]);
        });

        source.forEach((current, index) => {
            if(!current.joinAnchor || (!closed && index === 0)) {
                return;
            }

            const previousIndex = index === 0 ? source.length - 1 : index - 1;
            const patch = joinPatchSegments(
                source[previousIndex].line,
                current.line,
                offsets[previousIndex],
                offsets[index],
                current.joinAnchor,
                halfWidth,
                path.settings.line_join,
            );
            if(patch.length) {
                addPiece(patch);
            }
        });

        if(!closed && source.length > 0) {
            const firstLine = source[0].line;
            const lastLine = source[source.length - 1].line;
            const firstOffsets = offsets[0];
            const lastOffsets = offsets[offsets.length - 1];
            if(firstOffsets.left.length && firstOffsets.right.length) {
                const startPatch = capPatchSegments(
                    firstLine.points[0],
                    firstOffsets.right[0].start,
                    firstOffsets.left[0].start,
                    path.settings.line_cap,
                    negate(lineStartDirection(firstLine)),
                    halfWidth,
                );
                if(startPatch.length) addPiece(startPatch);
            }
            if(lastOffsets.left.length && lastOffsets.right.length) {
                const endPatch = capPatchSegments(
                    lastLine.points[1],
                    lastOffsets.left[lastOffsets.left.length - 1].end,
                    lastOffsets.right[lastOffsets.right.length - 1].end,
                    path.settings.line_cap,
                    lineEndDirection(lastLine),
                    halfWidth,
                );
                if(endPatch.length) addPiece(endPatch);
            }
        }
    });

    return pieces;
}

function joinPatchSegments(
    previousLine: Line,
    nextLine: Line,
    previousOffsets: SourceOffsets,
    nextOffsets: SourceOffsets,
    anchor: Point,
    halfWidth: number,
    join: string | null,
): OutlineSegment[] {
    const turn = cross(lineEndDirection(previousLine), lineStartDirection(nextLine));
    if(Math.abs(turn) <= EPSILON) {
        return [];
    }

    const outerSide: Side = turn > 0 ? -1 : 1;
    const previousOuter = outerSide === 1 ? previousOffsets.left : previousOffsets.right;
    const nextOuter = outerSide === 1 ? nextOffsets.left : nextOffsets.right;
    if(previousOuter.length === 0 || nextOuter.length === 0) {
        return [];
    }

    const previousSegment = previousOuter[previousOuter.length - 1];
    const nextSegment = nextOuter[0];
    const from = previousSegment.end;
    const to = nextSegment.start;
    let boundary: OutlineSegment[];

    if(join === 'round') {
        boundary = arcSegments(anchor, from, to, turn > 0 ? 1 : -1);
    } else if(join == null || join === 'miter') {
        const intersection = lineIntersection(
            from,
            segmentEndDirection(previousSegment),
            to,
            segmentStartDirection(nextSegment),
        );
        boundary = intersection && distance(anchor, intersection) <= halfWidth * MITER_LIMIT
            ? [lineSegment(from, intersection), lineSegment(intersection, to)]
            : [lineSegment(from, to)];
    } else {
        boundary = [lineSegment(from, to)];
    }

    return [
        ...boundary,
        lineSegment(to, anchor),
        lineSegment(anchor, from),
    ];
}

function capPatchSegments(center: Point, from: Point, to: Point, cap: string | null, direction: Vec, halfWidth: number): OutlineSegment[] {
    if(cap !== 'round' && cap !== 'square') {
        return [];
    }

    return [
        ...capSegments(center, from, to, cap, direction, halfWidth),
        lineSegment(to, from),
    ];
}

function lineSegment(start: Point, end: Point): OutlineSegment {
    return { type: 'line', start, end };
}

function strokeSourceSegments(path: Path, contour: PathContour, editor: EditorService): StrokeSourceSegment[] {
    const lines = completeLines(contour);
    const closed = contourIsClosed(contour);
    const cornerCache = new Map<string, RoundedCorner | null>();
    const cornerFor = (anchor: Point) => {
        if(!cornerCache.has(anchor.id)) {
            cornerCache.set(anchor.id, path.roundedCornerFor(anchor));
        }
        return cornerCache.get(anchor.id) ?? null;
    };
    const source: StrokeSourceSegment[] = [];

    lines.forEach((line, index) => {
        const startCorner = cornerFor(line.points[0]);
        const endCorner = cornerFor(line.points[1]);
        const roundedStart = startCorner?.outgoing === line ? startCorner : null;
        const roundedEnd = endCorner?.incoming === line ? endCorner : null;
        const start = roundedStart?.after ?? line.points[0];
        const end = roundedEnd?.before ?? line.points[1];
        const renderedLine = start === line.points[0] && end === line.points[1]
            ? line
            : new Line(editor, {
                type: line.type,
                points: [start, end],
                controlStart: line.controlStart,
                controlEnd: line.controlEnd,
            });

        source.push({
            line: renderedLine,
            joinAnchor: !roundedStart && (closed || index > 0) ? line.points[0] : undefined,
        });

        if(roundedEnd) {
            source.push({
                line: new Line(editor, {
                    type: 'bezier',
                    points: [roundedEnd.before, roundedEnd.after],
                    controlStart: roundedEnd.controlBefore,
                    controlEnd: roundedEnd.controlAfter,
                }),
            });
        }
    });

    return source;
}

function prepareOutputSegments(segments: OutlineSegment[], profile: StrokeToPathProfile, halfWidth: number, closed: boolean): OutlineSegment[] {
    if(profile === 'precise') {
        return segments;
    }

    const tolerance = Math.min(OFFSET_TOLERANCE, Math.max(0.01, halfWidth * 0.002));
    return simplifyStraightSegments(segments, tolerance, closed);
}

function simplifyStraightSegments(segments: OutlineSegment[], tolerance: number, closed: boolean): OutlineSegment[] {
    const result: OutlineSegment[] = [];
    let run: StraightRun | undefined;

    const flushRun = () => {
        if(!run) {
            return;
        }

        result.push({ type: 'line', start: run.start, end: run.end });
        run = undefined;
    };

    segments.forEach((segment) => {
        if(segment.type === 'line' && distance(segment.start, segment.end) <= EPSILON) {
            return;
        }

        const points = straightSegmentPoints(segment, tolerance);
        if(!points) {
            flushRun();
            result.push(segment);
            return;
        }

        if(!run || distance(run.end, segment.start) > EPSILON) {
            flushRun();
            run = { start: segment.start, end: segment.end, points };
            return;
        }

        const candidatePoints = [...run.points, ...points.slice(1)];
        if(pointsFitChord(candidatePoints, run.start, segment.end, tolerance)) {
            run.end = segment.end;
            run.points = candidatePoints;
            return;
        }

        flushRun();
        run = { start: segment.start, end: segment.end, points };
    });
    flushRun();

    return closed ? simplifyClosedBoundary(result, tolerance) : result;
}

function simplifyClosedBoundary(segments: OutlineSegment[], tolerance: number): OutlineSegment[] {
    const result = segments.slice();
    while(result.length > 2) {
        const first = result[0];
        const last = result[result.length - 1];
        if(first.type !== 'line' || last.type !== 'line' || distance(last.end, first.start) > EPSILON) {
            break;
        }

        const points = [last.start, last.end, first.end];
        if(!pointsFitChord(points, last.start, first.end, tolerance)) {
            break;
        }

        result.splice(0, 1, { type: 'line', start: last.start, end: first.end });
        result.pop();
    }
    return result;
}

function straightSegmentPoints(segment: OutlineSegment, tolerance: number): Point[] | null {
    const points = segment.type === 'bezier' && segment.controlStart && segment.controlEnd
        ? [segment.start, segment.controlStart, segment.controlEnd, segment.end]
        : [segment.start, segment.end];
    return pointsFitChord(points, segment.start, segment.end, tolerance) ? points : null;
}

function pointsFitChord(points: Point[], start: Point, end: Point, tolerance: number): boolean {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = (dx * dx) + (dy * dy);
    if(lengthSquared <= EPSILON * EPSILON) {
        return false;
    }

    const length = Math.sqrt(lengthSquared);
    const projectionTolerance = EPSILON / length;
    return points.every((point) => {
        const px = point.x - start.x;
        const py = point.y - start.y;
        const projection = ((px * dx) + (py * dy)) / lengthSquared;
        const perpendicularDistance = Math.abs((px * dy) - (py * dx)) / length;
        return projection >= -projectionTolerance
            && projection <= 1 + projectionTolerance
            && perpendicularDistance <= tolerance;
    });
}

function sideSegments(source: StrokeSourceSegment[], halfWidth: number, side: Side, closed: boolean, join: string | null): OutlineSegment[] {
    const pieces = source.flatMap(({ line }, sourceIndex) => {
        return offsetLine(line, halfWidth, side).map((segment) => ({ segment, sourceIndex }));
    });
    if(pieces.length === 0) {
        return [];
    }

    const result: OutlineSegment[] = [];
    pieces.forEach((piece, index) => {
        const segment = piece.segment;
        if(index > 0) {
            const previous = pieces[index - 1];
            const anchor = previous.sourceIndex === piece.sourceIndex ? undefined : source[piece.sourceIndex].joinAnchor;
            result.push(...joinSegments(previous.segment, segment, anchor, halfWidth, side, join));
        }
        result.push(segment);
    });

    if(closed && pieces.length > 1) {
        result.push(...joinSegments(pieces[pieces.length - 1].segment, pieces[0].segment, source[0].joinAnchor, halfWidth, side, join));
    }

    return result;
}

function offsetLine(line: Line, halfWidth: number, side: Side): OutlineSegment[] {
    if(line.points.length < 2) {
        return [];
    }

    const start = line.points[0];
    const end = line.points[1];
    if(line.type !== 'bezier' || !line.controlStart || !line.controlEnd) {
        const normal = normalFromDirection(unit(start, end), side);
        return [{
            type: 'line',
            start: offsetPoint(start, normal, halfWidth),
            end: offsetPoint(end, normal, halfWidth),
        }];
    }

    return offsetCubic({
        start,
        controlStart: line.controlStart,
        controlEnd: line.controlEnd,
        end,
    }, halfWidth, side, 0);
}

function offsetCubic(
    cubic: { start: Point; controlStart: Point; controlEnd: Point; end: Point },
    halfWidth: number,
    side: Side,
    depth: number
): OutlineSegment[] {
    const startDerivative = cubicDerivative(cubic, 0);
    const endDerivative = cubicDerivative(cubic, 1);
    const startDirection = unitVector(startDerivative) ?? unit(cubic.start, cubic.end);
    const endDirection = unitVector(endDerivative) ?? startDirection;
    const start = offsetPoint(cubic.start, normalFromDirection(startDirection, side), halfWidth);
    const end = offsetPoint(cubic.end, normalFromDirection(endDirection, side), halfWidth);
    const chord = distance(start, end);
    const handleLength = Math.max(chord / 3, EPSILON);
    const fitted: OutlineSegment = {
        type: 'bezier',
        start,
        controlStart: new Point(start.x + (startDirection.x * handleLength), start.y + (startDirection.y * handleLength)),
        controlEnd: new Point(end.x - (endDirection.x * handleLength), end.y - (endDirection.y * handleLength)),
        end,
    };

    if(depth >= MAX_OFFSET_DEPTH || offsetError(cubic, fitted, halfWidth, side) <= Math.max(OFFSET_TOLERANCE, halfWidth * 0.02)) {
        return [fitted];
    }

    const [left, right] = splitCubic(cubic, 0.5);
    return [
        ...offsetCubic(left, halfWidth, side, depth + 1),
        ...offsetCubic(right, halfWidth, side, depth + 1),
    ];
}

function offsetError(
    source: { start: Point; controlStart: Point; controlEnd: Point; end: Point },
    candidate: OutlineSegment,
    halfWidth: number,
    side: Side
): number {
    return [0.25, 0.5, 0.75].reduce((maxError, t) => {
        const sourcePoint = cubicPoint(source.start, source.controlStart, source.controlEnd, source.end, t);
        const derivative = cubicDerivative(source, t);
        const direction = unitVector(derivative) ?? unit(source.start, source.end);
        const expected = offsetPoint(sourcePoint, normalFromDirection(direction, side), halfWidth);
        const actual = cubicPoint(candidate.start, candidate.controlStart!, candidate.controlEnd!, candidate.end, t);
        return Math.max(maxError, distance(expected, actual));
    }, 0);
}

function joinSegments(previous: OutlineSegment, next: OutlineSegment, anchor: Point | undefined, halfWidth: number, side: Side, join: string | null): OutlineSegment[] {
    if(distance(previous.end, next.start) <= EPSILON) {
        return [];
    }

    if(anchor) {
        const previousDirection = segmentEndDirection(previous);
        const nextDirection = segmentStartDirection(next);
        const turn = cross(previousDirection, nextDirection);
        const intersection = lineIntersection(previous.end, previousDirection, next.start, nextDirection);

        if(join === 'round') {
            if(turn * side > EPSILON) {
                return intersection
                    ? connectAtIntersection(previous, next, intersection)
                    : [{ type: 'line', start: previous.end, end: next.start }];
            }

            if(Math.abs(turn) > EPSILON) {
                return arcSegments(anchor, previous.end, next.start, turn > 0 ? 1 : -1);
            }
        }

        if(join === 'bevel' && turn * side > EPSILON && intersection) {
            return connectAtIntersection(previous, next, intersection);
        }

        if((join == null || join === 'miter') && intersection
            && distance(anchor, intersection) <= halfWidth * MITER_LIMIT) {
            return connectAtIntersection(previous, next, intersection);
        }
    }

    return [{ type: 'line', start: previous.end, end: next.start }];
}

function connectAtIntersection(previous: OutlineSegment, next: OutlineSegment, intersection: Point): OutlineSegment[] {
    if(previous.type === 'line' && next.type === 'line') {
        previous.end = intersection;
        next.start = intersection;
        return [];
    }

    return [
        { type: 'line', start: previous.end, end: intersection },
        { type: 'line', start: intersection, end: next.start },
    ];
}

function capSegments(center: Point, from: Point, to: Point, cap: string | null, direction: Vec, halfWidth: number): OutlineSegment[] {
    if(cap === 'round') {
        return arcSegments(center, from, to, -1);
    }

    if(cap === 'square') {
        const extendedFrom = new Point(from.x + (direction.x * halfWidth), from.y + (direction.y * halfWidth));
        const extendedTo = new Point(to.x + (direction.x * halfWidth), to.y + (direction.y * halfWidth));
        return [
            { type: 'line', start: from, end: extendedFrom },
            { type: 'line', start: extendedFrom, end: extendedTo },
            { type: 'line', start: extendedTo, end: to },
        ];
    }

    return [{ type: 'line', start: from, end: to }];
}

function arcSegments(center: Point, from: Point, to: Point, side: Side): OutlineSegment[] {
    const radius = distance(center, from);
    if(radius <= EPSILON || distance(center, to) <= EPSILON) {
        return [{ type: 'line', start: from, end: to }];
    }

    let startAngle = Math.atan2(from.y - center.y, from.x - center.x);
    let endAngle = Math.atan2(to.y - center.y, to.x - center.x);
    if(side === 1) {
        while(endAngle < startAngle) endAngle += Math.PI * 2;
    } else {
        while(endAngle > startAngle) endAngle -= Math.PI * 2;
    }

    const sweep = endAngle - startAngle;
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const segments: OutlineSegment[] = [];
    let current = from;
    for(let i = 0; i < steps; i++) {
        const a0 = startAngle + (sweep * i / steps);
        const a1 = startAngle + (sweep * (i + 1) / steps);
        const end = i === steps - 1 ? to : new Point(center.x + Math.cos(a1) * radius, center.y + Math.sin(a1) * radius);
        const k = (4 / 3) * Math.tan((a1 - a0) / 4) * radius;
        const c1 = new Point(current.x - Math.sin(a0) * k, current.y + Math.cos(a0) * k);
        const c2 = new Point(end.x + Math.sin(a1) * k, end.y - Math.cos(a1) * k);
        segments.push({ type: 'bezier', start: current, controlStart: c1, controlEnd: c2, end });
        current = end;
    }
    return segments;
}

function linesFromSegments(segments: OutlineSegment[], editor: EditorService, closed: boolean): Line[] {
    const lines: Line[] = [];
    let previousEnd: Point | undefined;
    let firstPoint: Point | undefined;

    segments.forEach((segment, index) => {
        const start = index === 0
            ? segment.start
            : (previousEnd && distance(previousEnd, segment.start) <= EPSILON ? previousEnd : segment.start);
        const end = closed && index === segments.length - 1 && firstPoint && distance(segment.end, firstPoint) <= EPSILON
            ? firstPoint
            : segment.end;

        if(!firstPoint) {
            firstPoint = start;
        }

        lines.push(new Line(editor, {
            type: segment.type,
            points: [start, end],
            controlStart: segment.controlStart,
            controlEnd: segment.controlEnd,
        }));
        previousEnd = end;
    });

    return lines;
}

function reverseSegments(segments: OutlineSegment[]): OutlineSegment[] {
    return segments.slice().reverse().map((segment) => ({
        type: segment.type,
        start: segment.end,
        end: segment.start,
        controlStart: segment.controlEnd,
        controlEnd: segment.controlStart,
    }));
}

function completeLines(contour: PathContour): Line[] {
    return contour.lines.filter((line) => line.points.length >= 2);
}

function contourIsClosed(contour: PathContour): boolean {
    const lines = completeLines(contour);
    return contour.closed || (lines.length > 1 && distance(lines[0].points[0], lines[lines.length - 1].points[1]) <= EPSILON);
}

function lineStartDirection(line: Line): Vec {
    const start = line.points[0];
    if(line.type === 'bezier' && line.controlStart && distance(start, line.controlStart) > EPSILON) {
        return unit(start, line.controlStart);
    }

    return unit(start, line.points[1]);
}

function lineEndDirection(line: Line): Vec {
    const end = line.points[1];
    if(line.type === 'bezier' && line.controlEnd && distance(line.controlEnd, end) > EPSILON) {
        return unit(line.controlEnd, end);
    }

    return unit(line.points[0], end);
}

function segmentStartDirection(segment: OutlineSegment): Vec {
    if(segment.type === 'bezier' && segment.controlStart) {
        return unit(segment.start, segment.controlStart);
    }

    return unit(segment.start, segment.end);
}

function segmentEndDirection(segment: OutlineSegment): Vec {
    if(segment.type === 'bezier' && segment.controlEnd) {
        return unit(segment.controlEnd, segment.end);
    }

    return unit(segment.start, segment.end);
}

function splitCubic(
    cubic: { start: Point; controlStart: Point; controlEnd: Point; end: Point },
    t: number
): [
    { start: Point; controlStart: Point; controlEnd: Point; end: Point },
    { start: Point; controlStart: Point; controlEnd: Point; end: Point }
] {
    const q0 = lerpPoint(cubic.start, cubic.controlStart, t);
    const q1 = lerpPoint(cubic.controlStart, cubic.controlEnd, t);
    const q2 = lerpPoint(cubic.controlEnd, cubic.end, t);
    const r0 = lerpPoint(q0, q1, t);
    const r1 = lerpPoint(q1, q2, t);
    const mid = lerpPoint(r0, r1, t);
    return [
        { start: cubic.start, controlStart: q0, controlEnd: r0, end: mid },
        { start: mid, controlStart: r1, controlEnd: q2, end: cubic.end },
    ];
}

function cubicPoint(start: Point, controlStart: Point, controlEnd: Point, end: Point, t: number): Point {
    const mt = 1 - t;
    return new Point(
        (mt * mt * mt * start.x) + (3 * mt * mt * t * controlStart.x) + (3 * mt * t * t * controlEnd.x) + (t * t * t * end.x),
        (mt * mt * mt * start.y) + (3 * mt * mt * t * controlStart.y) + (3 * mt * t * t * controlEnd.y) + (t * t * t * end.y),
    );
}

function cubicDerivative(
    cubic: { start: Point; controlStart: Point; controlEnd: Point; end: Point },
    t: number
): Vec {
    const mt = 1 - t;
    return {
        x: (3 * mt * mt * (cubic.controlStart.x - cubic.start.x)) + (6 * mt * t * (cubic.controlEnd.x - cubic.controlStart.x)) + (3 * t * t * (cubic.end.x - cubic.controlEnd.x)),
        y: (3 * mt * mt * (cubic.controlStart.y - cubic.start.y)) + (6 * mt * t * (cubic.controlEnd.y - cubic.controlStart.y)) + (3 * t * t * (cubic.end.y - cubic.controlEnd.y)),
    };
}

function lerpPoint(a: Point, b: Point, t: number): Point {
    return new Point(
        a.x + ((b.x - a.x) * t),
        a.y + ((b.y - a.y) * t),
    );
}

function normalFromDirection(direction: Vec, side: Side): Vec {
    return {
        x: -direction.y * side,
        y: direction.x * side,
    };
}

function negate(vector: Vec): Vec {
    return { x: -vector.x, y: -vector.y };
}

function offsetPoint(point: Point, normal: Vec, distanceValue: number): Point {
    return new Point(point.x + (normal.x * distanceValue), point.y + (normal.y * distanceValue));
}

function unit(a: Point, b: Point): Vec {
    const length = distance(a, b);
    if(length <= EPSILON) {
        return { x: 1, y: 0 };
    }

    return {
        x: (b.x - a.x) / length,
        y: (b.y - a.y) / length,
    };
}

function unitVector(vector: Vec): Vec | null {
    const length = Math.sqrt((vector.x * vector.x) + (vector.y * vector.y));
    if(length <= EPSILON) {
        return null;
    }

    return {
        x: vector.x / length,
        y: vector.y / length,
    };
}

function lineIntersection(pointA: Point, directionA: Vec, pointB: Point, directionB: Vec): Point | null {
    const determinant = cross(directionA, directionB);
    if(Math.abs(determinant) <= EPSILON) {
        return null;
    }

    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const t = ((dx * directionB.y) - (dy * directionB.x)) / determinant;
    return new Point(pointA.x + (directionA.x * t), pointA.y + (directionA.y * t));
}

function cross(a: Vec, b: Vec): number {
    return (a.x * b.y) - (a.y * b.x);
}

function distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt((dx * dx) + (dy * dy));
}
