import { tangentAlignedHandle } from '../../editor/objects/ellipse-geometry';
import { EditorService } from '../editor.service';
import { Path } from '../../editor/objects/elements/path.object';
import { Point } from '../../editor/objects/point.object';
import { combinedMatrixFor, findElementChain, pinAncestorTransformOrigins, pinTransformOrigin } from '../../editor/objects/element-bounds';
import { captureGeometrySnapshot, restoreGeometrySnapshot } from '../../editor/objects/element-geometry';
import { applyMatrix, invertMatrix } from '../../editor/objects/transform.object';
import { PointSnappingInteraction } from './point-snapping.interaction';

/** An existing anchor's complete gesture, including attached handles and automatic origins. */
export class PathAnchorInteraction {
    private snapping: PointSnappingInteraction;
    private drag?: ReturnType<PathAnchorInteraction['capture']>;
    constructor(private editor: EditorService) { this.snapping = new PointSnappingInteraction(editor); }
    get feedback() { return this.snapping.feedback; }

    begin(path: Path, anchor: Point, pointer: Point): boolean {
        this.cancel();
        const chain = findElementChain(this.editor.selectedSVG?.elements ?? [], path);
        if(!chain || chain.some((element) => !element.visible || element.locked || !!element.motion.pathId)) return false;
        const matrix = combinedMatrixFor(this.editor.selectedSVG!.elements, path);
        if(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-8) return false;
        this.drag = this.capture(path, anchor, pointer);
        const endpoint = path.contours.some(contour => !contour.closed &&
            (contour.lines[0]?.points[0] === anchor || contour.lines.at(-1)?.points[1] === anchor));
        this.snapping.begin({ path, points: new Set([anchor]) }, undefined, endpoint && this.drag.attached.size > 1);
        return true;
    }

    update(pointer: Point, bypass: boolean): boolean {
        const drag = this.drag;
        if(!drag) return false;
        drag.pointer = pointer;
        this.restore();
        const dx = pointer.x - drag.start.x, dy = pointer.y - drag.start.y;
        // Preserve the pointer's grab offset and exact return-to-start behavior.
        const raw = new Point(drag.world.x + dx, drag.world.y + dy);
        const next = this.snapping.update(raw, bypass || Math.hypot(dx, dy) < 1e-8);
        const local = applyMatrix(drag.inverse, next.x, next.y);
        const delta = { x: local.x - drag.anchorStart.x, y: local.y - drag.anchorStart.y };
        drag.changed = Math.hypot(delta.x, delta.y) > 1e-8;
        if(!drag.changed) return true;
        pinAncestorTransformOrigins(this.editor.selectedSVG!.elements, drag.path);
        pinTransformOrigin(drag.path);
        drag.attached.forEach((point) => { point.x += delta.x; point.y += delta.y; });
        const tangent = this.snapping.feedback?.target?.tangent;
        if(tangent) {
            const localTangent = { x: drag.inverse.a * tangent.x + drag.inverse.c * tangent.y, y: drag.inverse.b * tangent.x + drag.inverse.d * tangent.y };
            drag.attached.forEach(handle => {
                if(handle === drag.anchor) return;
                const aligned = tangentAlignedHandle(local, handle, localTangent);
                handle.x = aligned.x; handle.y = aligned.y;
            });
        }
        return true;
    }

    setBypass(bypass: boolean): void { if(this.drag) this.update(this.drag.pointer, bypass); }
    end(): void { if(this.drag && !this.drag.changed) this.restore(); this.drag = undefined; this.snapping.clear(); }
    cancel(): boolean {
        if(!this.drag) return false;
        this.restore(); this.drag = undefined; this.snapping.clear(); return true;
    }
    private restore(): void {
        const drag = this.drag;
        if(!drag) return;
        restoreGeometrySnapshot(drag.path, drag.geometry);
        drag.transforms.forEach(({ element, transform }) => element.transform = { ...transform });
    }
    private capture(path: Path, anchor: Point, pointer: Point) {
        const matrix = combinedMatrixFor(this.editor.selectedSVG!.elements, path);
        const attached = new Set([anchor]);
        path.contours.flatMap((contour) => contour.lines).forEach((line) => {
            if(line.points[0] === anchor && line.controlStart) attached.add(line.controlStart);
            if(line.points[1] === anchor && line.controlEnd) attached.add(line.controlEnd);
        });
        return { path, anchor, anchorStart: { x: anchor.x, y: anchor.y }, start: pointer, pointer,
            world: applyMatrix(matrix, anchor.x, anchor.y), inverse: invertMatrix(matrix), attached,
            geometry: captureGeometrySnapshot(path), changed: false,
            transforms: findElementChain(this.editor.selectedSVG!.elements, path)!.map((element) => ({ element, transform: { ...element.transform } })) };
    }
}
