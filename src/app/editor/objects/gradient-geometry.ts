import { localBounds } from "./element-bounds";
import { GradientPaint, isGradientPaint } from "./paint.object";
import { AnyElement } from "./svg.object";
import { applyMatrix, identityMatrix, invertMatrix, Matrix } from "./transform.object";

export type GradientPaintKey = "fill" | "stroke";
export type GradientHandle = "start" | "end" | "center" | "radius" | "focal";

export interface ElementGradient {
    key: GradientPaintKey;
    paint: GradientPaint;
}

export interface GradientGeometry {
    key: GradientPaintKey;
    paint: GradientPaint;
    kind: "linear" | "radial";
    start?: { x: number; y: number };
    end?: { x: number; y: number };
    center?: { x: number; y: number };
    radius?: { x: number; y: number };
    focal?: { x: number; y: number };
}

export function elementGradient(element: AnyElement, preferred?: GradientPaintKey): ElementGradient | undefined {
    const settings = element.settings as Record<string, unknown>;
    if(preferred && isGradientPaint(settings[preferred])) return { key: preferred, paint: settings[preferred] };
    if(isGradientPaint(settings["fill"])) return { key: "fill", paint: settings["fill"] };
    if(isGradientPaint(settings["stroke"])) return { key: "stroke", paint: settings["stroke"] };
    return undefined;
}

export function gradientGeometry(element: AnyElement, preferred?: GradientPaintKey): GradientGeometry | undefined {
    const selected = elementGradient(element, preferred);
    if(!selected) return undefined;
    const { key, paint } = selected;
    if(paint.type === "linear-gradient") {
        return {
            key, paint, kind: "linear",
            start: gradientPoint(element, paint, paint.coordinates.x1 ?? 0, paint.coordinates.y1 ?? 0),
            end: gradientPoint(element, paint, paint.coordinates.x2 ?? 1, paint.coordinates.y2 ?? 0),
        };
    }
    const cx = paint.coordinates.cx ?? 0.5;
    const cy = paint.coordinates.cy ?? 0.5;
    const radius = paint.coordinates.r ?? 0.5;
    return {
        key, paint, kind: "radial",
        center: gradientPoint(element, paint, cx, cy),
        radius: gradientPoint(element, paint, cx + radius, cy),
        focal: gradientPoint(element, paint, paint.coordinates.fx ?? cx, paint.coordinates.fy ?? cy),
    };
}

export function moveGradientHandle(element: AnyElement, paint: GradientPaint, handle: GradientHandle, localPoint: { x: number; y: number }): boolean {
    const point = gradientCoordinates(element, paint, localPoint);
    if(paint.type === "linear-gradient") {
        if(handle === "start") {
            paint.coordinates.x1 = point.x;
            paint.coordinates.y1 = point.y;
            return true;
        }
        if(handle === "end") {
            paint.coordinates.x2 = point.x;
            paint.coordinates.y2 = point.y;
            return true;
        }
        return false;
    }

    if(handle === "center") {
        const oldX = paint.coordinates.cx ?? 0.5;
        const oldY = paint.coordinates.cy ?? 0.5;
        const deltaX = point.x - oldX;
        const deltaY = point.y - oldY;
        paint.coordinates.cx = point.x;
        paint.coordinates.cy = point.y;
        paint.coordinates.fx = (paint.coordinates.fx ?? oldX) + deltaX;
        paint.coordinates.fy = (paint.coordinates.fy ?? oldY) + deltaY;
        return true;
    }
    if(handle === "focal") {
        paint.coordinates.fx = point.x;
        paint.coordinates.fy = point.y;
        return true;
    }
    if(handle === "radius") {
        const cx = paint.coordinates.cx ?? 0.5;
        const cy = paint.coordinates.cy ?? 0.5;
        paint.coordinates.r = Math.max(0.0001, Math.hypot(point.x - cx, point.y - cy));
        return true;
    }
    return false;
}

/** Change gradient units without changing the gradient's element-local handle positions. */
export function convertGradientUnits(element: AnyElement, paint: GradientPaint, units: GradientPaint["units"]): boolean {
    if(paint.units === units) return false;

    if(paint.type === "linear-gradient") {
        const start = gradientPoint(element, paint, paint.coordinates.x1 ?? 0, paint.coordinates.y1 ?? 0);
        const end = gradientPoint(element, paint, paint.coordinates.x2 ?? 1, paint.coordinates.y2 ?? 0);
        paint.units = units;
        moveGradientHandle(element, paint, "start", start);
        moveGradientHandle(element, paint, "end", end);
        return true;
    }

    const cx = paint.coordinates.cx ?? 0.5;
    const cy = paint.coordinates.cy ?? 0.5;
    const radius = paint.coordinates.r ?? 0.5;
    const center = gradientPoint(element, paint, cx, cy);
    const focal = gradientPoint(element, paint, paint.coordinates.fx ?? cx, paint.coordinates.fy ?? cy);
    const radiusPoint = gradientPoint(element, paint, cx + radius, cy);
    paint.units = units;
    moveGradientHandle(element, paint, "center", center);
    moveGradientHandle(element, paint, "focal", focal);
    moveGradientHandle(element, paint, "radius", radiusPoint);
    return true;
}

function gradientPoint(element: AnyElement, paint: GradientPaint, x: number, y: number): { x: number; y: number } {
    const bounds = localBounds(element);
    const unitPoint = paint.units === "objectBoundingBox"
        ? { x: bounds.x + x * bounds.width, y: bounds.y + y * bounds.height }
        : { x, y };
    return applyMatrix(gradientMatrix(paint), unitPoint.x, unitPoint.y);
}

function gradientCoordinates(element: AnyElement, paint: GradientPaint, point: { x: number; y: number }): { x: number; y: number } {
    const transformed = applyMatrix(invertMatrix(gradientMatrix(paint)), point.x, point.y);
    if(paint.units === "userSpaceOnUse") return transformed;
    const bounds = localBounds(element);
    return {
        x: bounds.width ? (transformed.x - bounds.x) / bounds.width : 0,
        y: bounds.height ? (transformed.y - bounds.y) / bounds.height : 0,
    };
}

function gradientMatrix(paint: GradientPaint): Matrix {
    const value = paint.transform;
    return value ? { a: value[0], b: value[1], c: value[2], d: value[3], e: value[4], f: value[5] } : identityMatrix();
}
