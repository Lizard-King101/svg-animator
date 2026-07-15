import { combinedMatrixFor, localBounds, ownMatrix, parentMatrixFor, pinAncestorTransformOrigins, resolvedOrigin } from "../../editor/objects/element-bounds";
import {
    captureGeometrySnapshot,
    ElementGeometrySnapshot,
    moveNativeGeometry,
    movesNativeGeometry,
    resizeNativeGeometry,
    resizesNativeGeometry,
    restoreGeometrySnapshot,
} from "../../editor/objects/element-geometry";
import { Path } from "../../editor/objects/elements/path.object";
import { Point } from "../../editor/objects/point.object";
import { AnyElement } from "../../editor/objects/svg.object";
import { Bounds, Matrix, TransformState, applyMatrix, invertMatrix, transformMatrix } from "../../editor/objects/transform.object";
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
        const snapshot = captureGeometrySnapshot(element);
        const transformSnapshot = cloneTransform(element.transform);
        if(handle === "move") {
            this.drag = {
                handle,
                element,
                nativeGeometry: movesNativeGeometry(element),
                start: this.canvasToParentLocal(element, canvasPoint),
                snapshot,
                transformSnapshot,
                ancestorSnapshots: this.ancestorSnapshots(element),
            };
            return true;
        }

        const bounds = localBounds(element);
        const origin = resolvedOrigin(element);
        const initial = cloneTransform(element.transform);
        if(initial.originX == null || initial.originY == null) {
            initial.originX = origin.x;
            initial.originY = origin.y;
        }
        element.transform = cloneTransform(initial);
        const own = transformMatrix(initial, origin);
        const pivotLocal = handle === "origin" || event.altKey ? new Point(origin.x, origin.y) : oppositeHandlePoint(bounds, handle);
        const pivot = applyMatrix(own, pivotLocal.x, pivotLocal.y);
        const pivotParent = new Point(pivot.x, pivot.y);
        const parentPoint = this.canvasToParentLocal(element, canvasPoint);
        this.drag = {
            handle,
            element,
            nativeGeometry: resizesNativeGeometry(element) && handle !== "rotate" && handle !== "origin",
            bounds,
            origin,
            initial,
            pivotLocal,
            pivotParent,
            handleLocal: handlePoint(bounds, handle),
            startAngle: Math.atan2(parentPoint.y - pivot.y, parentPoint.x - pivot.x) * 180 / Math.PI,
            initialCombinedInverse: invertMatrix(combinedMatrixFor(this.roots(), element)),
            snapshot,
            transformSnapshot,
            ancestorSnapshots: this.ancestorSnapshots(element),
        };
        return true;
    }

    update(event: MouseEvent): boolean {
        const drag = this.drag;
        if(!drag) return false;
        drag.updated = true;
        if(!drag.ancestorsPinned) {
            pinAncestorTransformOrigins(this.roots(), drag.element);
            drag.ancestorsPinned = true;
        }
        const point = this.canvasToParentLocal(drag.element, this.editor.toCanvasPoint(event.clientX, event.clientY));
        if(drag.handle === "move") {
            const delta = point.subtract(drag.start!);
            drag.start = point;
            if(drag.nativeGeometry && movesNativeGeometry(drag.element)) moveNativeGeometry(drag.element, delta);
            else {
                drag.element.transform.translateX += delta.x;
                drag.element.transform.translateY += delta.y;
            }
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

        if(drag.nativeGeometry && resizesNativeGeometry(drag.element)) {
            const canvas = this.editor.toCanvasPoint(event.clientX, event.clientY);
            const local = applyMatrix(drag.initialCombinedInverse!, canvas.x, canvas.y);
            const nextBounds = resizedBounds(drag.bounds!, drag.handle, drag.handleLocal!, drag.pivotLocal!, local, event.shiftKey, drag.element instanceof Path ? 0.01 : 1);
            drag.element.transform = cloneTransform(drag.initial!);
            restoreGeometrySnapshot(drag.element, drag.snapshot);
            resizeNativeGeometry(drag.element, drag.bounds!, nextBounds);
            const mappedPivot = applyMatrix(ownMatrix(drag.element), drag.pivotLocal!.x, drag.pivotLocal!.y);
            drag.element.transform.translateX += drag.pivotParent!.x - mappedPivot.x;
            drag.element.transform.translateY += drag.pivotParent!.y - mappedPivot.y;
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

    end(): void {
        if(this.drag && !this.drag.updated) this.restore(this.drag);
        this.drag = undefined;
    }

    cancel(): boolean {
        if(!this.drag) return false;
        const drag = this.drag;
        this.restore(drag);
        this.drag = undefined;
        return true;
    }

    private roots(): AnyElement[] { return this.editor.selectedSVG?.elements ?? []; }

    private canvasToParentLocal(element: AnyElement, point: Point): Point {
        const inverse = invertMatrix(parentMatrixFor(this.roots(), element));
        const local = applyMatrix(inverse, point.x, point.y);
        return new Point(local.x, local.y);
    }

    private ancestorSnapshots(element: AnyElement): Array<{ element: AnyElement; transform: TransformState }> {
        const chain = findElementChain(this.roots(), element);
        return (chain?.slice(0, -1) ?? []).map((ancestor) => ({ element: ancestor, transform: cloneTransform(ancestor.transform) }));
    }


    private restore(drag: TransformDrag): void {
        drag.element.transform = cloneTransform(drag.transformSnapshot);
        restoreGeometrySnapshot(drag.element, drag.snapshot);
        drag.ancestorSnapshots.forEach(({ element, transform }) => element.transform = cloneTransform(transform));
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
    nativeGeometry: boolean;
    initialCombinedInverse?: Matrix;
    snapshot: ElementGeometrySnapshot;
    transformSnapshot: TransformState;
    ancestorSnapshots: Array<{ element: AnyElement; transform: TransformState }>;
    ancestorsPinned?: boolean;
    updated?: boolean;
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

function findElementChain(elements: AnyElement[], target: AnyElement, chain: AnyElement[] = []): AnyElement[] | undefined {
    for(const element of elements) {
        const next = [...chain, element];
        if(element === target) return next;
        if("elements" in element) {
            const found = findElementChain(element.elements, target, next);
            if(found) return found;
        }
    }
    return undefined;
}

function resizedBounds(initial: Bounds, handle: string, handlePoint: Point, pivot: Point, point: { x: number; y: number }, constrained: boolean, minimum: number): Bounds {
    const hasX = handle.includes("e") || handle.includes("w");
    const hasY = handle.includes("n") || handle.includes("s");
    const minimumX = initial.width > 0.000001 ? minimum / initial.width : 1;
    const minimumY = initial.height > 0.000001 ? minimum / initial.height : 1;
    let scaleX = 1;
    let scaleY = 1;
    if(hasX && Math.abs(handlePoint.x - pivot.x) > 0.000001) scaleX = Math.max(minimumX, (point.x - pivot.x) / (handlePoint.x - pivot.x));
    if(hasY && Math.abs(handlePoint.y - pivot.y) > 0.000001) scaleY = Math.max(minimumY, (point.y - pivot.y) / (handlePoint.y - pivot.y));

    if(constrained && initial.width > 0.000001 && initial.height > 0.000001) {
        const ratio = hasX ? scaleX : scaleY;
        scaleX = Math.max(minimumX, ratio);
        scaleY = Math.max(minimumY, ratio);
    }

    return {
        x: pivot.x + (initial.x - pivot.x) * scaleX,
        y: pivot.y + (initial.y - pivot.y) * scaleY,
        width: initial.width * scaleX,
        height: initial.height * scaleY,
    };
}
