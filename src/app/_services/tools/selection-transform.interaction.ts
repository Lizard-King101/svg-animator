import { EditorService } from '../editor.service';
import { findElementChain, ownMatrix, parentMatrixFor, resolvedOrigin } from '../../editor/objects/element-bounds';
import { AnyElement } from '../../editor/objects/svg.object';
import { Point } from '../../editor/objects/point.object';
import { SelectionFrame, selectionFrame } from '../../editor/selection';
import { translateSelection } from '../../editor/selection-arrangement';
import { Matrix, TransformState, applyMatrix, invertMatrix, multiplyMatrix, rotationMatrix, scaleMatrix, translationMatrix } from '../../editor/objects/transform.object';
import { EdgeRotationSnapSession, edgeRotationSession } from '../../editor/objects/edge-rotation-snapping';

/** One baseline and pivot for a set of independently editable elements. */
export class SelectionTransformInteraction {
    private drag?: SelectionDrag;
    private rotationSnapping?: EdgeRotationSnapSession;
    get rotationSnapFeedback() { return this.rotationSnapping?.feedback; }
    constructor(private editor: EditorService) {}

    begin(handle: string, event: MouseEvent): boolean {
        return this.beginAt(handle, this.editor.toCanvasPoint(event.clientX, event.clientY), event.altKey);
    }

    nudge(delta: Point): boolean {
        const svg = this.editor.selectedSVG;
        const frame = svg && selectionFrame(svg, this.editor.selectedElements);
        return !!svg && !!frame?.canTransform && translateSelection(svg,
            frame.elements.map((element) => ({ element, x: delta.x, y: delta.y })));
    }

    private beginAt(handle: string, canvas: Point, fromCenter: boolean): boolean {
        this.rotationSnapping = undefined;
        const svg = this.editor.selectedSVG;
        const frame = svg && selectionFrame(svg, this.editor.selectedElements);
        if(!svg || !frame?.canTransform || handle === 'origin' || (handle === 'rotate' && !frame.canRotate)) return false;
        const inverse = invertMatrix(frame.matrix);
        const start = applyMatrix(inverse, canvas.x, canvas.y);
        const { bounds } = frame;
        const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        const pivot = handle === 'rotate' || fromCenter ? center : {
            x: handle.includes('w') ? bounds.x + bounds.width : bounds.x,
            y: handle.includes('n') ? bounds.y + bounds.height : bounds.y,
        };
        const ancestors = new Map<AnyElement, { transform: TransformState; origin: { x: number; y: number } }>();
        const targets = frame.elements.map((element) => {
            findElementChain(svg.elements, element)!.slice(0, -1).forEach((ancestor) => {
                if(!ancestors.has(ancestor)) ancestors.set(ancestor, { transform: { ...ancestor.transform }, origin: resolvedOrigin(ancestor) });
            });
            return { element, transform: { ...element.transform }, origin: resolvedOrigin(element),
                parent: parentMatrixFor(svg.elements, element), own: ownMatrix(element) };
        });
        this.drag = { handle, frame, inverse, start, pivot, targets, ancestors, changed: false };
        if(handle === 'rotate') this.rotationSnapping = edgeRotationSession(svg, frame.elements, frame.matrix, pivot);
        return true;
    }

    update(event: Pick<MouseEvent, 'clientX' | 'clientY' | 'shiftKey' | 'altKey'>, point?: Point): boolean {
        if(!this.drag) return false;
        return this.updateAt(point ?? this.editor.toCanvasPoint(event.clientX, event.clientY), event.shiftKey, event.altKey);
    }

