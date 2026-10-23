import { EditorService } from '../editor.service';
import { MoveSnapFeedback, MoveSnapSession, moveSnapCandidates, movingSnapBounds } from '../../editor/objects/snapping.object';
import { Point } from '../../editor/objects/point.object';
import { AnyElement } from '../../editor/objects/svg.object';
import { Group } from '../../editor/objects/elements/group.object';
import { selectionFrame } from '../../editor/selection';

/** Transient snapping shared by single-object and selection move gestures. */
export class MoveSnappingInteraction {
    private session?: MoveSnapSession;
    private start?: Point;
    constructor(private editor: EditorService) {}
    get feedback(): MoveSnapFeedback | undefined { return this.session?.feedback; }

    begin(start: Point): void {
        this.clear();
        const svg = this.editor.selectedSVG;
        if(!svg || !this.editor.objectSnapping) return;
        const selected = this.editor.selectedElements ?? (this.editor.selectedElement ? [this.editor.selectedElement] : []);
        const frame = selectionFrame(svg, selected);
        if(!frame?.canTransform || frame.elements.some(containsMotion)) return;
        this.start = start;
        this.session = new MoveSnapSession(movingSnapBounds(svg, frame.elements), moveSnapCandidates(svg, frame.elements));
    }

    update(point: Point, bypass: boolean): Point {
        if(!this.session || !this.start) return point;
        const delta = this.session.update({ x: point.x - this.start.x, y: point.y - this.start.y },
            this.editor.selectedSVG?.zoom ?? 1, bypass || !this.editor.objectSnapping);
        return new Point(this.start.x + delta.x, this.start.y + delta.y);
    }

    clear(): void { this.session = undefined; this.start = undefined; }
}

function containsMotion(element: AnyElement): boolean {
    return !!element.motion.pathId || (element instanceof Group && element.elements.some(containsMotion));
}
