import { Injectable } from "@angular/core";
import { PaintEditorChange } from "../_components/paint-editor/paint-editor.types";
import { AnimationTrack } from "../editor/objects/animation.object";
import { cloneColor, Color } from "../editor/objects/color.object";
import { convertGradientUnits } from "../editor/objects/gradient-geometry";
import {
    clonePaint,
    createDefaultGradient,
    GradientPaint,
    GradientStop,
    isGradientPaint,
    Paint,
    PaintSettingKey,
} from "../editor/objects/paint.object";
import { AnyElement } from "../editor/objects/svg.object";
import { AnimationPlaybackService } from "./animation-playback.service";
import { DocumentMutationService } from "./document-mutation.service";
import { EditorService } from "./editor.service";
import { GradientPreset, GradientPresetService } from "./gradient-preset.service";

interface CachedPaintVariant {
    paint: Paint | null;
    tracks: AnimationTrack[];
}

interface PaintSession {
    solid?: CachedPaintVariant;
    gradient?: CachedPaintVariant;
}

@Injectable()
export class PaintEditingService {
    private sessions = new Map<string, PaintSession>();

    constructor(
        private editor: EditorService,
        private animation: AnimationPlaybackService,
        private mutations: DocumentMutationService,
        private presets: GradientPresetService,
    ) {}

    apply(element: AnyElement, key: PaintSettingKey, change: PaintEditorChange): boolean {
        if(change.type === "save-preset") {
            this.presets.save(change.gradient);
            return false;
        }
        if(change.type === "delete-preset") {
            this.presets.delete(change.presetId);
            return false;
        }
        if(change.type === "solid-color") return this.setSolidColor(element, key, change.color);
        if(change.type === "stop") return this.setStop(element, key, change);
        if(this.animation.mode === "animate") return false;

        switch(change.type) {
            case "mode":
                return this.switchMode(element, key, change.mode, change.selectedStopId);
            case "kind":
                return this.setKind(element, key, change.kind);
            case "metadata":
                return this.setMetadata(element, key, change.field, change.value);
            case "add-stop":
                return this.addStop(element, key, change.stopId);
            case "remove-stop":
                return this.removeStop(element, key, change.stopId);
            case "apply-preset":
                return this.applyPreset(element, key, change.preset);
        }
    }

    clearSession(documentId?: string): void {
        if(!documentId) {
            this.sessions.clear();
            return;
        }
        const prefix = `${documentId}:`;
        [...this.sessions.keys()].forEach((key) => { if(key.startsWith(prefix)) this.sessions.delete(key); });
    }

    private setSolidColor(element: AnyElement, key: PaintSettingKey, color: Color): boolean {
        if(this.animation.mode === "animate") {
            this.animation.setAnimatedPropertyValue(element, `settings.${key}`, "color", cloneColor(color));
            return true;
        }
        const paint = this.paint(element, key);
        if(isGradientPaint(paint)) return false;
        this.setPaint(element, key, cloneColor(color));
        this.mutations.schedule();
        return true;
    }

    private setStop(element: AnyElement, key: PaintSettingKey, change: Extract<PaintEditorChange, { type: "stop" }>): boolean {
        const gradient = this.gradient(element, key);
        const stop = gradient?.stops.find((candidate) => candidate.id === change.stopId);
        if(!stop) return false;
        if(this.animation.mode === "animate") {
            const animatedField = change.field === "opacity" ? "color" : change.field;
            const property = `settings.${key}.gradient.stops.${stop.id}.${animatedField}`;
            const value = change.field === "opacity" ? colorWithAlpha(stop.color, change.value) : change.value;
            this.animation.setAnimatedPropertyValue(element, property, animatedField === "color" ? "color" : "number", value);
            return true;
        }
        if(change.field === "color") {
            stop.color = cloneColor(change.value);
            stop.opacity = stop.color.alpha;
        } else if(change.field === "opacity") {
            stop.opacity = clamp01(change.value);
            stop.color.alpha = stop.opacity;
        } else {
            stop.offset = clamp01(change.value);
        }
        this.mutations.schedule();
        return true;
    }

