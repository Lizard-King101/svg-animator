import { Component, ElementRef, HostBinding } from "@angular/core";
import { EditorPreferencesService } from "../../_services/editor-preferences.service";
import { LayersPanelComponent } from "../layers-panel/layers-panel.component";
import { PropertiesPanelComponent } from "../properties-panel/properties-panel.component";

const DEFAULT_PANEL_WIDTH = 272;
const DEFAULT_PROPERTIES_RATIO = 0.5;
const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 640;
const MIN_REGION_PX = 120;
const MIN_EDITOR_REMAINDER = 288;

@Component({
    selector: "app-editor-side-panel",
    standalone: true,
    imports: [PropertiesPanelComponent, LayersPanelComponent],
    templateUrl: "editor-side-panel.component.html",
    styleUrls: ["editor-side-panel.component.scss"],
})
export class EditorSidePanelComponent {
    width: number;
    propertiesRatio: number;
    private drag?: PanelDrag;

    @HostBinding("style.flex-basis.px") get panelWidth(): number { return this.width; }
    @HostBinding("class.resizing") get resizing(): boolean { return !!this.drag; }

    constructor(private host: ElementRef<HTMLElement>, private preferences: EditorPreferencesService) {
        this.width = clampPanelWidth(preferences.sidePanelWidth);
        this.propertiesRatio = clampPanelRatio(preferences.propertiesPanelRatio);
    }

    get propertiesBasis(): string { return `${this.propertiesRatio * 100}%`; }

    beginWidthResize(event: PointerEvent): void {
        if(event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.drag = {
            kind: "width", pointerId: event.pointerId, startX: event.clientX, startValue: this.width,
            capture: event.currentTarget as HTMLElement,
        };
        this.drag.capture.focus({ preventScroll: true });
        this.capture(event);
    }

    beginSplitResize(event: PointerEvent): void {
        if(event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.drag = {
            kind: "split", pointerId: event.pointerId, startY: event.clientY, startValue: this.propertiesRatio,
            capture: event.currentTarget as HTMLElement,
        };
        this.drag.capture.focus({ preventScroll: true });
        this.capture(event);
    }

    updateResize(event: PointerEvent): void {
        const drag = this.drag;
        if(!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        if(drag.kind === "width") {
            this.width = this.availablePanelWidth(drag.startValue + drag.startX - event.clientX);
        } else {
            const height = Math.max(1, this.host.nativeElement.clientHeight);
            this.propertiesRatio = clampPanelRatio(drag.startValue + (event.clientY - drag.startY) / height, height);
        }
    }

    endResize(event: PointerEvent): void {
        const drag = this.drag;
        if(!drag || drag.pointerId !== event.pointerId) return;
        this.drag = undefined;
        this.release(event);
        if(drag.kind === "width" && this.width !== drag.startValue) this.preferences.setSidePanelWidth(this.width);
        else if(drag.kind === "split" && this.propertiesRatio !== drag.startValue) this.preferences.setPropertiesPanelRatio(this.propertiesRatio);
    }

    cancelResize(event: PointerEvent): void {
        const drag = this.drag;
        if(!drag || drag.pointerId !== event.pointerId) return;
        if(drag.kind === "width") this.width = drag.startValue;
        else this.propertiesRatio = drag.startValue;
        try { drag.capture.releasePointerCapture(drag.pointerId); } catch {}
        this.drag = undefined;
        this.release(event);
    }

    handleWidthKey(event: KeyboardEvent): void {
        if(event.key === "Escape" && this.drag) {
            this.cancelKeyboardResize(event);
            return;
        }
        const direction = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
        if(!direction) return;
        event.preventDefault();
        this.width = this.availablePanelWidth(this.width + direction * (event.shiftKey ? 40 : 12));
        this.preferences.setSidePanelWidth(this.width);
    }

    handleSplitKey(event: KeyboardEvent): void {
        if(event.key === "Escape" && this.drag) {
            this.cancelKeyboardResize(event);
            return;
        }
        const direction = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        if(!direction) return;
        event.preventDefault();
        this.propertiesRatio = clampPanelRatio(this.propertiesRatio + direction * (event.shiftKey ? 0.1 : 0.04), this.host.nativeElement.clientHeight);
        this.preferences.setPropertiesPanelRatio(this.propertiesRatio);
    }

    resetWidth(event: MouseEvent): void {
        event.preventDefault();
        this.width = this.availablePanelWidth(DEFAULT_PANEL_WIDTH);
        this.preferences.setSidePanelWidth(this.width);
    }

    resetSplit(event: MouseEvent): void {
        event.preventDefault();
        this.propertiesRatio = DEFAULT_PROPERTIES_RATIO;
        this.preferences.setPropertiesPanelRatio(this.propertiesRatio);
    }

    private availablePanelWidth(width: number): number {
        const editorWidth = this.host.nativeElement.parentElement?.clientWidth ?? MAX_PANEL_WIDTH + MIN_PANEL_WIDTH;
        return clampPanelWidth(width, Math.max(MIN_PANEL_WIDTH, editorWidth - MIN_EDITOR_REMAINDER));
    }

    private cancelKeyboardResize(event: KeyboardEvent): void {
        event.preventDefault();
        const drag = this.drag!;
        if(drag.kind === "width") this.width = drag.startValue;
        else this.propertiesRatio = drag.startValue;
        try { drag.capture.releasePointerCapture(drag.pointerId); } catch {}
        this.drag = undefined;
    }

    private capture(event: PointerEvent): void {
        try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch {}
    }

    private release(event: PointerEvent): void {
        try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId); } catch {}
    }
}

export function clampPanelWidth(width: number, maximum = MAX_PANEL_WIDTH): number {
    return Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, maximum, width)));
}

export function clampPanelRatio(ratio: number, panelHeight = Number.POSITIVE_INFINITY): number {
    const pixelMinimum = Number.isFinite(panelHeight) ? Math.min(0.45, MIN_REGION_PX / Math.max(1, panelHeight)) : 0.2;
    return Math.max(pixelMinimum, Math.min(1 - pixelMinimum, ratio));
}

type PanelDrag =
    | { kind: "width"; pointerId: number; startX: number; startValue: number; capture: HTMLElement }
    | { kind: "split"; pointerId: number; startY: number; startValue: number; capture: HTMLElement };
