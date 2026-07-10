import { Injectable } from '@angular/core';

export type PersistedEditorMode = 'edit' | 'animate';

interface EditorPreferences {
    version: 1;
    tool: string;
    zoom: number;
    canvasPosition?: CanvasPosition;
    mode: PersistedEditorMode;
    timelineHeight: number;
}

export interface CanvasPosition {
    x: number;
    y: number;
}

const STORAGE_KEY = 'svg-animator.editor-preferences.v1';
const DEFAULT_PREFERENCES: EditorPreferences = {
    version: 1,
    tool: 'select',
    zoom: 1,
    mode: 'edit',
    timelineHeight: 310,
};

@Injectable({ providedIn: 'root' })
export class EditorPreferencesService {
    private preferences = this.load();

    get tool(): string {
        return this.preferences.tool;
    }

    get zoom(): number {
        return this.preferences.zoom;
    }

    get canvasPosition(): CanvasPosition | undefined {
        return this.preferences.canvasPosition
            ? { ...this.preferences.canvasPosition }
            : undefined;
    }

    get mode(): PersistedEditorMode {
        return this.preferences.mode;
    }

    get timelineHeight(): number {
        return this.preferences.timelineHeight;
    }

    setTool(tool: string) {
        if(tool && this.preferences.tool !== tool) {
            this.update({ tool });
        }
    }

    setCanvasView(zoom: number, position: CanvasPosition) {
        if(Number.isFinite(zoom) && this.validPosition(position)) {
            this.update({
                zoom: Math.max(0.05, zoom),
                canvasPosition: { x: position.x, y: position.y },
            });
        }
    }

    setMode(mode: PersistedEditorMode) {
        if(mode === 'edit' || mode === 'animate') {
            this.update({ mode });
        }
    }

    setTimelineHeight(height: number) {
        if(Number.isFinite(height)) {
            this.update({ timelineHeight: Math.max(190, Math.min(720, Math.round(height))) });
        }
    }

    private validPosition(position: CanvasPosition): boolean {
        return Number.isFinite(position.x) && Number.isFinite(position.y);
    }

    private update(values: Partial<Omit<EditorPreferences, 'version'>>) {
        this.preferences = { ...this.preferences, ...values };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
        } catch {
            // Preferences are optional when storage is unavailable or full.
        }
    }

    private load(): EditorPreferences {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if(!raw) {
                return { ...DEFAULT_PREFERENCES };
            }

            const saved = JSON.parse(raw) as Partial<EditorPreferences>;
            const canvasPosition = saved.canvasPosition && this.validPosition(saved.canvasPosition)
                ? { x: saved.canvasPosition.x, y: saved.canvasPosition.y }
                : undefined;
            return {
                version: 1,
                tool: typeof saved.tool === 'string' && saved.tool ? saved.tool : DEFAULT_PREFERENCES.tool,
                zoom: typeof saved.zoom === 'number' && Number.isFinite(saved.zoom)
                    ? Math.max(0.05, saved.zoom)
                    : DEFAULT_PREFERENCES.zoom,
                canvasPosition,
                mode: saved.mode === 'animate' ? 'animate' : 'edit',
                timelineHeight: typeof saved.timelineHeight === 'number' && Number.isFinite(saved.timelineHeight)
                    ? Math.max(190, Math.min(720, Math.round(saved.timelineHeight)))
                    : DEFAULT_PREFERENCES.timelineHeight,
            };
        } catch {
            return { ...DEFAULT_PREFERENCES };
        }
    }
}
