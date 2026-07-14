import { NgClass, NgFor, NgIf, NgStyle } from "@angular/common";
import { Component, Input } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { DocumentMutationService } from "../../_services/document-mutation.service";
import { EditorService } from "../../_services/editor.service";
import { parseGuideExpression } from "../../editor/guide-expression";
import { CanvasGuide } from "../../editor/objects/svg.object";
import { CanvasWorkspaceComponent } from "../canvas-workspace/canvas-workspace.component";

@Component({
    selector: "app-canvas-guides",
    standalone: true,
    imports: [FormsModule, NgClass, NgFor, NgIf, NgStyle, FaIconComponent],
    templateUrl: "canvas-guides.component.html",
    styles: [":host { display: contents; }"],
})
export class CanvasGuidesComponent {
    @Input({ required: true }) canvas?: SVGElement;
    @Input({ required: true }) workspace?: CanvasWorkspaceComponent;
    drag?: GuideDragState;
    input?: GuideInputState;
    private lastCreated?: CanvasGuide;
    readonly rulerSize = 24;

    constructor(public editor: EditorService, private mutations: DocumentMutationService) {}

    screenPosition(guide: CanvasGuide): number { return guide.axis === "x" ? this.toViewportX(guide.value) : this.toViewportY(guide.value); }
    activeScreenPosition(): number { return !this.drag ? 0 : this.drag.axis === "x" ? this.toViewportX(this.drag.value) : this.toViewportY(this.drag.value); }
    activeLabel(): string { return this.drag ? `${this.drag.axis} ${this.format(this.drag.value)}` : ""; }
    activeBadgeStyle(): Record<string, string> {
        if(!this.drag) return {};
        const left = this.drag.axis === "x" ? this.activeScreenPosition() + 8 : this.rulerSize + 8;
        const top = this.drag.axis === "y" ? this.activeScreenPosition() + 8 : this.rulerSize + 8;
        return { left: `${left}px`, top: `${top}px` };
    }

    rulerMarks(axis: "x" | "y"): RulerMark[] {
        const svg = this.editor.selectedSVG;
        const viewport = this.workspace?.element;
        if(!svg || !viewport) return [];
        const length = axis === "x" ? svg.width : svg.height;
        const viewportLength = axis === "x" ? viewport.clientWidth : viewport.clientHeight;
        const step = this.rulerStep(svg.zoom);
        const marks: RulerMark[] = [];
        for(let value = 0; value <= length + 0.0001; value += step) {
            const position = (axis === "x" ? this.toViewportX(value) : this.toViewportY(value)) - this.rulerSize;
            if(position >= -80 && position <= viewportLength - this.rulerSize + 80) marks.push({ position, label: String(Math.round(value)) });
        }
        return marks;
    }

    trackRulerMark(_index: number, mark: RulerMark): string { return mark.label; }

    canDrag(): boolean { return !this.editor.selectedSVG?.guidesLocked && (this.editor.selectedTool?.interactsWithGuides ?? false); }
    toggleLock(event: MouseEvent): void {
        event.preventDefault(); event.stopPropagation();
        const svg = this.editor.selectedSVG;
        if(!svg) return;
        svg.guidesLocked = !svg.guidesLocked;
        this.drag = undefined; this.input = undefined;
        this.editor.closeContextMenu();
        this.mutations.commit("guides");
    }

