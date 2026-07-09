import { Color, ColorSpace, HSL, RGB } from "./color.object";

export type AnimationValueType = "number" | "color" | "boolean" | "string";
export type EasingType = "linear" | "hold" | "ease-in" | "ease-out" | "ease-in-out";

export interface AnimationDocument {
    version: 1;
    duration: number;
    fpsHint?: number;
    loop?: boolean;
    tracks: AnimationTrack[];
    markers: TimelineMarker[];
    variables?: RuntimeVariable[];
}

export interface AnimationTrack {
    id: string;
    targetId: string;
    property: string;
    valueType: AnimationValueType;
    keyframes: Keyframe[];
    enabled?: boolean;
}

export interface Keyframe {
    id: string;
    time: number;
    value: unknown;
    easing?: EasingSpec;
}

export interface EasingSpec {
    type: EasingType;
}

export interface TimelineMarker {
    id: string;
    name: string;
    time: number;
}

export interface RuntimeVariable {
    name: string;
    value: boolean | number | string;
}

export interface AnimationColorValue {
    type: "color";
    space: ColorSpace;
    hex: string;
    rgb: RGB;
    hsl: HSL;
}

export interface AnimatablePropertyDefinition {
    property: string;
    label: string;
    valueType: AnimationValueType;
    group: "transform" | "style" | "visibility";
    mvp: boolean;
}

export type AnimationSave = AnimationDocument;

export const ANIMATABLE_PROPERTIES: readonly AnimatablePropertyDefinition[] = [
    { property: "transform.translateX", label: "Offset X", valueType: "number", group: "transform", mvp: true },
    { property: "transform.translateY", label: "Offset Y", valueType: "number", group: "transform", mvp: true },
    { property: "transform.scaleX", label: "Scale X", valueType: "number", group: "transform", mvp: true },
    { property: "transform.scaleY", label: "Scale Y", valueType: "number", group: "transform", mvp: true },
    { property: "transform.rotation", label: "Rotation", valueType: "number", group: "transform", mvp: true },
    { property: "transform.originX", label: "Origin X", valueType: "number", group: "transform", mvp: true },
    { property: "transform.originY", label: "Origin Y", valueType: "number", group: "transform", mvp: true },
    { property: "opacity", label: "Opacity", valueType: "number", group: "style", mvp: true },
    { property: "settings.fill", label: "Fill", valueType: "color", group: "style", mvp: true },
    { property: "settings.stroke", label: "Stroke", valueType: "color", group: "style", mvp: true },
    { property: "settings.stroke_width", label: "Stroke Width", valueType: "number", group: "style", mvp: true },
    { property: "visible", label: "Visibility", valueType: "boolean", group: "visibility", mvp: true },
];

export function createDefaultAnimation(): AnimationDocument {
    return {
        version: 1,
        duration: 3,
        fpsHint: 60,
        loop: false,
        tracks: [],
        markers: [],
        variables: [],
    };
}

export function restoreAnimation(save?: Partial<AnimationSave> | null): AnimationDocument {
    if(!save || save.version !== 1) {
        return createDefaultAnimation();
    }

    return {
        version: 1,
        duration: positiveNumber(save.duration, 3),
        fpsHint: positiveNumber(save.fpsHint, 60),
        loop: save.loop ?? false,
        tracks: Array.isArray(save.tracks) ? save.tracks.map(restoreTrack).filter((track): track is AnimationTrack => !!track) : [],
        markers: Array.isArray(save.markers) ? save.markers.map(restoreMarker).filter((marker): marker is TimelineMarker => !!marker) : [],
        variables: Array.isArray(save.variables) ? save.variables.map(restoreVariable).filter((variable): variable is RuntimeVariable => !!variable) : [],
    };
}

export function cloneAnimation(animation: AnimationDocument): AnimationDocument {
    return restoreAnimation(JSON.parse(JSON.stringify(animation)));
}