    private updateAt(canvas: Point, constrained: boolean, bypass: boolean): boolean {
        const drag = this.drag;
        if(!drag) return false;
        const point = applyMatrix(drag.inverse, canvas.x, canvas.y);
        this.restore(drag);
        drag.changed = Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 0.000001;
        if(!drag.changed) { this.rotationSnapping?.clear(); return true; }
        let operation: Matrix;
        if(drag.handle === 'move') {
            operation = translationMatrix(point.x - drag.start.x, point.y - drag.start.y);
        } else {
            let linear: Matrix;
            if(drag.handle === 'rotate') {
                let angle = (Math.atan2(point.y - drag.pivot.y, point.x - drag.pivot.x)
                    - Math.atan2(drag.start.y - drag.pivot.y, drag.start.x - drag.pivot.x)) * 180 / Math.PI;
                if(constrained) angle = Math.round(angle / 15) * 15;
                angle = this.rotationSnapping?.update(angle, bypass || constrained || !this.editor.objectSnapping) ?? angle;
                linear = rotationMatrix(angle);
            } else {
                const x = drag.start.x - drag.pivot.x;
                const y = drag.start.y - drag.pivot.y;
                const lengthSquared = x * x + y * y;
                const ratio = lengthSquared > 0.000001
                    ? Math.max(0.01, ((point.x - drag.pivot.x) * x + (point.y - drag.pivot.y) * y) / lengthSquared) : 1;
                linear = scaleMatrix(ratio, ratio);
            }
            operation = multiplyMatrix(translationMatrix(drag.pivot.x, drag.pivot.y),
                multiplyMatrix(linear, translationMatrix(-drag.pivot.x, -drag.pivot.y)));
        }
        const world = multiplyMatrix(drag.frame.matrix, multiplyMatrix(operation, drag.inverse));
        if(Math.abs(world.a - 1) + Math.abs(world.d - 1) + Math.abs(world.b) + Math.abs(world.c)
            + Math.abs(world.e) + Math.abs(world.f) < 0.000001) { drag.changed = false; return true; }
        const next = drag.targets.map((target) => {
            const local = multiplyMatrix(invertMatrix(target.parent), multiplyMatrix(world, multiplyMatrix(target.parent, target.own)));
            return transformFromMatrix(local, target.transform, target.origin);
        });
        if(next.some((transform) => !transform)) { drag.changed = false; return true; }
        // Pin all ancestors before changing any child; otherwise one child's
        // changed bounds could shift the next child's automatic parent origin.
        drag.ancestors.forEach(({ origin }, element) => {
            element.transform.originX = origin.x;
            element.transform.originY = origin.y;
        });
        drag.targets.forEach((target, index) => target.element.transform = next[index]!);
        return true;
    }

    end(): void { if(this.drag && !this.drag.changed) this.restore(this.drag); this.drag = undefined; this.rotationSnapping = undefined; }
    cancel(): boolean {
        this.rotationSnapping = undefined;
        if(!this.drag) return false;
        this.restore(this.drag);
        this.drag = undefined;
        return true;
    }

    private restore(drag: SelectionDrag): void {
        drag.targets.forEach(({ element, transform }) => element.transform = { ...transform });
        drag.ancestors.forEach(({ transform }, element) => element.transform = { ...transform });
    }
}

interface SelectionDrag {
    handle: string;
    frame: SelectionFrame;
    inverse: Matrix;
    start: { x: number; y: number };
    pivot: { x: number; y: number };
    targets: { element: AnyElement; transform: TransformState; origin: { x: number; y: number }; parent: Matrix; own: Matrix }[];
    ancestors: Map<AnyElement, { transform: TransformState; origin: { x: number; y: number } }>;
    changed: boolean;
}

function transformFromMatrix(matrix: Matrix, baseline: TransformState, origin: { x: number; y: number }): TransformState | undefined {
    const length = Math.hypot(matrix.a, matrix.b);
    const otherLength = Math.hypot(matrix.c, matrix.d);
    if(length < 0.000001 || Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) > 0.000001 * length * otherLength) return undefined;
    const scaleX = length * (baseline.scaleX < 0 ? -1 : 1);
    const scaleY = (matrix.a * matrix.d - matrix.b * matrix.c) / scaleX;
    const angle = Math.atan2(matrix.b / scaleX, matrix.a / scaleX) * 180 / Math.PI;
    const rotation = angle + 360 * Math.round((baseline.rotation - angle) / 360);
    return { ...baseline, scaleX, scaleY, rotation,
        translateX: matrix.e - origin.x + matrix.a * origin.x + matrix.c * origin.y,
        translateY: matrix.f - origin.y + matrix.b * origin.x + matrix.d * origin.y };
}
