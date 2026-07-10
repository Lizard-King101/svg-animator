import { AnimatablePropertyDefinition } from "./animation.object";
import { Color } from "./color.object";

export type GradientKind = "linear-gradient" | "radial-gradient";
export type GradientUnits = "objectBoundingBox" | "userSpaceOnUse";
export type GradientSpreadMethod = "pad" | "reflect" | "repeat";
export type GradientCoordinateKey = "x1" | "y1" | "x2" | "y2" | "cx" | "cy" | "r" | "fx" | "fy";

export interface GradientStopSave {
    id: string;
    offset: number;
    color: string;
    opacity: number;
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

export function serializePaint(value: Paint | null | undefined): PaintSave {
    if(value == null) return null;
    if(value instanceof Color) return value.hex;
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
            opacity: clamp01(stop.opacity),
        })),
    };
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
            color: new Color(stop.color),
            opacity: clamp01(stop.opacity),
        })),
    };
}

export function clonePaint(value: Paint | null | undefined, id?: string): Paint | null {
    if(value == null) return null;
    if(value instanceof Color) return new Color(value.hex);
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

export function gradientTransformValue(value: GradientPaint): string | null {
    return value.transform ? `matrix(${value.transform.join(" ")})` : null;
}

export function gradientAnimationProperties(settings: Record<string, unknown>): AnimatablePropertyDefinition[] {
    const properties: AnimatablePropertyDefinition[] = [];
    (["fill", "stroke"] as const).forEach((paintKey) => {
        const paint = settings[paintKey];
        if(!isGradientPaint(paint)) return;
        Object.keys(paint.coordinates).forEach((coordinate) => properties.push({
            property: `settings.${paintKey}.gradient.${coordinate}`,
            label: `${paintKey === "fill" ? "Fill" : "Stroke"} ${coordinate.toUpperCase()}`,
            valueType: "number",
            group: "style",
            mvp: true,
        }));
        paint.stops.forEach((stop, index) => {
            const prefix = `settings.${paintKey}.gradient.stops.${stop.id}`;
            properties.push({ property: `${prefix}.offset`, label: `${paintKey === "fill" ? "Fill" : "Stroke"} Stop ${index + 1} Offset`, valueType: "number", group: "style", mvp: true });
            properties.push({ property: `${prefix}.color`, label: `${paintKey === "fill" ? "Fill" : "Stroke"} Stop ${index + 1} Color`, valueType: "color", group: "style", mvp: true });
            properties.push({ property: `${prefix}.opacity`, label: `${paintKey === "fill" ? "Fill" : "Stroke"} Stop ${index + 1} Opacity`, valueType: "number", group: "style", mvp: true });
        });
    });
    return properties;
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
            && Number.isFinite(stop.offset) && Number.isFinite(stop.opacity));
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
