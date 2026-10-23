import { EditorService } from '../editor.service';
import { localBounds } from '../../editor/objects/element-bounds';
import { combinedMotionAdjustedMatrixFor } from '../../editor/objects/motion-path.object';
import { AnyElement } from '../../editor/objects/svg.object';
import { Bounds, transformedBounds } from '../../editor/objects/transform.object';

export class MarqueeInteraction {
    bounds?: Bounds;
    private drag?: { x: number; y: number; clientX: number; clientY: number; baseline: AnyElement[]; additive: boolean };
    constructor(private editor: EditorService) {}

    begin(event: MouseEvent): void {
        const point = this.editor.toCanvasPoint(event.clientX, event.clientY);
        this.drag = { ...point, clientX: event.clientX, clientY: event.clientY,
            baseline: [...this.editor.selectedElements], additive: event.shiftKey || event.ctrlKey || event.metaKey };
    }

    update(event: MouseEvent): boolean {
        const start = this.drag;
        const svg = this.editor.selectedSVG;
        if(!start || !svg) return false;
        if(!this.bounds && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 3) return true;
        const point = this.editor.toCanvasPoint(event.clientX, event.clientY);
        const bounds = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y),
            width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
        this.bounds = bounds;
        // Marquee selects whole top-level objects/groups. Direct and Layers
        // selection still allow editing individual nested children.
        const hits = svg.elements.filter((element) => {
            if(!element.visible || element.locked) return false;
            const candidate = transformedBounds(localBounds(element), combinedMotionAdjustedMatrixFor(svg, element));
            return candidate.x <= bounds.x + bounds.width && candidate.x + candidate.width >= bounds.x
                && candidate.y <= bounds.y + bounds.height && candidate.y + candidate.height >= bounds.y;
        });
        this.editor.selectedElements = start.additive ? [...new Set([...start.baseline, ...hits])] : hits;
        return true;
    }

    end(): boolean {
        if(!this.drag) return false;
        if(!this.bounds && !this.drag.additive) this.editor.selectedElements = [];
        this.bounds = undefined;
        this.drag = undefined;
        return true;
    }

    cancel(): boolean {
        if(!this.drag) return false;
        this.editor.selectedElements = this.drag.baseline;
        this.bounds = undefined;
        this.drag = undefined;
        return true;
    }
}
