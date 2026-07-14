import { NgFor, NgIf } from "@angular/common";
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { GradientPresetService } from "../../_services/gradient-preset.service";
import { cloneColor, Color } from "../../editor/objects/color.object";
import { GradientPaint, GradientStop, gradientStopOpacity, isGradientPaint, Paint } from "../../editor/objects/paint.object";
import { ColorAttribute } from "../attributes/color/color.component";
import {
    FULL_PAINT_EDITOR_CAPABILITIES,
    PaintEditorCapabilities,
    PaintEditorChange,
} from "./paint-editor.types";

@Component({
    selector: "app-paint-editor",
    standalone: true,
    imports: [FormsModule, NgFor, NgIf, ColorAttribute],
    templateUrl: "paint-editor.component.html",
    styleUrls: ["paint-editor.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaintEditorComponent implements OnChanges {
    @Input() label?: string;
    @Input() paint: Paint | null = null;
    @Input() capabilities: PaintEditorCapabilities = FULL_PAINT_EDITOR_CAPABILITIES;
    @Input() compact = false;
    @Output() readonly paintChange = new EventEmitter<PaintEditorChange>();

    selectedStopId?: string;
    advancedOpen = false;
    private readonly emptySolid = new Color("#000000");
    private stopDrag?: { pointerId: number; ramp: HTMLElement; stopId: string; startOffset: number };

    constructor(public presets: GradientPresetService) {}

    ngOnChanges(changes: SimpleChanges): void {
        if(!changes["paint"]) return;
        const gradient = this.gradient;
        if(!gradient) {
            this.selectedStopId = undefined;
            return;
        }
        if(!gradient.stops.some((stop) => stop.id === this.selectedStopId)) {
            this.selectedStopId = [...gradient.stops].sort((a, b) => a.offset - b.offset)[0]?.id;
        }
    }

    get gradient(): GradientPaint | null { return isGradientPaint(this.paint) ? this.paint : null; }
    get solid(): Color { return this.paint instanceof Color ? this.paint : this.emptySolid; }
    get selectedStop(): GradientStop | undefined {
        return this.gradient?.stops.find((stop) => stop.id === this.selectedStopId);
    }

    selectMode(mode: "solid" | "gradient"): void {
        if(!this.capabilities.mode || (mode === "gradient") === !!this.gradient) return;
        this.paintChange.emit({ type: "mode", mode, selectedStopId: this.selectedStopId });
    }

    setSolidColor(color: Color): void {
        this.paintChange.emit({ type: "solid-color", color: cloneColor(color) });
    }

    selectStop(stop: GradientStop): void { this.selectedStopId = stop.id; }

    setStopColor(color: Color): void {
        const stop = this.selectedStop;
        if(stop) this.paintChange.emit({ type: "stop", stopId: stop.id, field: "color", value: cloneColor(color) });
    }

    setStopNumber(field: "offset" | "opacity", value: unknown): void {
        const stop = this.selectedStop;
        const numeric = Number(value);
        if(stop && Number.isFinite(numeric)) {
            this.paintChange.emit({ type: "stop", stopId: stop.id, field, value: clamp01(numeric) });
        }
    }

    addStop(): void {
        if(!this.gradient || !this.capabilities.stopStructure) return;
        const stopId = paintEditorId();
        this.selectedStopId = stopId;
        this.paintChange.emit({ type: "add-stop", stopId });
    }

    removeSelectedStop(): void {
        const gradient = this.gradient;
        const stop = this.selectedStop;
        if(!gradient || !stop || !this.capabilities.stopStructure || gradient.stops.length <= 2) return;
        const sorted = [...gradient.stops].sort((a, b) => a.offset - b.offset);
        const index = sorted.findIndex((candidate) => candidate.id === stop.id);
        this.selectedStopId = (sorted[index - 1] ?? sorted[index + 1])?.id;
        this.paintChange.emit({ type: "remove-stop", stopId: stop.id });
    }

    beginStopDrag(stop: GradientStop, event: PointerEvent): void {
        if(event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.selectStop(stop);
        const marker = event.currentTarget as HTMLElement;
        const ramp = marker.closest(".paint-ramp") as HTMLElement | null;
        if(!ramp) return;
        this.stopDrag = { pointerId: event.pointerId, ramp, stopId: stop.id, startOffset: stop.offset };
        try { marker.setPointerCapture(event.pointerId); } catch {}
        this.updateStopDrag(event);
    }

    updateStopDrag(event: PointerEvent): void {
        const drag = this.stopDrag;
        if(!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        const rect = drag.ramp.getBoundingClientRect();
        if(rect.width <= 0) return;
        this.paintChange.emit({
            type: "stop",
            stopId: drag.stopId,
            field: "offset",
            value: clamp01((event.clientX - rect.left) / rect.width),
        });
    }

    endStopDrag(event: PointerEvent): void {
        if(this.stopDrag?.pointerId !== event.pointerId) return;
        this.updateStopDrag(event);
        this.stopDrag = undefined;
    }

    cancelStopDrag(event: PointerEvent): void {
        const drag = this.stopDrag;
        if(!drag || drag.pointerId !== event.pointerId) return;
        this.paintChange.emit({ type: "stop", stopId: drag.stopId, field: "offset", value: drag.startOffset });
        this.stopDrag = undefined;
    }

    handleStopKey(stop: GradientStop, event: KeyboardEvent): void {
        let offset = stop.offset;
        const step = event.shiftKey ? 0.1 : 0.01;
        if(event.key === "ArrowLeft" || event.key === "ArrowDown") offset -= step;
        else if(event.key === "ArrowRight" || event.key === "ArrowUp") offset += step;
        else if(event.key === "Home") offset = 0;
        else if(event.key === "End") offset = 1;
        else if((event.key === "Delete" || event.key === "Backspace") && this.capabilities.stopStructure) {
            this.selectedStopId = stop.id;
            this.removeSelectedStop();
            event.preventDefault();
            return;
        } else return;
        event.preventDefault();
        this.selectedStopId = stop.id;
        this.paintChange.emit({ type: "stop", stopId: stop.id, field: "offset", value: clamp01(offset) });
    }

    gradientPreview(gradient: GradientPaint): string {
        const stops = [...gradient.stops]
            .sort((a, b) => a.offset - b.offset)
            .map((stop) => `${this.stopColor(stop)} ${clamp01(stop.offset) * 100}%`)
            .join(", ");
        return gradient.type === "radial-gradient"
            ? `radial-gradient(circle, ${stops})`
            : `linear-gradient(90deg, ${stops})`;
    }

    stopLabel(stop: GradientStop, index: number): string {
        return `Stop ${index + 1}, ${Math.round(clamp01(stop.offset) * 100)}%`;
    }

    stopColor(stop: GradientStop): string {
        return `${stop.color.hex}${Math.round(this.stopOpacity(stop) * 255).toString(16).padStart(2, "0")}`;
    }

    stopOpacity(stop: GradientStop): number { return gradientStopOpacity(stop); }
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function paintEditorId(): string { return `stop-${Math.random().toString(36).slice(2, 10)}`; }
