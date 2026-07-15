import { Group } from "./elements/group.object";
import { Path } from "./elements/path.object";
import { Shape } from "./elements/shape.object";
import { TextElement } from "./elements/text.object";
import { localBounds } from "./element-bounds";
import { gradientPaints, GradientPaint } from "./paint.object";
import { Point } from "./point.object";
import { AnyElement } from "./svg.object";
import { Bounds, identityMatrix, Matrix, multiplyMatrix } from "./transform.object";

export type GeometryFrameField = "x" | "y" | "width" | "height";

export interface ElementGeometrySnapshot {
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    points?: Array<{ point: Point; x: number; y: number }>;
    gradients: Array<{ paint: GradientPaint; coordinates: GradientPaint["coordinates"]; transform?: GradientPaint["transform"] }>;
}

export function movesNativeGeometry(element: AnyElement): element is Path | Shape | TextElement {
    return !(element instanceof Group);
}

export function resizesNativeGeometry(element: AnyElement): element is Path | Shape {
    return element instanceof Path || element instanceof Shape;
}

export function geometryFrame(element: Path | Shape): Bounds {
    return localBounds(element);
}

export function frameFieldSupported(element: AnyElement, field: GeometryFrameField): boolean {
    if(element instanceof Shape) return true;
    if(element instanceof Path) {
        const bounds = localBounds(element);
        return field === "x" || field === "y" || (field === "width" ? bounds.width > 0.000001 : bounds.height > 0.000001);
    }
    return element instanceof TextElement && (field === "x" || field === "y");
}

export function frameFieldValue(element: AnyElement, field: GeometryFrameField): number | undefined {
    if(element instanceof TextElement) {
        if(field === "x") return element.x;
        if(field === "y") return element.y;
        return undefined;
    }
    if(element instanceof Shape || element instanceof Path) return geometryFrame(element)[field];
    return undefined;
}

export function moveNativeGeometry(element: Path | Shape | TextElement, delta: { x: number; y: number }): void {
    const affine = translationAffine(delta.x, delta.y);
    element.moveElement(new Point(delta.x, delta.y));
    moveAttachedGeometry(element, affine);
}

export function resizeNativeGeometry(element: Path | Shape, from: Bounds, to: Bounds): void {
    const scaleX = from.width > 0.000001 ? to.width / from.width : 1;
    const scaleY = from.height > 0.000001 ? to.height / from.height : 1;
    const affine: GeometryAffine = {
        scaleX,
        scaleY,
        translateX: to.x - from.x * scaleX,
        translateY: to.y - from.y * scaleY,
    };

    if(element instanceof Shape) {
        element.position.x = to.x;
        element.position.y = to.y;
        element.settings.width = Math.max(1, to.width);
        element.settings.height = Math.max(1, to.height);
    } else {
        element.pathPoints().forEach((point) => applyAffineToPoint(point, affine));
    }
    moveAttachedGeometry(element, affine);
}

export function setGeometryFrameField(element: Path | Shape | TextElement, field: GeometryFrameField, value: number): boolean {
    if(!frameFieldSupported(element, field)) return false;
    if(element instanceof TextElement) {
        const current = field === "x" ? element.x : element.y;
        moveNativeGeometry(element, field === "x" ? { x: value - current, y: 0 } : { x: 0, y: value - current });
        return true;
    }

    const from = geometryFrame(element);
    if(field === "x" || field === "y") {
        moveNativeGeometry(element, field === "x" ? { x: value - from.x, y: 0 } : { x: 0, y: value - from.y });
        return true;
    }

    const minimum = element instanceof Shape ? 1 : 0.01;
    resizeNativeGeometry(element, from, {
        ...from,
        [field]: Math.max(minimum, value),
    });
    return true;
}

export function captureGeometrySnapshot(element: AnyElement): ElementGeometrySnapshot {
    return {
        position: element instanceof Shape || element instanceof TextElement
            ? { x: element.position.x, y: element.position.y }
            : undefined,
        size: element instanceof Shape ? { width: element.width, height: element.height } : undefined,
        points: element instanceof Path
            ? element.pathPoints().map((point) => ({ point, x: point.x, y: point.y }))
            : undefined,
        gradients: gradientPaints(element.settings as Record<string, unknown>)
            .map((paint) => ({ paint, coordinates: { ...paint.coordinates }, transform: paint.transform ? [...paint.transform] : undefined })),
    };
}

export function restoreGeometrySnapshot(element: AnyElement, snapshot: ElementGeometrySnapshot): void {
    if(snapshot.position && (element instanceof Shape || element instanceof TextElement)) {
        element.position.x = snapshot.position.x;
        element.position.y = snapshot.position.y;
    }
    if(snapshot.size && element instanceof Shape) {
        element.settings.width = snapshot.size.width;
        element.settings.height = snapshot.size.height;
    }
    snapshot.points?.forEach(({ point, x, y }) => {
        point.x = x;
        point.y = y;
    });
    snapshot.gradients.forEach(({ paint, coordinates, transform }) => {
        paint.coordinates = { ...coordinates };
        paint.transform = transform ? [...transform] : undefined;
    });
}

interface GeometryAffine {
    scaleX: number;
    scaleY: number;
    translateX: number;
    translateY: number;
}

function translationAffine(x: number, y: number): GeometryAffine {
    return { scaleX: 1, scaleY: 1, translateX: x, translateY: y };
}

function applyAffineToPoint(point: { x: number; y: number }, affine: GeometryAffine): void {
    point.x = point.x * affine.scaleX + affine.translateX;
    point.y = point.y * affine.scaleY + affine.translateY;
}

function moveAttachedGeometry(element: AnyElement, affine: GeometryAffine): void {
    if(element.transform.originX != null && element.transform.originY != null) {
        const origin = new Point(element.transform.originX, element.transform.originY);
        applyAffineToPoint(origin, affine);
        element.transform.originX = origin.x;
        element.transform.originY = origin.y;
    }

    gradientPaints(element.settings as Record<string, unknown>)
        .filter((paint) => paint.units === "userSpaceOnUse")
        .forEach((paint) => transformGradient(paint, affine));
}

function transformGradient(paint: GradientPaint, affine: GeometryAffine): void {
    const matrix: Matrix = paint.transform
        ? { a: paint.transform[0], b: paint.transform[1], c: paint.transform[2], d: paint.transform[3], e: paint.transform[4], f: paint.transform[5] }
        : identityMatrix();
    const next = multiplyMatrix({
        a: affine.scaleX,
        b: 0,
        c: 0,
        d: affine.scaleY,
        e: affine.translateX,
        f: affine.translateY,
    }, matrix);
    paint.transform = [next.a, next.b, next.c, next.d, next.e, next.f];
}
