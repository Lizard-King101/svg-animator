import { Injectable } from "@angular/core";
import { Bounds } from "../editor/objects/transform.object";
import { DocumentMutationService } from "./document-mutation.service";
import { EditorService } from "./editor.service";

export type CropHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

@Injectable()
export class CanvasCropService {
    draft?: Bounds;
    private documentId?: string;
    private drag?: CropDrag;

    constructor(public editor: EditorService, private mutations: DocumentMutationService) {}

    get active(): boolean { return !!this.draft; }
    get dirty(): boolean {
        const svg = this.editor.selectedSVG;
        return !!svg && !!this.draft && !sameBounds(this.draft, svg.canvasBounds);
    }

    begin(): void {
        const svg = this.editor.selectedSVG;
        if(!svg) { this.draft = undefined; this.documentId = undefined; return; }
        if(this.documentId !== svg.id || !this.draft) {
            this.documentId = svg.id;
            this.draft = { ...svg.canvasBounds };
        }
    }

    cancel(): void {
        const svg = this.editor.selectedSVG;
        this.drag = undefined;
        this.draft = svg ? { ...svg.canvasBounds } : undefined;
    }

    leave(): void {
        this.drag = undefined;
        this.draft = undefined;
        this.documentId = undefined;
    }

    setField(field: keyof Bounds, value: number | string): void {
        if(!this.draft) return;
        const numeric = Number(value);
        if(!Number.isFinite(numeric)) return;
        this.draft = { ...this.draft, [field]: field === "width" || field === "height" ? Math.max(1, numeric) : numeric };
    }

    beginDrag(handle: CropHandle, event: PointerEvent): void {
        if(event.button !== 0 || !this.draft) return;
        event.preventDefault(); event.stopPropagation();
        this.drag = {
            pointerId: event.pointerId,
            handle,
            startPoint: this.editor.toCanvasPoint(event.clientX, event.clientY),
            startBounds: { ...this.draft },
        };
        try { (event.currentTarget as Element).setPointerCapture(event.pointerId); } catch {}
    }

    updateDrag(event: PointerEvent): void {
        const drag = this.drag;
        if(!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        const point = this.editor.toCanvasPoint(event.clientX, event.clientY);
        const dx = point.x - drag.startPoint.x;
        const dy = point.y - drag.startPoint.y;
        let { x, y, width, height } = drag.startBounds;
        if(drag.handle.includes("w")) { x += dx; width -= dx; }
        if(drag.handle.includes("e")) width += dx;
        if(drag.handle.includes("n")) { y += dy; height -= dy; }
        if(drag.handle.includes("s")) height += dy;
        if(width < 1) { if(drag.handle.includes("w")) x = drag.startBounds.x + drag.startBounds.width - 1; width = 1; }
        if(height < 1) { if(drag.handle.includes("n")) y = drag.startBounds.y + drag.startBounds.height - 1; height = 1; }
        this.draft = { x: rounded(x), y: rounded(y), width: rounded(width), height: rounded(height) };
    }

    endDrag(event: PointerEvent): void {
        const drag = this.drag;
        if(!drag || drag.pointerId !== event.pointerId) return;
        if(event.type === "pointercancel") this.draft = drag.startBounds;
        else this.updateDrag(event);
        try { (event.currentTarget as Element).releasePointerCapture(event.pointerId); } catch {}
        this.drag = undefined;
    }

    apply(canvasFrame: Bounds): boolean {
        const svg = this.editor.selectedSVG;
        const draft = this.draft;
        if(!svg || !draft || !this.dirty) return false;
        const current = svg.canvasBounds;
        const scaleX = canvasFrame.width / current.width;
        const scaleY = canvasFrame.height / current.height;
        const nextRenderedLeft = canvasFrame.x + (draft.x - current.x) * scaleX;
        const nextRenderedTop = canvasFrame.y + (draft.y - current.y) * scaleY;
        const zoom = svg.zoom || 1;
        svg.viewBoxX = rounded(draft.x);
        svg.viewBoxY = rounded(draft.y);
        svg.width = Math.max(1, rounded(draft.width));
        svg.height = Math.max(1, rounded(draft.height));
        svg.pos.x = nextRenderedLeft - svg.width * (1 - zoom) / 2;
        svg.pos.y = nextRenderedTop - svg.height * (1 - zoom) / 2;
        this.editor.rememberCanvasView(svg);
        const changed = this.mutations.commit("canvas");
        this.draft = { ...svg.canvasBounds };
        return changed;
    }
}

interface CropDrag {
    pointerId: number;
    handle: CropHandle;
    startPoint: { x: number; y: number };
    startBounds: Bounds;
}

function sameBounds(a: Bounds, b: Bounds): boolean {
    return Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001
        && Math.abs(a.width - b.width) < 0.0001 && Math.abs(a.height - b.height) < 0.0001;
}

function rounded(value: number): number { return Math.round(value * 100) / 100; }
