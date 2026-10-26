import { EditorService } from "src/app/_services/editor.service";
import { Path, PathContour } from "./elements/path.object";
import { Line } from "./line.object";
import { Point } from "./point.object";
import { normalizeDashArray } from "./stroke-style.object";
import { cubicRange, curveLengthSamples, curveTAtLength } from '../../../../packages/runtime/src/curve-range';

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
        const samples = curveLengthSamples(line);
        const lineLength = samples[samples.length - 1].length;
        let consumed = 0;
        while(consumed < lineLength - 1e-7) {
            const amount = Math.min(remaining, lineLength - consumed);
            if(patternIndex % 2 === 0 && amount > 1e-7) {
                const segment = subLine(line, curveTAtLength(samples, consumed), curveTAtLength(samples, consumed + amount), editor);
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

function subLine(line: Line, startT: number, endT: number, editor: EditorService): Line {
    if(line.type !== "bezier" || !line.controlStart || !line.controlEnd) {
        return new Line(editor, { type: "line", points: [lerpPoint(line.points[0], line.points[1], startT), lerpPoint(line.points[0], line.points[1], endT)] });
    }
    const segment = cubicRange(line.points[0], line.controlStart, line.controlEnd, line.points[1], startT, endT);
    return new Line(editor, {
        type: "bezier",
        points: [new Point(segment[0].x, segment[0].y), new Point(segment[3].x, segment[3].y)],
        controlStart: new Point(segment[1].x, segment[1].y),
        controlEnd: new Point(segment[2].x, segment[2].y),
    });
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
