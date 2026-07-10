import { combinedMatrixFor, parentMatrixFor, resolvedOrigin } from "./element-bounds";
import { Group } from "./elements/group.object";
import { Path } from "./elements/path.object";
import { Line } from "./line.object";
import { AnyElement, SVG } from "./svg.object";
import { applyMatrix, invertMatrix, Matrix, multiplyMatrix, transformMatrix, translationMatrix } from "./transform.object";

interface SampledMotion {
    x: number;
    y: number;
    tangentAngle: number;
}

interface FlattenedSegment {
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
}

export function motionAdjustedMatrix(svg: SVG | undefined, element: AnyElement): Matrix {
    const base = baseElementMatrix(element, 0);
    const motion = svg ? sampleMotionPath(svg, element) : undefined;
    if(!motion) {
        return base;
    }

    const rotation = (element.motion.rotateToPath ? motion.tangentAngle : 0) + element.motion.offsetAngle;
    const matrix = baseElementMatrix(element, rotation);
    const origin = resolvedOrigin(element);
    const currentOrigin = applyMatrix(matrix, origin.x, origin.y);
    const offset = rotateVector(
        element.motion.offsetX,
        element.motion.offsetY,
        element.transform.rotation + rotation
    );
    const targetX = motion.x + offset.x;
    const targetY = motion.y + offset.y;

    return multiplyMatrix(
        translationMatrix(targetX - currentOrigin.x, targetY - currentOrigin.y),
        matrix
    );
}

export function combinedMotionAdjustedMatrixFor(svg: SVG, element: AnyElement): Matrix {
    const chain = findElementChain(svg.elements, element);
    if(!chain) {
        return motionAdjustedMatrix(svg, element);
    }

    return chain.reduce((matrix, item) => {
        return multiplyMatrix(matrix, motionAdjustedMatrix(svg, item));
    }, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
}

export function findMotionPath(svg: SVG, element: AnyElement): Path | undefined {
    const pathId = element.motion.pathId;
    if(!pathId || pathId === element.id) {
        return undefined;
    }

    return findPath(svg.elements, pathId);
}

export function sampleMotionPath(svg: SVG, element: AnyElement): SampledMotion | undefined {
    const path = findMotionPath(svg, element);
    if(!path) {
        return undefined;
    }

    const segments = flattenPath(path, combinedMatrixFor(svg.elements, path));
    const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
    if(totalLength <= 0) {
        return undefined;
    }

    const targetLength = clamp01(element.motion.progress) * totalLength;
    let consumed = 0;
    let selected = segments[segments.length - 1];
    let localT = 1;

    for(const segment of segments) {
        if(consumed + segment.length >= targetLength) {
            selected = segment;
            localT = segment.length <= 0 ? 0 : (targetLength - consumed) / segment.length;
            break;
        }
        consumed += segment.length;
    }

    const worldPoint = {
        x: selected.start.x + ((selected.end.x - selected.start.x) * localT),
        y: selected.start.y + ((selected.end.y - selected.start.y) * localT),
    };
    const worldTangent = {
        x: selected.end.x - selected.start.x,
        y: selected.end.y - selected.start.y,
    };
    const parentInverse = invertMatrix(parentMatrixFor(svg.elements, element));
    const parentPoint = applyMatrix(parentInverse, worldPoint.x, worldPoint.y);
    const parentTangentEnd = applyMatrix(parentInverse, worldPoint.x + worldTangent.x, worldPoint.y + worldTangent.y);

    return {
        x: parentPoint.x,
        y: parentPoint.y,
        tangentAngle: Math.atan2(parentTangentEnd.y - parentPoint.y, parentTangentEnd.x - parentPoint.x) * 180 / Math.PI,
    };
}

function baseElementMatrix(element: AnyElement, extraRotation: number): Matrix {
    if(Math.abs(extraRotation) < 0.000001) {
        return transformMatrix(element.transform, resolvedOrigin(element));
    }

    return transformMatrix(
        {
            ...element.transform,
            rotation: element.transform.rotation + extraRotation,
        },
        resolvedOrigin(element)
    );
}

function rotateVector(x: number, y: number, degrees: number): { x: number; y: number } {
    const radians = degrees * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: (x * cos) - (y * sin),
        y: (x * sin) + (y * cos),
    };
}

function flattenPath(path: Path, matrix: Matrix): FlattenedSegment[] {
    return path.contours.flatMap((contour) => contour.lines)
        .filter((line) => line.points.length >= 2)
        .flatMap((line) => flattenLine(line, matrix))
        .filter((segment) => segment.length > 0);
}

function flattenLine(line: Line, matrix: Matrix): FlattenedSegment[] {
    const start = line.points[0];
    const end = line.points[1];
    if(line.type !== "bezier" || !line.controlStart || !line.controlEnd) {
        return [makeSegment(
            applyMatrix(matrix, start.x, start.y),
            applyMatrix(matrix, end.x, end.y)
        )];
    }

    const points: Array<{ x: number; y: number }> = [];
    const steps = 32;
    for(let i = 0; i <= steps; i++) {
        const t = i / steps;
        const point = cubicPoint(start, line.controlStart, line.controlEnd, end, t);
        points.push(applyMatrix(matrix, point.x, point.y));
    }

    const segments: FlattenedSegment[] = [];
    for(let i = 0; i < points.length - 1; i++) {
        segments.push(makeSegment(points[i], points[i + 1]));
    }
    return segments;
}

function cubicPoint(
    start: { x: number; y: number },
    controlStart: { x: number; y: number },
    controlEnd: { x: number; y: number },
    end: { x: number; y: number },
    t: number
) {
    const mt = 1 - t;
    return {
        x: (mt * mt * mt * start.x) + (3 * mt * mt * t * controlStart.x) + (3 * mt * t * t * controlEnd.x) + (t * t * t * end.x),
        y: (mt * mt * mt * start.y) + (3 * mt * mt * t * controlStart.y) + (3 * mt * t * t * controlEnd.y) + (t * t * t * end.y),
    };
}

function makeSegment(start: { x: number; y: number }, end: { x: number; y: number }): FlattenedSegment {
    return {
        start,
        end,
        length: Math.hypot(end.x - start.x, end.y - start.y),
    };
}

function findPath(elements: AnyElement[], id: string): Path | undefined {
    for(const element of elements) {
        if(element instanceof Path && element.id === id) {
            return element;
        }

        if(element instanceof Group) {
            const found = findPath(element.elements, id);
            if(found) {
                return found;
            }
        }
    }

    return undefined;
}

function findElementChain(elements: AnyElement[], element: AnyElement, chain: AnyElement[] = []): AnyElement[] | undefined {
    for(const candidate of elements) {
        const nextChain = [...chain, candidate];
        if(candidate === element) {
            return nextChain;
        }

        if(candidate instanceof Group) {
            const found = findElementChain(candidate.elements, element, nextChain);
            if(found) {
                return found;
            }
        }
    }

    return undefined;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}
