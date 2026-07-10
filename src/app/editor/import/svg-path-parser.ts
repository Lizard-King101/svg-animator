import { PathContourSave } from "../objects/elements/path.object";
import { LineSave } from "../objects/line.object";
import { PointSave } from "../objects/point.object";

const COMMAND = /^[a-z]$/i;
const PARAMETER_COUNTS: Record<string, number> = {
    m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0,
};

export class SVGPathParseError extends Error {}

export function parseSVGPathData(data: string, createId: (prefix: string) => string): PathContourSave[] {
    const tokens = tokenize(data);
    const contours: PathContourSave[] = [];
    let index = 0;
    let command = "";
    let current = point(0, 0, createId);
    let subpathStart = current;
    let contour: PathContourSave | undefined;
    let lastCubicControl: PointSave | undefined;
    let lastQuadraticControl: PointSave | undefined;

    const finishContour = () => {
        if(contour?.lines.length) contours.push(contour);
        contour = undefined;
    };
    const ensureContour = () => {
        contour ??= { id: createId("contour"), closed: false, lines: [] };
        return contour;
    };
    const lineTo = (end: PointSave) => {
        ensureContour().lines.push(line(current, end, createId));
        current = end;
    };
    const cubicTo = (controlStart: PointSave, controlEnd: PointSave, end: PointSave) => {
        ensureContour().lines.push(cubic(current, controlStart, controlEnd, end, createId));
        current = end;
        lastCubicControl = controlEnd;
    };
    const read = (count: number): number[] => {
        if(index + count > tokens.length || tokens.slice(index, index + count).some((token) => COMMAND.test(token))) {
            throw new SVGPathParseError(`Path command ${command} is missing parameters.`);
        }
        const values = tokens.slice(index, index + count).map(Number);
        if(values.some((value) => !Number.isFinite(value))) throw new SVGPathParseError(`Path command ${command} has invalid numbers.`);
        index += count;
        return values;
    };

    while(index < tokens.length) {
        if(COMMAND.test(tokens[index])) command = tokens[index++];
        if(!command) throw new SVGPathParseError("Path data must begin with a command.");
        const lower = command.toLowerCase();
        const relative = command === lower;
        const count = PARAMETER_COUNTS[lower];
        if(count == null) throw new SVGPathParseError(`Unsupported path command ${command}.`);

        if(lower === "z") {
            if(contour) contour.closed = true;
            current = subpathStart;
            lastCubicControl = undefined;
            lastQuadraticControl = undefined;
            command = "";
            continue;
        }

        const values = read(count);
        const absolutePoint = (x: number, y: number) => point(relative ? current.x + x : x, relative ? current.y + y : y, createId);
        switch(lower) {
            case "m": {
                const end = absolutePoint(values[0], values[1]);
                finishContour();
                current = end;
                subpathStart = end;
                contour = { id: createId("contour"), closed: false, lines: [] };
                command = relative ? "l" : "L";
                break;
            }
            case "l": lineTo(absolutePoint(values[0], values[1])); break;
            case "h": lineTo(point(relative ? current.x + values[0] : values[0], current.y, createId)); break;
            case "v": lineTo(point(current.x, relative ? current.y + values[0] : values[0], createId)); break;
            case "c": {
                const c1 = absolutePoint(values[0], values[1]);
                const c2 = absolutePoint(values[2], values[3]);
                cubicTo(c1, c2, absolutePoint(values[4], values[5]));
                break;
            }
            case "s": {
                const c1 = lastCubicControl ? reflect(lastCubicControl, current, createId) : cloneAt(current, createId);
                const c2 = absolutePoint(values[0], values[1]);
                cubicTo(c1, c2, absolutePoint(values[2], values[3]));
                break;
            }
            case "q": {
                const control = absolutePoint(values[0], values[1]);
                const end = absolutePoint(values[2], values[3]);
                cubicTo(
                    interpolate(current, control, 2 / 3, createId),
                    interpolate(end, control, 2 / 3, createId),
                    end,
                );
                lastQuadraticControl = control;
                lastCubicControl = undefined;
                break;
            }
            case "t": {
                const control = lastQuadraticControl ? reflect(lastQuadraticControl, current, createId) : cloneAt(current, createId);
                const end = absolutePoint(values[0], values[1]);
                cubicTo(
                    interpolate(current, control, 2 / 3, createId),
                    interpolate(end, control, 2 / 3, createId),
                    end,
                );
                lastQuadraticControl = control;
                lastCubicControl = undefined;
                break;
            }
            case "a": {
                if((values[3] !== 0 && values[3] !== 1) || (values[4] !== 0 && values[4] !== 1)) {
                    throw new SVGPathParseError("Arc flags must be 0 or 1.");
                }
                const end = absolutePoint(values[5], values[6]);
                const segments = arcToCubics(current, end, values[0], values[1], values[2], values[3] === 1, values[4] === 1, createId);
                if(segments.length === 0 && (current.x !== end.x || current.y !== end.y)) lineTo(end);
                else segments.forEach((segment) => cubicTo(segment.controlStart, segment.controlEnd, segment.end));
                break;
            }
        }

        if(lower !== "c" && lower !== "s") lastCubicControl = undefined;
        if(lower !== "q" && lower !== "t") lastQuadraticControl = undefined;
    }

    finishContour();
    return contours;
}

