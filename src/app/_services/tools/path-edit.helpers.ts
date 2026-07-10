import { Path, PathContour } from "../../editor/objects/elements/path.object";
import { Line, LineOptions } from "../../editor/objects/line.object";
import { Point } from "../../editor/objects/point.object";

export type LineFactory = (options: LineOptions) => Line;

export interface PathEditResult {
    changed: boolean;
    selectedAnchor?: Point;
    selectedLine?: Line;
}

export function togglePathLineType(line: Line): boolean {
    if(line.points.length < 2) return false;
    if(line.type === "line") {
        const [start, end] = line.points;
        line.type = "bezier";
        line.controlStart = lerpPoint(start, end, 1 / 3);
        line.controlEnd = lerpPoint(start, end, 2 / 3);
    } else {
        line.type = "line";
        line.controlStart = undefined;
        line.controlEnd = undefined;
    }
    return true;
}

export function insertPathPoint(path: Path, line: Line, createLine: LineFactory, targetPoint?: Point): PathEditResult {
    const contour = contourForLine(path, line);
    const lines = contour?.lines;
    const index = lines?.indexOf(line) ?? -1;
    if(index < 0 || line.points.length < 2) return { changed: false };

    const [start, end] = line.points;
    const fallback = lerpPoint(start, end, 0.5);
    const t = line.type === "bezier" && line.controlStart && line.controlEnd
        ? closestBezierT(start, line.controlStart, line.controlEnd, end, targetPoint ?? fallback)
        : closestLineT(start, end, targetPoint ?? fallback);

    if(line.type === "bezier" && line.controlStart && line.controlEnd) {
        const q0 = lerpPoint(start, line.controlStart, t);
        const q1 = lerpPoint(line.controlStart, line.controlEnd, t);
        const q2 = lerpPoint(line.controlEnd, end, t);
        const r0 = lerpPoint(q0, q1, t);
        const r1 = lerpPoint(q1, q2, t);
        const midpoint = lerpPoint(r0, r1, t);
        line.points = [start, midpoint];
        line.controlStart = q0;
        line.controlEnd = r0;
        const next = createLine({
            type: "bezier",
            points: [midpoint, end],
            controlStart: r1,
            controlEnd: q2,
        });
        lines!.splice(index + 1, 0, next);
        return { changed: true, selectedAnchor: midpoint, selectedLine: next };
    }

    const midpoint = lerpPoint(start, end, t);
    line.points = [start, midpoint];
    const next = createLine({ points: [midpoint, end] });
    lines!.splice(index + 1, 0, next);
    return { changed: true, selectedAnchor: midpoint, selectedLine: next };
}

export function deletePathAnchor(path: Path, anchor: Point, createLine: LineFactory): PathEditResult {
    const contour = contourForAnchor(path, anchor);
    if(!contour) return { changed: false };
    const lines = contour.lines;
    const anchorCount = lines.length + (contour.closed ? 0 : 1);
    if(anchorCount <= 2) return { changed: false };

    if(contour.closed && lines.length > 1 && lines[0].points[0] === anchor) {
        const first = lines[0];
        const last = lines[lines.length - 1];
        const mergedIsBezier = last.type === "bezier" || first.type === "bezier";
        const merged = createLine({
            type: mergedIsBezier ? "bezier" : "line",
            points: [last.points[0], first.points[1]],
            controlStart: last.type === "bezier" ? last.controlStart : (mergedIsBezier ? clonePoint(last.points[0]) : undefined),
            controlEnd: first.type === "bezier" ? first.controlEnd : (mergedIsBezier ? clonePoint(first.points[1]) : undefined),
        });
        lines.splice(lines.length - 1, 1);
        lines.splice(0, 1, merged);
        return { changed: true, selectedLine: merged };
    }

    const incomingIndex = lines.findIndex((candidate) => candidate.points[1] === anchor);
    const outgoingIndex = lines.findIndex((candidate) => candidate.points[0] === anchor);
    if(incomingIndex < 0 && outgoingIndex < 0) return { changed: false };
    if(incomingIndex < 0) {
        lines.splice(outgoingIndex, 1);
        return { changed: true, selectedLine: lines[outgoingIndex] ?? lines[outgoingIndex - 1] };
    }
    if(outgoingIndex < 0) {
        lines.splice(incomingIndex, 1);
        return { changed: true, selectedLine: lines[incomingIndex] ?? lines[incomingIndex - 1] };
    }

    const incoming = lines[incomingIndex];
    const outgoing = lines[outgoingIndex];
    const mergedIsBezier = incoming.type === "bezier" || outgoing.type === "bezier";
    const merged = createLine({
        type: mergedIsBezier ? "bezier" : "line",
        points: [incoming.points[0], outgoing.points[1]],
        controlStart: incoming.type === "bezier" ? incoming.controlStart : (mergedIsBezier ? clonePoint(incoming.points[0]) : undefined),
        controlEnd: outgoing.type === "bezier" ? outgoing.controlEnd : (mergedIsBezier ? clonePoint(outgoing.points[1]) : undefined),
    });
    lines.splice(incomingIndex, 1, merged);
    lines.splice(outgoingIndex > incomingIndex ? outgoingIndex : outgoingIndex + 1, 1);
    return { changed: true, selectedLine: merged };
}

export function contourForLine(path: Path, line: Line): PathContour | undefined {
    return path.contours.find((contour) => contour.lines.includes(line));
}

function contourForAnchor(path: Path, anchor: Point): PathContour | undefined {
    return path.contours.find((contour) => contour.lines.some((line) => line.points[0] === anchor || line.points[1] === anchor));
}

function clonePoint(point: Point): Point { return point.add(0, 0); }

function lerpPoint(a: Point, b: Point, t: number): Point {
    return new Point(a.x + ((b.x - a.x) * t), a.y + ((b.y - a.y) * t));
}

function closestLineT(start: Point, end: Point, target: Point): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = (dx * dx) + (dy * dy);
    return lengthSquared === 0 ? 0.5 : clamp01((((target.x - start.x) * dx) + ((target.y - start.y) * dy)) / lengthSquared);
}

function closestBezierT(start: Point, controlStart: Point, controlEnd: Point, end: Point, target: Point): number {
    let bestT = 0.5;
    let bestDistance = Number.POSITIVE_INFINITY;
    for(let i = 0; i <= 40; i++) {
        const t = i / 40;
        const mt = 1 - t;
        const point = new Point(
            (mt ** 3 * start.x) + (3 * mt * mt * t * controlStart.x) + (3 * mt * t * t * controlEnd.x) + (t ** 3 * end.x),
            (mt ** 3 * start.y) + (3 * mt * mt * t * controlStart.y) + (3 * mt * t * t * controlEnd.y) + (t ** 3 * end.y),
        );
        const distance = point.distanceFrom(target);
        if(distance < bestDistance) {
            bestDistance = distance;
            bestT = t;
        }
    }
    return bestT;
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
