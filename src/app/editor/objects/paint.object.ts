import { AnimatablePropertyDefinition } from "./animation.object";
import { cloneColor, Color } from "./color.object";

export type GradientKind = "linear-gradient" | "radial-gradient";
export type GradientUnits = "objectBoundingBox" | "userSpaceOnUse";
export type GradientSpreadMethod = "pad" | "reflect" | "repeat";
export type GradientCoordinateKey = "x1" | "y1" | "x2" | "y2" | "cx" | "cy" | "r" | "fx" | "fy";
export type PaintSettingKey = "fill" | "stroke" | "color";

export const PAINT_SETTING_KEYS: readonly PaintSettingKey[] = ["fill", "stroke", "color"];

export interface GradientStopSave {
    id: string;
    offset: number;
    color: string;
    opacity?: number;
}

export interface GradientStop {
    id: string;
    offset: number;
    color: Color;
    opacity: number;
}

export interface GradientPaintSave {
    type: GradientKind;
    id: string;
    units: GradientUnits;
    spreadMethod: GradientSpreadMethod;
    transform?: [number, number, number, number, number, number];
    coordinates: Partial<Record<GradientCoordinateKey, number>>;
    stops: GradientStopSave[];
}

export interface GradientPaint extends Omit<GradientPaintSave, "stops"> {
    stops: GradientStop[];
}

export type PaintSave = string | GradientPaintSave | null;
export type Paint = Color | GradientPaint;

export function isGradientPaint(value: unknown): value is GradientPaint {
    return !!value && typeof value === "object"
        && ((value as Partial<GradientPaint>).type === "linear-gradient" || (value as Partial<GradientPaint>).type === "radial-gradient")
        && typeof (value as Partial<GradientPaint>).id === "string"
        && Array.isArray((value as Partial<GradientPaint>).stops);
}

export function gradientPaints(settings: Record<string, unknown>): GradientPaint[] {
    return PAINT_SETTING_KEYS
        .map((key) => settings[key])
        .filter(isGradientPaint);
}

export function serializePaint(value: Paint | null | undefined): PaintSave {
    if(value == null) return null;
    if(value instanceof Color) return value.serialized;
    return {
        type: value.type,
        id: value.id,
        units: value.units,
        spreadMethod: value.spreadMethod,
        transform: value.transform ? [...value.transform] as GradientPaintSave["transform"] : undefined,
        coordinates: { ...value.coordinates },
        stops: value.stops.map((stop) => ({
            id: stop.id,
            offset: clamp01(stop.offset),
            color: stop.color.hex,
            opacity: gradientStopOpacity(stop),
        })),
    };
}

/**
 * Older in-memory gradients can outlive a hot reload without the optional
 * persisted opacity field having gone through restorePaint(). Keep renderers
 * and editors tolerant of that session-only shape.
 */
export function gradientStopOpacity(stop: Pick<GradientStop, "color"> & { opacity?: number }): number {
    if(Number.isFinite(stop.opacity)) return clamp01(stop.opacity!);
    return Number.isFinite(stop.color?.alpha) ? clamp01(stop.color.alpha) : 1;
}

export function restorePaint(value: PaintSave | undefined): Paint | null {
    if(value == null) return null;
    if(typeof value === "string") return new Color(value);
    if(!isGradientPaintSave(value)) return null;
    return {
        type: value.type,
        id: value.id,
        units: value.units,
        spreadMethod: value.spreadMethod,
        transform: value.transform ? [...value.transform] : undefined,
        coordinates: { ...value.coordinates },
        stops: value.stops.map((stop) => ({
            id: stop.id,
            offset: clamp01(stop.offset),
            color: colorWithFallbackAlpha(stop.color, stop.opacity),
            opacity: clamp01(stop.opacity ?? new Color(stop.color).alpha),
        })),
    };
}

export function clonePaint(value: Paint | null | undefined, id?: string): Paint | null {
    if(value == null) return null;
    if(value instanceof Color) return cloneColor(value);
    const restored = restorePaint(serializePaint(value));
    if(restored && isGradientPaint(restored) && id) {
        restored.id = id;
        restored.stops.forEach((stop, index) => stop.id = `${id}-stop-${index + 1}`);
    }
    return restored;
}

