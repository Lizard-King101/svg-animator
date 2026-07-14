import { EditorService } from "src/app/_services/editor.service";
import { Path, PathContour } from "./elements/path.object";
import { Line } from "./line.object";
import { Point } from "./point.object";
import { normalizeDashArray } from "./stroke-style.object";

interface LengthSample { t: number; length: number; }

export function dashedPathContours(path: Path, editor: EditorService): PathContour[] {
    return dashedPathContourGroups(path, editor).flatMap((group) => group.pieces);
}

export function dashedPathContourGroups(path: Path, editor: EditorService): Array<{ source: PathContour; pieces: PathContour[] }> {
    const sourcePattern = normalizeDashArray(path.settings.stroke_dasharray);
    if(sourcePattern.length === 0) return path.contours.map((source) => ({ source, pieces: [source] }));
    const pattern = sourcePattern.length % 2 === 1 ? [...sourcePattern, ...sourcePattern] : sourcePattern;
    const patternLength = pattern.reduce((sum, value) => sum + value, 0);
    if(patternLength <= 0) return path.contours.map((source) => ({ source, pieces: [source] }));

    return path.contours.map((source) => ({
        source,
        pieces: dashContour(source, pattern, patternLength, path.settings.stroke_dashoffset, editor),
    }));
}

function dashContour(contour: PathContour, pattern: number[], patternLength: number, offset: number, editor: EditorService): PathContour[] {
    let phase = modulo(offset, patternLength);
    let patternIndex = 0;
    while(phase >= pattern[patternIndex] && pattern[patternIndex] > 0) {
        phase -= pattern[patternIndex];
        patternIndex = (patternIndex + 1) % pattern.length;
    }
    skipZeroEntries();
    let remaining = pattern[patternIndex] - phase;
    const startsPainted = patternIndex % 2 === 0;
    const pieces: PathContour[] = [];
    let current: Line[] = [];

    for(const line of contour.lines.filter((candidate) => candidate.points.length >= 2)) {
        const samples = lengthSamples(line);
        const lineLength = samples[samples.length - 1].length;
        let consumed = 0;
        while(consumed < lineLength - 1e-7) {
            const amount = Math.min(remaining, lineLength - consumed);
            if(patternIndex % 2 === 0 && amount > 1e-7) {
                const segment = subLine(line, tAtLength(samples, consumed), tAtLength(samples, consumed + amount), editor);
                connect(current, segment);
                current.push(segment);
            }
            consumed += amount;
            remaining -= amount;
            if(remaining <= 1e-7) {
                const wasPainted = patternIndex % 2 === 0;
                patternIndex = (patternIndex + 1) % pattern.length;
                skipZeroEntries();
                remaining = pattern[patternIndex];
                if(wasPainted && patternIndex % 2 === 1) flush();
            }
        }
    }
    const endsPainted = current.length > 0;
    flush();

    if(contour.closed && startsPainted && endsPainted && pieces.length > 1) {
        const first = pieces.shift()!;
        const last = pieces.pop()!;
        const joined = [...last.lines];
        first.lines.forEach((line) => {
            connect(joined, line);
            joined.push(line);
        });
        pieces.unshift({ id: editor.ID, closed: false, lines: joined });
    }
    return pieces;

    function skipZeroEntries(): void {
        let count = 0;
        while(pattern[patternIndex] <= 1e-7 && count < pattern.length) {
            patternIndex = (patternIndex + 1) % pattern.length;
            count++;
        }
    }

    function flush(): void {
        if(current.length) pieces.push({ id: editor.ID, closed: false, lines: current });
        current = [];
    }
}

function lengthSamples(line: Line): LengthSample[] {
    if(line.type !== "bezier" || !line.controlStart || !line.controlEnd) {
        return [{ t: 0, length: 0 }, { t: 1, length: Math.hypot(line.points[1].x - line.points[0].x, line.points[1].y - line.points[0].y) }];
    }
    const samples: LengthSample[] = [{ t: 0, length: 0 }];
    let previous = line.points[0];
    let length = 0;
    for(let index = 1; index <= 64; index++) {
        const t = index / 64;
        const point = cubicPoint(line.points[0], line.controlStart, line.controlEnd, line.points[1], t);
        length += Math.hypot(point.x - previous.x, point.y - previous.y);
        samples.push({ t, length });
        previous = point;
    }
    return samples;
}

function tAtLength(samples: LengthSample[], target: number): number {
    if(target <= 0) return 0;
    if(target >= samples[samples.length - 1].length) return 1;
    let low = 0;
    let high = samples.length - 1;
    while(high - low > 1) {
        const middle = (low + high) >> 1;
        if(samples[middle].length < target) low = middle;
        else high = middle;
    }
    const before = samples[low];
    const after = samples[high];
    const ratio = (target - before.length) / Math.max(1e-9, after.length - before.length);
    return before.t + ((after.t - before.t) * ratio);
}

function subLine(line: Line, startT: number, endT: number, editor: EditorService): Line {
    if(line.type !== "bezier" || !line.controlStart || !line.controlEnd) {
        return new Line(editor, { type: "line", points: [lerpPoint(line.points[0], line.points[1], startT), lerpPoint(line.points[0], line.points[1], endT)] });
    }
    const segment = cubicRange(line.points[0], line.controlStart, line.controlEnd, line.points[1], startT, endT);
    return new Line(editor, {
        type: "bezier",
        points: [segment[0], segment[3]],
        controlStart: segment[1],
        controlEnd: segment[2],
    });
}

function cubicRange(p0: Point, p1: Point, p2: Point, p3: Point, startT: number, endT: number): [Point, Point, Point, Point] {
    const left = splitCubic(p0, p1, p2, p3, endT)[0];
    if(startT <= 0) return left;
    return splitCubic(...left, startT / Math.max(endT, 1e-9))[1];
}

function splitCubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): [[Point, Point, Point, Point], [Point, Point, Point, Point]] {
    const a = lerpPoint(p0, p1, t);
    const b = lerpPoint(p1, p2, t);
    const c = lerpPoint(p2, p3, t);
    const d = lerpPoint(a, b, t);
    const e = lerpPoint(b, c, t);
    const f = lerpPoint(d, e, t);
    return [[new Point(p0.x, p0.y), a, d, f], [f, e, c, new Point(p3.x, p3.y)]];
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
    const mt = 1 - t;
    return new Point(
        mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
        mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
    );
}

function lerpPoint(start: Point, end: Point, t: number): Point {
    return new Point(start.x + ((end.x - start.x) * t), start.y + ((end.y - start.y) * t));
}

function connect(lines: Line[], line: Line): void {
    const end = lines[lines.length - 1]?.points[1];
    if(end && Math.hypot(end.x - line.points[0].x, end.y - line.points[0].y) < 1e-5) line.points[0] = end;
}

function modulo(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}
