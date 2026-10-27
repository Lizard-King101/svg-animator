import { parseSVGPathData } from '../import/svg-path-parser';
import { localBounds } from './element-bounds';
import { Group } from './elements/group.object';
import { Path } from './elements/path.object';
import { Shape } from './elements/shape.object';
import { combinedMotionAdjustedMatrixFor } from './motion-path.object';
import { AnyElement, SVG } from './svg.object';
import { applyMatrix, Bounds, transformedBounds, unionBounds } from './transform.object';

/** Geometry bounds for layout, independent of the historic control-hull transform origin. Excludes strokes/effects. */
export function arrangementBounds(svg: SVG, element: AnyElement): Bounds {
    const matrix = combinedMotionAdjustedMatrixFor(svg, element);
    const fallback = () => transformedBounds(localBounds(element), matrix);
    if(element instanceof Group) {
        const children = element.renderedElements.filter((child) => child.visible);
        const bounds = children.length ? unionBounds(children.map((child) => arrangementBounds(svg, child))) : fallback();
        if(!element.clipElement) return bounds;
        const clip = arrangementBounds(svg, element.clipElement);
        const x = Math.max(bounds.x, clip.x), y = Math.max(bounds.y, clip.y);
        const clipped = { x, y, width: Math.max(0, Math.min(bounds.x + bounds.width, clip.x + clip.width) - x),
            height: Math.max(0, Math.min(bounds.y + bounds.height, clip.y + clip.height) - y) };
        return element.clipElement.visible ? unionBounds([clip, clipped]) : clipped;
    }
    if(element instanceof Shape && element.type === 'ellipse') {
        const frame = localBounds(element), rx = frame.width / 2, ry = frame.height / 2;
        const center = applyMatrix(matrix, frame.x + rx, frame.y + ry);
        const halfWidth = Math.hypot(matrix.a * rx, matrix.c * ry);
        const halfHeight = Math.hypot(matrix.b * rx, matrix.d * ry);
        return { x: center.x - halfWidth, y: center.y - halfHeight, width: halfWidth * 2, height: halfHeight * 2 };
    }
    if(!(element instanceof Path)) return fallback();
    // Reuse the normalized SVG parser so rounded corners match exported/rendered geometry.
    const contours = parseSVGPathData(element.raw, () => 'bounds');
    const points: { x: number; y: number }[] = [];
    contours.forEach((contour) => contour.lines.forEach((line) => {
        if(line.points.length < 2) return;
        const start = applyMatrix(matrix, line.points[0].x, line.points[0].y);
        const end = applyMatrix(matrix, line.points[1].x, line.points[1].y);
        points.push(start, end);
        if(line.type !== 'bezier' || !line.controlStart || !line.controlEnd) return;
        const c1 = applyMatrix(matrix, line.controlStart.x, line.controlStart.y);
        const c2 = applyMatrix(matrix, line.controlEnd.x, line.controlEnd.y);
        const roots = [...cubicExtrema(start.x, c1.x, c2.x, end.x), ...cubicExtrema(start.y, c1.y, c2.y, end.y)];
        roots.forEach((t) => points.push({ x: cubicAt(start.x, c1.x, c2.x, end.x, t), y: cubicAt(start.y, c1.y, c2.y, end.y, t) }));
    }));
    if(!points.length) return fallback();
    return unionBounds(points.map(({ x, y }) => ({ x, y, width: 0, height: 0 })));
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
    const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
    if(Math.abs(a) < 1e-10) return Math.abs(b) < 1e-10 ? [] : [-c / b].filter((t) => t > 0 && t < 1);
    const discriminant = b * b - 4 * a * c;
    if(discriminant < 0) return [];
    const root = Math.sqrt(discriminant);
    return [(-b + root) / (2 * a), (-b - root) / (2 * a)].filter((t) => t > 0 && t < 1);
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const s = 1 - t;
    return s * s * s * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t * p3;
}