function tokenize(data: string): string[] {
    const pattern = /[a-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;
    const tokens: string[] = [];
    let lastIndex = 0;
    for(const match of data.matchAll(pattern)) {
        if(!/^[\s,]*$/.test(data.slice(lastIndex, match.index))) throw new SVGPathParseError("Path data contains invalid syntax.");
        tokens.push(match[0]);
        lastIndex = (match.index ?? 0) + match[0].length;
    }
    if(!/^[\s,]*$/.test(data.slice(lastIndex))) throw new SVGPathParseError("Path data contains invalid trailing syntax.");
    return tokens;
}

function point(x: number, y: number, createId: (prefix: string) => string): PointSave {
    return { id: createId("point"), x, y };
}

function cloneAt(value: PointSave, createId: (prefix: string) => string): PointSave {
    return point(value.x, value.y, createId);
}

function line(start: PointSave, end: PointSave, createId: (prefix: string) => string): LineSave {
    return { id: createId("line"), type: "line", points: [start, end] };
}

function cubic(start: PointSave, controlStart: PointSave, controlEnd: PointSave, end: PointSave, createId: (prefix: string) => string): LineSave {
    return { id: createId("line"), type: "bezier", points: [start, end], controlStart, controlEnd };
}

function reflect(control: PointSave, anchor: PointSave, createId: (prefix: string) => string): PointSave {
    return point((2 * anchor.x) - control.x, (2 * anchor.y) - control.y, createId);
}

function interpolate(from: PointSave, to: PointSave, amount: number, createId: (prefix: string) => string): PointSave {
    return point(from.x + ((to.x - from.x) * amount), from.y + ((to.y - from.y) * amount), createId);
}

interface ArcCubic { controlStart: PointSave; controlEnd: PointSave; end: PointSave; }

function arcToCubics(
    start: PointSave,
    end: PointSave,
    rawRadiusX: number,
    rawRadiusY: number,
    rotation: number,
    largeArc: boolean,
    sweep: boolean,
    createId: (prefix: string) => string,
): ArcCubic[] {
    let rx = Math.abs(rawRadiusX);
    let ry = Math.abs(rawRadiusY);
    if(rx === 0 || ry === 0 || (start.x === end.x && start.y === end.y)) return [];
    const phi = rotation * Math.PI / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const dx = (start.x - end.x) / 2;
    const dy = (start.y - end.y) / 2;
    const xPrime = (cosPhi * dx) + (sinPhi * dy);
    const yPrime = (-sinPhi * dx) + (cosPhi * dy);
    const radiusScale = (xPrime * xPrime) / (rx * rx) + (yPrime * yPrime) / (ry * ry);
    if(radiusScale > 1) {
        const scale = Math.sqrt(radiusScale);
        rx *= scale;
        ry *= scale;
    }
    const numerator = Math.max(0, (rx * rx * ry * ry) - (rx * rx * yPrime * yPrime) - (ry * ry * xPrime * xPrime));
    const denominator = (rx * rx * yPrime * yPrime) + (ry * ry * xPrime * xPrime);
    const coefficient = (largeArc === sweep ? -1 : 1) * Math.sqrt(denominator === 0 ? 0 : numerator / denominator);
    const centerPrimeX = coefficient * ((rx * yPrime) / ry);
    const centerPrimeY = coefficient * (-(ry * xPrime) / rx);
    const centerX = cosPhi * centerPrimeX - sinPhi * centerPrimeY + (start.x + end.x) / 2;
    const centerY = sinPhi * centerPrimeX + cosPhi * centerPrimeY + (start.y + end.y) / 2;
    const vectorAngle = (ux: number, uy: number, vx: number, vy: number) => {
        const dot = ux * vx + uy * vy;
        const length = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
        const angle = Math.acos(Math.max(-1, Math.min(1, length === 0 ? 1 : dot / length)));
        return ux * vy - uy * vx < 0 ? -angle : angle;
    };
    const ux = (xPrime - centerPrimeX) / rx;
    const uy = (yPrime - centerPrimeY) / ry;
    const vx = (-xPrime - centerPrimeX) / rx;
    const vy = (-yPrime - centerPrimeY) / ry;
    let startAngle = vectorAngle(1, 0, ux, uy);
    let deltaAngle = vectorAngle(ux, uy, vx, vy);
    if(!sweep && deltaAngle > 0) deltaAngle -= Math.PI * 2;
    if(sweep && deltaAngle < 0) deltaAngle += Math.PI * 2;
    const count = Math.ceil(Math.abs(deltaAngle) / (Math.PI / 2));
    const step = deltaAngle / count;
    const map = (x: number, y: number) => ({
        x: centerX + cosPhi * rx * x - sinPhi * ry * y,
        y: centerY + sinPhi * rx * x + cosPhi * ry * y,
    });
    const result: ArcCubic[] = [];
    for(let i = 0; i < count; i++) {
        const nextAngle = startAngle + step;
        const alpha = (4 / 3) * Math.tan(step / 4);
        const p1 = map(Math.cos(startAngle) - alpha * Math.sin(startAngle), Math.sin(startAngle) + alpha * Math.cos(startAngle));
        const p2 = map(Math.cos(nextAngle) + alpha * Math.sin(nextAngle), Math.sin(nextAngle) - alpha * Math.cos(nextAngle));
        const p3 = i === count - 1 ? end : (() => {
            const mapped = map(Math.cos(nextAngle), Math.sin(nextAngle));
            return point(mapped.x, mapped.y, createId);
        })();
        result.push({
            controlStart: point(p1.x, p1.y, createId),
            controlEnd: point(p2.x, p2.y, createId),
            end: p3,
        });
        startAngle = nextAngle;
    }
    return result;
}