export function makeAnimationId(prefix = "anim"): string {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function animatableProperty(property: string): AnimatablePropertyDefinition | undefined {
    return ANIMATABLE_PROPERTIES.find((definition) => definition.property === property);
}

export function createAnimationColorValue(value: unknown, fallbackSpace: ColorSpace = "rgb"): AnimationColorValue | string | null | undefined {
    const color = parseAnimationColor(value);
    if(!color) {
        return value == null ? value as null | undefined : String(value);
    }

    return {
        ...color,
        space: color.space ?? fallbackSpace,
    };
}

export function colorValueSpace(value: unknown): ColorSpace {
    const color = parseAnimationColor(value);
    return color?.space ?? "rgb";
}

export function evaluateTrack(track: AnimationTrack, time: number): unknown {
    if(track.enabled === false || track.keyframes.length === 0) {
        return undefined;
    }

    const keyframes = [...track.keyframes].sort((a, b) => a.time - b.time);
    const first = keyframes[0];
    const last = keyframes[keyframes.length - 1];

    if(time <= first.time) {
        return first.value;
    }

    if(time >= last.time) {
        return last.value;
    }

    for(let i = 0; i < keyframes.length - 1; i++) {
        const from = keyframes[i];
        const to = keyframes[i + 1];
        if(time >= from.time && time <= to.time) {
            return interpolateKeyframes(track.valueType, from, to, time);
        }
    }

    return last.value;
}

export function interpolateKeyframes(type: AnimationValueType, from: Keyframe, to: Keyframe, time: number): unknown {
    if(from.easing?.type === "hold" || type === "boolean" || type === "string") {
        return from.value;
    }

    const span = to.time - from.time;
    const rawT = span <= 0 ? 1 : clamp01((time - from.time) / span);
    const t = applyEasing(rawT, from.easing);

    if(type === "number") {
        return interpolateNumber(Number(from.value), Number(to.value), t);
    }

    if(type === "color") {
        return interpolateColor(from.value, to.value, t);
    }

    return t < 1 ? from.value : to.value;
}

export function applyEasing(t: number, easing?: EasingSpec): number {
    switch(easing?.type ?? "linear") {
        case "hold":
            return 0;
        case "ease-in":
            return t * t;
        case "ease-out":
            return 1 - Math.pow(1 - t, 2);
        case "ease-in-out":
            return t < 0.5
                ? 2 * t * t
                : 1 - Math.pow(-2 * t + 2, 2) / 2;
        case "linear":
        default:
            return t;
    }
}

function restoreTrack(track: Partial<AnimationTrack>): AnimationTrack | undefined {
    if(!track || typeof track.targetId !== "string" || typeof track.property !== "string") {
        return undefined;
    }

    const valueType = restoreValueType(track.valueType);
    if(!valueType) {
        return undefined;
    }

    return {
        id: typeof track.id === "string" ? track.id : makeAnimationId("track"),
        targetId: track.targetId,
        property: track.property,
        valueType,
        keyframes: Array.isArray(track.keyframes) ? track.keyframes.map(restoreKeyframe).filter((keyframe): keyframe is Keyframe => !!keyframe) : [],
        enabled: track.enabled ?? true,
    };
}

function restoreKeyframe(keyframe: Partial<Keyframe>): Keyframe | undefined {
    if(!keyframe || !Number.isFinite(keyframe.time)) {
        return undefined;
    }

    return {
        id: typeof keyframe.id === "string" ? keyframe.id : makeAnimationId("key"),
        time: Math.max(0, Number(keyframe.time)),
        value: keyframe.value,
        easing: restoreEasing(keyframe.easing),
    };
}

function restoreMarker(marker: Partial<TimelineMarker>): TimelineMarker | undefined {
    if(!marker || typeof marker.name !== "string" || !Number.isFinite(marker.time)) {
        return undefined;
    }

    return {
        id: typeof marker.id === "string" ? marker.id : makeAnimationId("marker"),
        name: marker.name,
        time: Math.max(0, Number(marker.time)),
    };
}

function restoreVariable(variable: Partial<RuntimeVariable>): RuntimeVariable | undefined {
    if(!variable || typeof variable.name !== "string") {
        return undefined;
    }

    if(typeof variable.value !== "boolean" && typeof variable.value !== "number" && typeof variable.value !== "string") {
        return undefined;
    }

    return {
        name: variable.name,
        value: variable.value,
    };
}

function restoreEasing(easing?: Partial<EasingSpec>): EasingSpec | undefined {
    if(!easing) {
        return undefined;
    }

    return restoreEasingType(easing.type) ? { type: easing.type } : undefined;
}

function restoreValueType(type?: string): AnimationValueType | undefined {
    switch(type) {
        case "number":
        case "color":
        case "boolean":
        case "string":
            return type;
        default:
            return undefined;
    }
}

function restoreEasingType(type?: string): type is EasingType {
    switch(type) {
        case "linear":
        case "hold":
        case "ease-in":
        case "ease-out":
        case "ease-in-out":
            return true;
        default:
            return false;
    }
}

function positiveNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function interpolateNumber(from: number, to: number, t: number): number {
    if(!Number.isFinite(from) || !Number.isFinite(to)) {
        return t < 1 ? from : to;
    }

    return from + ((to - from) * t);
}

function interpolateColor(from: unknown, to: unknown, t: number): string {
    const fromColor = parseAnimationColor(from);
    const toColor = parseAnimationColor(to);
    if(!fromColor || !toColor) {
        return String(t < 1 ? from : to);
    }

    const space = toColor.space ?? fromColor.space ?? "rgb";
    if(space === "hsl") {
        const hueDelta = shortestHueDelta(fromColor.hsl.h, toColor.hsl.h);
        const color = new Color();
        color.hsl = {
            h: normalizeHue(fromColor.hsl.h + hueDelta * t),
            s: interpolateNumber(fromColor.hsl.s, toColor.hsl.s, t),
            l: interpolateNumber(fromColor.hsl.l, toColor.hsl.l, t),
        };
        return color.hex;
    }

    return rgbToHex({
        r: Math.round(interpolateNumber(fromColor.rgb.r, toColor.rgb.r, t)),
        g: Math.round(interpolateNumber(fromColor.rgb.g, toColor.rgb.g, t)),
        b: Math.round(interpolateNumber(fromColor.rgb.b, toColor.rgb.b, t)),
    });
}

function parseAnimationColor(value: unknown): (AnimationColorValue & { space?: ColorSpace }) | undefined {
    if(value instanceof Color) {
        return {
            type: "color",
            space: value.preferredSpace,
            hex: value.hex,
            rgb: value.rgb,
            hsl: value.hsl,
        };
    }

    if(isAnimationColorValue(value)) {
        return value;
    }

    if(typeof value === "string") {
        const rgb = parseHexColor(value);
        if(rgb) {
            const color = new Color(value);
            return {
                type: "color",
                space: "rgb",
                hex: color.hex,
                rgb: color.rgb,
                hsl: color.hsl,
            };
        }
    }

    return undefined;
}

function isAnimationColorValue(value: unknown): value is AnimationColorValue {
    if(!value || typeof value !== "object") {
        return false;
    }

    const candidate = value as Partial<AnimationColorValue>;
    return candidate.type === "color"
        && (candidate.space === "rgb" || candidate.space === "hsl")
        && typeof candidate.hex === "string"
        && !!candidate.rgb
        && !!candidate.hsl;
}

function parseHexColor(value: string): RGB | undefined {
    const shorthand = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
    if(shorthand) {
        return {
            r: parseInt(shorthand[1] + shorthand[1], 16),
            g: parseInt(shorthand[2] + shorthand[2], 16),
            b: parseInt(shorthand[3] + shorthand[3], 16),
        };
    }

    const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
    if(full) {
        return {
            r: parseInt(full[1], 16),
            g: parseInt(full[2], 16),
            b: parseInt(full[3], 16),
        };
    }

    return undefined;
}

function rgbToHex(rgb: RGB): string {
    const component = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
    return `#${component(rgb.r)}${component(rgb.g)}${component(rgb.b)}`;
}

function shortestHueDelta(from: number, to: number): number {
    return ((to - from + 540) % 360) - 180;
}

function normalizeHue(value: number): number {
    return ((value % 360) + 360) % 360;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}
