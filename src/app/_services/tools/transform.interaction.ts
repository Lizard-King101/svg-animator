import { localBounds, parentMatrixFor, pinAncestorTransformOrigins, pinTransformOrigin, resolvedOrigin } from "../../editor/objects/element-bounds";
import { Point } from "../../editor/objects/point.object";
import { AnyElement } from "../../editor/objects/svg.object";
import { Bounds, TransformState, applyMatrix, invertMatrix, transformMatrix } from "../../editor/objects/transform.object";
import { EditorService } from "../editor.service";

/** Coordinates a complete move/resize/rotate/origin pointer interaction. */
export class TransformInteraction {
    private drag?: TransformDrag;

    constructor(private editor: EditorService) {}

    handle(target: HTMLElement): string | undefined {
        let current: HTMLElement | null = target;
        while(current) {
            if(current.dataset["transformHandle"]) return current.dataset["transformHandle"];
            current = current.parentElement;
        }
        return undefined;
    }

    begin(handle: string, event: MouseEvent): boolean {
        const element = this.editor.selectedElement;
        if(!element || element.locked || !element.visible) return false;
        const canvasPoint = this.editor.toCanvasPoint(event.clientX, event.clientY);
        if(handle === "move") {
            pinAncestorTransformOrigins(this.roots(), element);
            this.drag = {
                handle,
                element,
                start: this.canvasToParentLocal(element, canvasPoint),
            };
            return true;
        }

        const bounds = localBounds(element);
        const origin = handle === "origin" ? resolvedOrigin(element) : pinTransformOrigin(element);
        const initial = cloneTransform(element.transform);
        const own = transformMatrix(initial, origin);
        const pivotLocal = handle === "origin" || event.altKey ? new Point(origin.x, origin.y) : oppositeHandlePoint(bounds, handle);
        const pivot = applyMatrix(own, pivotLocal.x, pivotLocal.y);
        const pivotParent = new Point(pivot.x, pivot.y);
        const parentPoint = this.canvasToParentLocal(element, canvasPoint);
        this.drag = {
            handle,
            element,
            bounds,
            origin,
            initial,
            pivotLocal,
            pivotParent,
            handleLocal: handlePoint(bounds, handle),
            startAngle: Math.atan2(parentPoint.y - pivot.y, parentPoint.x - pivot.x) * 180 / Math.PI,
        };
        return true;
    }

    update(event: MouseEvent): boolean {
        const drag = this.drag;
        if(!drag) return false;
        const point = this.canvasToParentLocal(drag.element, this.editor.toCanvasPoint(event.clientX, event.clientY));
        if(drag.handle === "move") {
            const delta = point.subtract(drag.start!);
            drag.start = point;
            drag.element.transform.translateX += delta.x;
            drag.element.transform.translateY += delta.y;
            return true;
        }

        const next = cloneTransform(drag.initial!);
        if(drag.handle === "origin") {
            next.originX = point.x - drag.initial!.translateX;
            next.originY = point.y - drag.initial!.translateY;
            drag.element.transform = next;
            return true;
        }
        if(drag.handle === "rotate") {
            const angle = Math.atan2(point.y - drag.pivotParent!.y, point.x - drag.pivotParent!.x) * 180 / Math.PI;
            next.rotation = drag.initial!.rotation + angle - drag.startAngle!;
            drag.element.transform = next;
            return true;
        }

        const hasX = drag.handle.includes("e") || drag.handle.includes("w");
        const hasY = drag.handle.includes("n") || drag.handle.includes("s");
        const currentVector = point.subtract(drag.pivotParent!);
        const unrotated = rotateVector(currentVector, -drag.initial!.rotation);
        const initialVector = drag.handleLocal!.subtract(drag.pivotLocal!);
        if(hasX && Math.abs(initialVector.x) > 0.000001) next.scaleX = nonZeroScale(unrotated.x / initialVector.x);
        if(hasY && Math.abs(initialVector.y) > 0.000001) next.scaleY = nonZeroScale(unrotated.y / initialVector.y);
        if(event.shiftKey) {
            const ratio = hasX ? next.scaleX / drag.initial!.scaleX : next.scaleY / drag.initial!.scaleY;
            next.scaleX = nonZeroScale(drag.initial!.scaleX * ratio);
            next.scaleY = nonZeroScale(drag.initial!.scaleY * ratio);
        }
        const own = transformMatrix(next, drag.origin!);
        const mappedPivot = applyMatrix(own, drag.pivotLocal!.x, drag.pivotLocal!.y);
        next.translateX += drag.pivotParent!.x - mappedPivot.x;
        next.translateY += drag.pivotParent!.y - mappedPivot.y;
        drag.element.transform = next;
        return true;
    }

    end(): void { this.drag = undefined; }

    private roots(): AnyElement[] { return this.editor.selectedSVG?.elements ?? []; }

    private canvasToParentLocal(element: AnyElement, point: Point): Point {
        const inverse = invertMatrix(parentMatrixFor(this.roots(), element));
        const local = applyMatrix(inverse, point.x, point.y);
        return new Point(local.x, local.y);
    }
}

interface TransformDrag {
    handle: string;
    element: AnyElement;
    start?: Point;
    bounds?: Bounds;
    origin?: { x: number; y: number };
    initial?: TransformState;
    pivotLocal?: Point;
    pivotParent?: Point;
    handleLocal?: Point;
    startAngle?: number;
}

function cloneTransform(transform: TransformState): TransformState { return { ...transform }; }

function rotateVector(point: Point, degrees: number): Point {
    const radians = degrees * Math.PI / 180;
    return new Point(
        (point.x * Math.cos(radians)) - (point.y * Math.sin(radians)),
        (point.x * Math.sin(radians)) + (point.y * Math.cos(radians)),
    );
}

function oppositeHandlePoint(bounds: Bounds, handle: string): Point {
    return new Point(
        handle.includes("w") ? bounds.x + bounds.width : handle.includes("e") ? bounds.x : bounds.x + bounds.width / 2,
        handle.includes("n") ? bounds.y + bounds.height : handle.includes("s") ? bounds.y : bounds.y + bounds.height / 2,
    );
}

function handlePoint(bounds: Bounds, handle: string): Point {
    return new Point(
        handle.includes("w") ? bounds.x : handle.includes("e") ? bounds.x + bounds.width : bounds.x + bounds.width / 2,
        handle.includes("n") ? bounds.y : handle.includes("s") ? bounds.y + bounds.height : bounds.y + bounds.height / 2,
    );
}

function nonZeroScale(value: number): number {
    return Math.abs(value) < 0.01 ? (value < 0 ? -0.01 : 0.01) : value;
}