    beginRulerDrag(axis: "x" | "y", event: PointerEvent): void {
        const svg = this.editor.selectedSVG;
        if(event.button !== 0 || !svg || svg.guidesLocked) return;
        event.preventDefault(); event.stopPropagation();
        if(event.detail > 1) return;
        const guide: CanvasGuide = { id: this.editor.ID, axis, value: this.valueFromEvent(axis, event, event.shiftKey) };
        svg.guides.push(guide);
        this.drag = { pointerId: event.pointerId, guide, axis, value: guide.value, created: true };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    beginExistingDrag(guide: CanvasGuide, event: PointerEvent): void {
        if(event.button !== 0 || this.editor.selectedSVG?.guidesLocked) return;
        event.preventDefault(); event.stopPropagation();
        this.drag = { pointerId: event.pointerId, guide, axis: guide.axis, value: guide.value, created: false };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    updateDrag(event: PointerEvent): void {
        if(!this.drag || this.drag.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        this.drag.value = this.valueFromEvent(this.drag.axis, event, event.shiftKey);
        this.drag.guide.value = this.drag.value;
    }

    endDrag(event: PointerEvent): void {
        if(!this.drag || this.drag.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId); } catch {}
        if(this.inDeleteZone(this.drag.axis, event)) {
            this.remove(this.drag.guide); this.lastCreated = undefined; this.drag = undefined;
            this.mutations.commit("guides");
            return;
        }
        this.drag.guide.value = this.drag.value;
        if(this.drag.created) this.lastCreated = this.drag.guide;
        this.drag = undefined;
        this.mutations.commit("guides");
    }

    openContextMenu(guide: CanvasGuide, event: MouseEvent): void {
        event.preventDefault(); event.stopPropagation();
        if(this.editor.selectedSVG?.guidesLocked) return;
        this.editor.openContextMenu(event.clientX, event.clientY, [
            { label: "Edit Position", action: () => this.openInput(guide.axis, event.clientX, event.clientY, guide) },
            { label: "Delete Guide", shortcut: "Del", action: () => this.delete(guide) },
        ]);
    }

    openRulerInput(axis: "x" | "y", event: MouseEvent): void {
        event.preventDefault(); event.stopPropagation();
        if(this.editor.selectedSVG?.guidesLocked) return;
        this.removeLastCreatedIfMatching(axis, event);
        this.openInput(axis, event.clientX, event.clientY);
    }

    openInput(axis: "x" | "y", clientX: number, clientY: number, guide?: CanvasGuide): void {
        if(this.editor.selectedSVG?.guidesLocked) return;
        const viewport = this.workspace?.element.getBoundingClientRect();
        const existing = guide?.value ?? this.valueFromClient(axis, clientX, clientY, false);
        this.input = {
            axis, guide, value: this.format(existing),
            x: viewport ? Math.max(this.rulerSize + 4, Math.min(viewport.width - 180, clientX - viewport.left)) : clientX,
            y: viewport ? Math.max(this.rulerSize + 4, Math.min(viewport.height - 48, clientY - viewport.top)) : clientY,
        };
        this.editor.closeContextMenu();
    }

    applyInput(): void {
        const input = this.input;
        const svg = this.editor.selectedSVG;
        if(!input || !svg || svg.guidesLocked) return;
        const value = parseGuideExpression(input.value, svg.width, svg.height, input.axis);
        if(value == null) { input.error = "Invalid position"; return; }
        const guide = input.guide ?? { id: this.editor.ID, axis: input.axis, value };
        guide.value = value;
        if(!input.guide) svg.guides.push(guide);
        this.input = undefined;
        this.mutations.commit("guides");
    }

    cancelInput(): void { this.input = undefined; }
    delete(guide: CanvasGuide): void {
        if(this.editor.selectedSVG?.guidesLocked) return;
        this.remove(guide);
        this.mutations.commit("guides");
    }

    private toViewportX(value: number): number {
        const svg = this.editor.selectedSVG;
        const rect = this.canvasRect();
        return rect && svg?.width ? rect.left + value * rect.width / svg.width : svg ? svg.pos.x + svg.width * (1 - svg.zoom) / 2 + value * svg.zoom : 0;
    }
    private toViewportY(value: number): number {
        const svg = this.editor.selectedSVG;
        const rect = this.canvasRect();
        return rect && svg?.height ? rect.top + value * rect.height / svg.height : svg ? svg.pos.y + svg.height * (1 - svg.zoom) / 2 + value * svg.zoom : 0;
    }
    private canvasRect(): { left: number; top: number; width: number; height: number } | undefined {
        const viewport = this.workspace?.element;
        if(!this.canvas || !viewport) return undefined;
        const canvas = this.canvas.getBoundingClientRect();
        const view = viewport.getBoundingClientRect();
        return { left: canvas.left - view.left, top: canvas.top - view.top, width: canvas.width, height: canvas.height };
    }
    private valueFromEvent(axis: "x" | "y", event: PointerEvent | MouseEvent, roundToTen: boolean): number {
        return this.valueFromClient(axis, event.clientX, event.clientY, roundToTen);
    }
    private valueFromClient(axis: "x" | "y", clientX: number, clientY: number, roundToTen: boolean): number {
        const point = this.editor.toCanvasPoint(clientX, clientY);
        const value = axis === "x" ? point.x : point.y;
        return roundToTen ? Math.round(value / 10) * 10 : value;
    }
    private inDeleteZone(axis: "x" | "y", event: PointerEvent): boolean {
        const viewport = this.workspace?.element.getBoundingClientRect();
        return !!viewport && (axis === "x" ? event.clientX <= viewport.left + this.rulerSize : event.clientY <= viewport.top + this.rulerSize);
    }
    private remove(guide: CanvasGuide): void {
        const svg = this.editor.selectedSVG;
        if(svg) svg.guides = svg.guides.filter(candidate => candidate !== guide);
    }
    private removeLastCreatedIfMatching(axis: "x" | "y", event: MouseEvent): void {
        const svg = this.editor.selectedSVG;
        const guide = this.lastCreated;
        if(!svg || !guide || guide.axis !== axis) return;
        const threshold = 6 / Math.max(0.01, svg.zoom || 1);
        if(Math.abs(guide.value - this.valueFromEvent(axis, event, false)) <= threshold) {
            this.remove(guide); this.lastCreated = undefined; this.mutations.commit("guides");
        }
    }
    private format(value: number): string { return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100); }
    private rulerStep(zoom: number): number {
        const raw = 96 / Math.max(0.01, zoom);
        const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
        const normalized = raw / magnitude;
        return (normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
    }
}

interface GuideDragState { pointerId: number; guide: CanvasGuide; axis: "x" | "y"; value: number; created: boolean }
interface GuideInputState { axis: "x" | "y"; guide?: CanvasGuide; value: string; x: number; y: number; error?: string }
interface RulerMark { position: number; label: string }
