import { fullOutlineSections, outlineProjectionProblem, OutlineProjection, OutlineSection, OutlineStyle, projectOutlineSections } from '../../../packages/runtime/src/outline';
import { RuntimeContourV1, RuntimeLineV1 } from '../../../packages/runtime/src/contracts';
import { Path, PathContour } from './objects/elements/path.object';
import { isGradientPaint, paintSVGValue } from './objects/paint.object';
import { effectiveStrokeAlignment } from './objects/stroke-style.object';

type OutlineInput = string | number | boolean | null | undefined;
interface CachedOutline { inputs: OutlineInput[]; projection: OutlineProjection; }
const projections = new WeakMap<Path, { rounded?: CachedOutline; unrounded?: CachedOutline }>();

/**
 * Narrow authoring adapter; generated vertices stay outside the document model.
 * Model points and preview sections are mutable during gestures and rig playback,
 * so compare their exact scalar inputs instead of document revisions or identity.
 * Each path retains at most one projection per rounding mode, including its bounds
 * for gradient consumers. Unrelated UI checks never resample or expand its curves.
 */
export function projectPathOutline(path: Path, sections = path.outlineSections, rounded = true): OutlineProjection {
    const style = pathOutlineStyle(path, rounded), inputs = projectionInputs(path, sections ?? [], style);
    const variants = projections.get(path), mode = rounded ? 'rounded' : 'unrounded', cached = variants?.[mode];
    if(cached && inputs.length === cached.inputs.length && inputs.every((value, index) => Object.is(value, cached.inputs[index]))) return cached.projection;
    const projection = projectOutlineSections(pathOutlineContours(path), sections ?? [], style);
    const next = variants ?? {};
    next[mode] = { inputs, projection }; projections.set(path, next);
    return projection;
}

function projectionInputs(path: Path, sections: readonly OutlineSection[], style: OutlineStyle): OutlineInput[] {
    const values: OutlineInput[] = [style.width, style.alignment, style.lineCap, style.lineJoin, style.miterLimit,
        style.dashoffset, style.drawProgress, style.rounded, style.dasharray?.length ?? 0, ...(style.dasharray ?? [])];
    const point = (value?: RuntimeLineV1['points'][number]) => {
        values.push(!!value);
        if(value) values.push(value.id, value.x, value.y, value.cornerRadius);
    };
    values.push(path.contours.length);
    for(const contour of path.contours) {
        values.push(contour.id, contour.closed, contour.lines.length);
        for(const line of contour.lines) {
            values.push(line.id, line.type, line.points.length);
            point(line.points[0]); point(line.points[1]); point(line.controlStart); point(line.controlEnd);
        }
    }
    values.push(sections.length);
    for(const section of sections) values.push(section.id, section.contourId, section.start.segmentId, section.start.t,
        section.end.segmentId, section.end.t, section.fullContour, section.startTaper?.length, section.startTaper?.tipWidth,
        section.endTaper?.length, section.endTaper?.tipWidth);
    return values;
}

/** Cheap authoring/export guard; it does not allocate expanded stroke vertices. */
export function pathOutlineProblem(path: Path, sections?: readonly OutlineSection[]): string | undefined {
    const contours = pathOutlineContours(path);
    return outlineProjectionProblem(contours, sections ?? path.outlineSections ?? fullOutlineSections(contours), pathOutlineStyle(path));
}

function pathOutlineStyle(path: Path, rounded = true): OutlineStyle {
    const settings = path.settings;
    return {
        width: settings.stroke_width, alignment: effectiveStrokeAlignment(path),
        lineCap: settings.line_cap as OutlineStyle['lineCap'], lineJoin: settings.line_join as OutlineStyle['lineJoin'],
        miterLimit: settings.stroke_miterlimit, dasharray: settings.stroke_dasharray, dashoffset: settings.stroke_dashoffset,
        drawProgress: path.drawProgress, rounded,
    };
}

export function pathOutlineContours(path: Path): RuntimeContourV1[] {
    return path.contours.map(pathOutlineContour);
}

export function pathOutlineContour(contour: PathContour): RuntimeContourV1 {
    return { ...contour, lines: contour.lines.filter(line => line.points.length >= 2).map(line => ({
        id: line.id, type: line.type, points: [line.points[0], line.points[1]] as RuntimeLineV1['points'],
        ...(line.controlStart ? { controlStart: line.controlStart } : {}), ...(line.controlEnd ? { controlEnd: line.controlEnd } : {}),
    })) };
}

export function outlineStrokePaint(path: Path): string | null {
    const paint = path.settings.stroke;
    return isGradientPaint(paint) && paint.units === 'objectBoundingBox' ? `url(#outline-paint-${path.id})` : paintSVGValue(paint);
}

export function outlineGradientTransform(path: Path, sections?: OutlineSection[], rounded = true): string {
    const bounds = projectPathOutline(path, sections, rounded).sourceBounds;
    const paint = path.settings.stroke;
    const transform = isGradientPaint(paint) ? paint.transform ?? [1, 0, 0, 1, 0, 0] : [1, 0, 0, 1, 0, 0];
    const [a, b, c, d, e, f] = transform;
    return `matrix(${[bounds.width*a, bounds.height*b, bounds.width*c, bounds.height*d, bounds.x+bounds.width*e, bounds.y+bounds.height*f].join(' ')})`;
}