    private switchMode(element: AnyElement, key: PaintSettingKey, mode: "solid" | "gradient", selectedStopId?: string): boolean {
        const current = this.paint(element, key);
        if((mode === "gradient") === isGradientPaint(current)) return false;
        this.mutations.mutate(() => {
            const session = this.session(element, key);
            if(isGradientPaint(current)) {
                session.gradient = this.captureVariant(element, key, current);
                this.removeTracks(element, (track) => track.property.startsWith(this.gradientPrefix(key)));
                const restored = session.solid;
                if(restored) {
                    this.setPaint(element, key, clonePaint(restored.paint));
                    this.restoreTracks(element, key, restored);
                } else {
                    const selected = current.stops.find((stop) => stop.id === selectedStopId)
                        ?? [...current.stops].sort((a, b) => a.offset - b.offset)[0];
                    this.setPaint(element, key, selected ? cloneColor(selected.color) : new Color("#000000"));
                }
            } else {
                session.solid = this.captureVariant(element, key, current);
                this.removeTracks(element, (track) => track.property === this.solidProperty(key));
                const restored = session.gradient;
                if(restored?.paint && isGradientPaint(restored.paint)) {
                    this.setPaint(element, key, clonePaint(restored.paint));
                    this.restoreTracks(element, key, restored);
                } else {
                    const gradient = createDefaultGradient(this.editor.ID);
                    gradient.stops[0].color = current instanceof Color ? cloneColor(current) : new Color("#000000");
                    gradient.stops[0].opacity = gradient.stops[0].color.alpha;
                    gradient.stops[1].color = new Color("#ffffff");
                    gradient.stops[1].opacity = 1;
                    this.setPaint(element, key, gradient);
                }
                this.editor.selectedGradientPaintKey = key;
            }
            this.animation.invalidate();
        });
        return true;
    }

    private setKind(element: AnyElement, key: PaintSettingKey, kind: GradientPaint["type"]): boolean {
        const gradient = this.gradient(element, key);
        if(!gradient || gradient.type === kind) return false;
        this.mutations.mutate(() => {
            const replacement = createDefaultGradient(gradient.id, kind);
            replacement.stops = gradient.stops;
            replacement.units = gradient.units;
            replacement.spreadMethod = gradient.spreadMethod;
            replacement.transform = gradient.transform ? [...gradient.transform] : undefined;
            this.setPaint(element, key, replacement);
            this.removeTracks(element, (track) => track.property.startsWith(this.gradientPrefix(key)) && !track.property.includes(".stops."));
            this.animation.invalidate();
        });
        return true;
    }

    private setMetadata(
        element: AnyElement,
        key: PaintSettingKey,
        field: "units" | "spreadMethod",
        value: GradientPaint["units"] | GradientPaint["spreadMethod"],
    ): boolean {
        const gradient = this.gradient(element, key);
        if(!gradient) return false;
        if(field === "units") {
            if(value !== "objectBoundingBox" && value !== "userSpaceOnUse") return false;
            let changed = false;
            this.mutations.mutate(() => changed = convertGradientUnits(element, gradient, value));
            return changed;
        }
        if(value !== "pad" && value !== "reflect" && value !== "repeat") return false;
        if(gradient.spreadMethod === value) return false;
        this.mutations.mutate(() => gradient.spreadMethod = value);
        return true;
    }

    private addStop(element: AnyElement, key: PaintSettingKey, stopId: string): boolean {
        const gradient = this.gradient(element, key);
        if(!gradient || gradient.stops.some((stop) => stop.id === stopId)) return false;
        this.mutations.mutate(() => {
            const sorted = [...gradient.stops].sort((a, b) => a.offset - b.offset);
            const gap = widestGap(sorted);
            gradient.stops.push(interpolatedStop(stopId, gap.left, gap.right));
            gradient.stops.sort((a, b) => a.offset - b.offset);
        });
        return true;
    }

    private removeStop(element: AnyElement, key: PaintSettingKey, stopId: string): boolean {
        const gradient = this.gradient(element, key);
        if(!gradient || gradient.stops.length <= 2 || !gradient.stops.some((stop) => stop.id === stopId)) return false;
        this.mutations.mutate(() => {
            gradient.stops = gradient.stops.filter((stop) => stop.id !== stopId);
            this.removeTracks(element, (track) => track.property.startsWith(`${this.gradientPrefix(key)}stops.${stopId}.`));
            this.animation.invalidate();
        });
        return true;
    }

    private applyPreset(element: AnyElement, key: PaintSettingKey, preset: GradientPreset): boolean {
        const gradient = this.gradient(element, key);
        if(!gradient || preset.stops.length < 2) return false;
        this.mutations.mutate(() => {
            const existing = [...gradient.stops].sort((a, b) => a.offset - b.offset);
            const next = [...preset.stops].sort((a, b) => a.offset - b.offset).map((source, index): GradientStop => {
                const color = new Color(source.color);
                color.alpha = clamp01(source.alpha);
                return {
                    id: existing[index]?.id ?? this.editor.ID,
                    offset: clamp01(source.offset),
                    color,
                    opacity: color.alpha,
                };
            });
            const retainedIds = new Set(next.map((stop) => stop.id));
            const removedIds = existing.filter((stop) => !retainedIds.has(stop.id)).map((stop) => stop.id);
            gradient.stops = next;
            if(removedIds.length) {
                this.removeTracks(element, (track) => removedIds.some((id) => track.property.startsWith(`${this.gradientPrefix(key)}stops.${id}.`)));
                this.animation.invalidate();
            }
        });
        return true;
    }