export function createDefaultGradient(id: string, kind: GradientKind = "linear-gradient"): GradientPaint {
    return {
        type: kind,
        id,
        units: "objectBoundingBox",
        spreadMethod: "pad",
        coordinates: kind === "linear-gradient"
            ? { x1: 0, y1: 0, x2: 1, y2: 0 }
            : { cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.5 },
        stops: [
            { id: `${id}-stop-1`, offset: 0, color: new Color("#000000"), opacity: 1 },
            { id: `${id}-stop-2`, offset: 1, color: new Color("#ffffff"), opacity: 1 },
        ],
    };
}

export function paintSVGValue(value: Paint | null | undefined): string | null {
    if(value == null) return null;
    return value instanceof Color ? value.hex : `url(#${value.id})`;
}

export function paintOpacity(value: Paint | null | undefined): number | null {
    return value instanceof Color && value.alpha < 0.9999 ? value.alpha : null;
}

export function gradientTransformValue(value: GradientPaint): string | null {
    return value.transform ? `matrix(${value.transform.join(" ")})` : null;
}

export function gradientAnimationProperties(settings: Record<string, unknown>): AnimatablePropertyDefinition[] {
    const properties: AnimatablePropertyDefinition[] = [];
    PAINT_SETTING_KEYS.forEach((paintKey) => {
        const paint = settings[paintKey];
        if(!isGradientPaint(paint)) return;
        const label = paintSettingLabel(paintKey);
        Object.keys(paint.coordinates).forEach((coordinate) => properties.push({
            property: `settings.${paintKey}.gradient.${coordinate}`,
            label: `${label} ${coordinate.toUpperCase()}`,
            valueType: "number",
            group: "style",
            mvp: true,
        }));
        paint.stops.forEach((stop, index) => {
            const prefix = `settings.${paintKey}.gradient.stops.${stop.id}`;
            properties.push({ property: `${prefix}.offset`, label: `${label} Stop ${index + 1} Offset`, valueType: "number", group: "style", mvp: true });
            properties.push({ property: `${prefix}.color`, label: `${label} Stop ${index + 1} Color`, valueType: "color", group: "style", mvp: true });
        });
    });
    return properties;
}

export function gradientTimelineProperties(settings: Record<string, unknown>): AnimatablePropertyDefinition[] {
    const properties: AnimatablePropertyDefinition[] = [];
    PAINT_SETTING_KEYS.forEach((paintKey) => {
        if(!isGradientPaint(settings[paintKey])) return;
        const label = paintSettingLabel(paintKey);
        properties.push({ property: `settings.${paintKey}.gradient.geometry`, label: `${label} Gradient Geometry`, valueType: "string", group: "style", mvp: true });
        properties.push({ property: `settings.${paintKey}.gradient.stops`, label: `${label} Gradient Stops`, valueType: "string", group: "style", mvp: true });
    });
    return properties;
}

function paintSettingLabel(key: PaintSettingKey): string {
    return key === "color" ? "Text Color" : key === "fill" ? "Fill" : "Stroke";
}

function isGradientPaintSave(value: unknown): value is GradientPaintSave {
    if(!value || typeof value !== "object") return false;
    const candidate = value as Partial<GradientPaintSave>;
    return (candidate.type === "linear-gradient" || candidate.type === "radial-gradient")
        && typeof candidate.id === "string"
        && (candidate.units === "objectBoundingBox" || candidate.units === "userSpaceOnUse")
        && (candidate.spreadMethod === "pad" || candidate.spreadMethod === "reflect" || candidate.spreadMethod === "repeat")
        && !!candidate.coordinates && typeof candidate.coordinates === "object"
        && Array.isArray(candidate.stops)
        && candidate.stops.every((stop) => !!stop && typeof stop.id === "string" && typeof stop.color === "string"
            && Number.isFinite(stop.offset) && (stop.opacity == null || Number.isFinite(stop.opacity)));
}

function colorWithFallbackAlpha(value: string, opacity?: number): Color {
    const color = new Color(value);
    if(opacity != null) color.alpha = clamp01(color.alpha * opacity);
    return color;
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
