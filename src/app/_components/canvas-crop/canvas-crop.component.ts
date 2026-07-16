import { NgFor, NgIf, NgStyle } from "@angular/common";
import { Component, DoCheck, HostListener, Input } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CanvasCropService, CropHandle } from "../../_services/canvas-crop.service";
import { EditorService } from "../../_services/editor.service";
import { CropTool } from "../../_services/tools/crop.tool";
import { canvasToWorkspaceProjection, CanvasWorkspaceProjection } from "../../editor/canvas-workspace-projection";
import { isEditableEventTarget } from "../../editor/editable-event-target";
import { applyMatrix, Bounds } from "../../editor/objects/transform.object";
import { CanvasWorkspaceComponent } from "../canvas-workspace/canvas-workspace.component";

@Component({
    selector: "app-canvas-crop",
    standalone: true,
    imports: [FormsModule, NgFor, NgIf, NgStyle],
    templateUrl: "canvas-crop.component.html",
    styleUrl: "canvas-crop.component.scss",
    host: { style: "display: contents" },
})
export class CanvasCropComponent implements DoCheck {
    @Input({ required: true }) artwork?: SVGElement;
    @Input({ required: true }) workspace?: CanvasWorkspaceComponent;
    readonly handles: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    readonly Math = Math;

    constructor(public crop: CanvasCropService, public editor: EditorService) {}

    ngDoCheck(): void {
        if(this.editor.selectedTool instanceof CropTool) this.crop.begin();
        else if(this.crop.active) this.crop.leave();
    }

    get frame(): CropFrame | undefined {
        const projection = this.projection();
        const bounds = this.crop.draft;
        if(!projection || !bounds) return undefined;
        const nw = applyMatrix(projection.canvasToWorkspace, bounds.x, bounds.y);
        const se = applyMatrix(projection.canvasToWorkspace, bounds.x + bounds.width, bounds.y + bounds.height);
        const x = Math.min(nw.x, se.x), y = Math.min(nw.y, se.y);
        const width = Math.abs(se.x - nw.x), height = Math.abs(se.y - nw.y);
        const points: Record<CropHandle, { x: number; y: number }> = {
            nw: { x, y }, n: { x: x + width / 2, y }, ne: { x: x + width, y },
            e: { x: x + width, y: y + height / 2 }, se: { x: x + width, y: y + height },
            s: { x: x + width / 2, y: y + height }, sw: { x, y: y + height }, w: { x, y: y + height / 2 },
        };
        return { x, y, width, height, points };
    }

    handlePoint(handle: CropHandle): { x: number; y: number } { return this.frame?.points[handle] ?? { x: 0, y: 0 }; }
    panelStyle(): Record<string, string> {
        const frame = this.frame;
        const workspace = this.workspace?.element;
        if(!frame || !workspace) return {};
        return {
            left: `${Math.max(28, Math.min(workspace.clientWidth - 430, frame.x))}px`,
            top: `${Math.max(30, Math.min(workspace.clientHeight - 44, frame.y - 40))}px`,
        };
    }

    apply(): void {
        const projection = this.projection();
        if(projection) this.crop.apply(projection.canvasFrame);
    }

    cancelOrExit(): void {
        if(this.crop.dirty) this.crop.cancel();
        else {
            this.crop.leave();
            this.editor.tools[0]?.restoreSelection();
        }
    }

    @HostListener("document:keydown", ["$event"])
    handleKey(event: KeyboardEvent): void {
        if(!(this.editor.selectedTool instanceof CropTool) || isEditableEventTarget(event.target)) return;
        if(event.key === "Enter") { event.preventDefault(); event.stopPropagation(); this.apply(); }
        if(event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.cancelOrExit(); }
    }

    private projection(): CanvasWorkspaceProjection | undefined {
        const svg = this.editor.selectedSVG;
        const workspace = this.workspace?.element;
        if(!svg || !workspace || !this.artwork) return undefined;
        return canvasToWorkspaceProjection(this.artwork.getBoundingClientRect(), workspace.getBoundingClientRect(), svg.canvasBounds);
    }
}

interface CropFrame extends Bounds { points: Record<CropHandle, { x: number; y: number }> }