    private captureVariant(element: AnyElement, key: PaintSettingKey, paint: Paint | null): CachedPaintVariant {
        const gradient = isGradientPaint(paint);
        const tracks = this.editor.selectedSVG?.animation.tracks.filter((track) => track.targetId === element.id
            && (gradient ? track.property.startsWith(this.gradientPrefix(key)) : track.property === this.solidProperty(key))) ?? [];
        return { paint: clonePaint(paint), tracks: tracks.map(cloneTrack) };
    }

    private restoreTracks(element: AnyElement, key: PaintSettingKey, variant: CachedPaintVariant): void {
        const animation = this.editor.selectedSVG?.animation;
        if(!animation) return;
        const gradient = isGradientPaint(variant.paint);
        animation.tracks = animation.tracks.filter((track) => track.targetId !== element.id
            || (gradient ? !track.property.startsWith(this.gradientPrefix(key)) : track.property !== this.solidProperty(key)));
        const restoredIds = new Set(variant.tracks.map((track) => track.id));
        animation.tracks = animation.tracks.filter((track) => !restoredIds.has(track.id));
        animation.tracks.push(...variant.tracks.map(cloneTrack));
    }

    private removeTracks(element: AnyElement, predicate: (track: AnimationTrack) => boolean): void {
        const animation = this.editor.selectedSVG?.animation;
        if(animation) animation.tracks = animation.tracks.filter((track) => track.targetId !== element.id || !predicate(track));
    }

    private session(element: AnyElement, key: PaintSettingKey): PaintSession {
        const cacheKey = `${this.editor.selectedSVG?.id ?? "none"}:${element.id}:${key}`;
        let session = this.sessions.get(cacheKey);
        if(!session) {
            session = {};
            this.sessions.set(cacheKey, session);
        }
        return session;
    }

    private paint(element: AnyElement, key: PaintSettingKey): Paint | null {
        return ((element.settings as Record<string, unknown>)[key] as Paint | null) ?? null;
    }
    private gradient(element: AnyElement, key: PaintSettingKey): GradientPaint | undefined {
        const value = this.paint(element, key);
        return isGradientPaint(value) ? value : undefined;
    }
    private setPaint(element: AnyElement, key: PaintSettingKey, paint: Paint | null): void {
        (element.settings as Record<string, unknown>)[key] = paint;
    }
    private solidProperty(key: PaintSettingKey): string { return `settings.${key}`; }
    private gradientPrefix(key: PaintSettingKey): string { return `settings.${key}.gradient.`; }
}

function colorWithAlpha(color: Color, alpha: number): Color {
    const clone = cloneColor(color);
    clone.alpha = clamp01(alpha);
    return clone;
}
function cloneTrack(track: AnimationTrack): AnimationTrack { return JSON.parse(JSON.stringify(track)) as AnimationTrack; }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function widestGap(stops: GradientStop[]): { left: GradientStop; right: GradientStop } {
    if(stops.length === 0) {
        const black = new Color("#000000");
        const white = new Color("#ffffff");
        return {
            left: { id: "left", offset: 0, color: black, opacity: 1 },
            right: { id: "right", offset: 1, color: white, opacity: 1 },
        };
    }
    if(stops.length === 1) return { left: stops[0], right: { ...stops[0], offset: 1 } };
    let result = { left: stops[0], right: stops[1] };
    for(let index = 1; index < stops.length - 1; index += 1) {
        const candidate = { left: stops[index], right: stops[index + 1] };
        if(candidate.right.offset - candidate.left.offset > result.right.offset - result.left.offset) result = candidate;
    }
    return result;
}
function interpolatedStop(id: string, left: GradientStop, right: GradientStop): GradientStop {
    const color = new Color();
    color.rgb = {
        r: Math.round((left.color.rgb.r + right.color.rgb.r) / 2),
        g: Math.round((left.color.rgb.g + right.color.rgb.g) / 2),
        b: Math.round((left.color.rgb.b + right.color.rgb.b) / 2),
    };
    color.alpha = (left.color.alpha + right.color.alpha) / 2;
    return { id, offset: (left.offset + right.offset) / 2, color, opacity: color.alpha };
}
