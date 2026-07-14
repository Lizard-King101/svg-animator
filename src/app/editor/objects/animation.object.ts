import { Color, ColorSpace, HSL, RGB } from "./color.object";

export type AnimationValueType = "number" | "color" | "boolean" | "string";
export type EasingType = "linear" | "hold" | "ease-in" | "ease-out" | "ease-in-out";

export interface AnimationDocument {
    version: 2;
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
    temporal?: TemporalTangents;
}

export interface TemporalHandle {
    /** Property units per second. Signed values and overshoot are intentional. */
    speed: number;
    /** Fraction of the adjacent segment duration, clamped to 0–1. */
    influence: number;
}

export interface TemporalTangents {
    in?: TemporalHandle;
    out?: TemporalHandle;
    /** Linking shares speed only; each side keeps its own influence. */
    linked: boolean;
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
    alpha?: number;
}

export interface AnimatablePropertyDefinition {
    property: string;
    label: string;
    valueType: AnimationValueType;
    group: "transform" | "style" | "visibility" | "path";
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
    { property: "settings.color", label: "Text Color", valueType: "color", group: "style", mvp: true },
    { property: "settings.stroke_width", label: "Stroke Width", valueType: "number", group: "style", mvp: true },
    { property: "path.drawProgress", label: "Draw Progress", valueType: "number", group: "path", mvp: true },
    { property: "motion.progress", label: "Motion Progress", valueType: "number", group: "path", mvp: true },
    { property: "motion.rotateToPath", label: "Rotate To Path", valueType: "boolean", group: "path", mvp: true },
    { property: "motion.offsetAngle", label: "Offset Angle", valueType: "number", group: "path", mvp: true },
    { property: "motion.offsetX", label: "Motion Offset X", valueType: "number", group: "path", mvp: true },
    { property: "motion.offsetY", label: "Motion Offset Y", valueType: "number", group: "path", mvp: true },
    { property: "visible", label: "Visibility", valueType: "boolean", group: "visibility", mvp: true },
];

export function createDefaultAnimation(): AnimationDocument {
    return {
        version: 2,
        duration: 3,
        fpsHint: 60,
        loop: false,
        tracks: [],
        markers: [],
        variables: [],
    };
}

export function restoreAnimation(save?: (Omit<Partial<AnimationSave>, "version"> & { version?: number }) | null): AnimationDocument {
    if(!save || (save.version !== 1 && save.version !== 2)) {
        return createDefaultAnimation();
    }

    return {
        version: 2,
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

    const keyframes = normalizedKeyframes(track.keyframes);
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
    if(type === "number" && (from.temporal?.out || to.temporal?.in)) {
        return evaluateTemporalNumberSegment(from, to, time);
    }
    const t = applyEasing(rawT, from.easing);

    if(type === "number") {
        return interpolateNumber(Number(from.value), Number(to.value), t);
    }

    if(type === "color") {
        return interpolateAnimationColor(from.value, to.value, t);
    }

    return t < 1 ? from.value : to.value;
}

/**
 * Evaluates the AE-style time/value cubic defined by the adjacent velocity
 * handles. Time remains monotonic because influence is limited to the segment.
 */
export function evaluateTemporalNumberSegment(from: Keyframe, to: Keyframe, time: number): number {
    const duration = to.time - from.time;
    const fromValue = Number(from.value);
    const toValue = Number(to.value);
    if(duration <= 0 || !Number.isFinite(fromValue) || !Number.isFinite(toValue)) {
        return time < to.time ? fromValue : toValue;
    }

    const coefficients = temporalSegmentCoefficients(from, to);
    const targetTime = Math.max(from.time, Math.min(to.time, time));
    const u = solveTemporalTime(coefficients, targetTime);
    return cubicValue(coefficients.valueA, coefficients.valueB, coefficients.valueC, coefficients.valueD, u);
}

/** Returns instantaneous property-units-per-second for graph rendering. */
export function evaluateTemporalSpeed(from: Keyframe, to: Keyframe, time: number): number {
    const coefficients = temporalSegmentCoefficients(from, to);
    const u = solveTemporalTime(coefficients, Math.max(from.time, Math.min(to.time, time)));
    const dx = cubicDerivative(coefficients.timeA, coefficients.timeB, coefficients.timeC, u);
    const dy = cubicDerivative(coefficients.valueA, coefficients.valueB, coefficients.valueC, u);
    return Math.abs(dx) < 1e-9 ? 0 : dy / dx;
}

export interface TemporalSegmentCoefficients {
    timeA: number;
    timeB: number;
    timeC: number;
    timeD: number;
    valueA: number;
    valueB: number;
    valueC: number;
    valueD: number;
}

export function temporalSegmentCoefficients(from: Keyframe, to: Keyframe): TemporalSegmentCoefficients {
    const duration = Math.max(0, to.time - from.time);
    const fromValue = Number(from.value);
    const toValue = Number(to.value);
    const defaultSpeed = duration > 0 ? (toValue - fromValue) / duration : 0;
    const outgoing = from.temporal?.out ?? { speed: defaultSpeed, influence: 1 / 3 };
    const incoming = to.temporal?.in ?? { speed: defaultSpeed, influence: 1 / 3 };
    const outLength = clamp01(outgoing.influence) * duration;
    const inLength = clamp01(incoming.influence) * duration;
    return cubicCoefficients(
        from.time,
        from.time + outLength,
        to.time - inLength,
        to.time,
        fromValue,
        fromValue + outgoing.speed * outLength,
        toValue - incoming.speed * inLength,
        toValue,
    );
}

/** Creates editable velocity handles that match a preset's endpoint slopes. */
export function temporalTangentsForPreset(
    easing: EasingSpec | undefined,
    fromValue: number,
    toValue: number,
    duration: number,
): { out: TemporalHandle; in: TemporalHandle } {
    const slope = duration > 0 ? (toValue - fromValue) / duration : 0;
    switch(easing?.type ?? "linear") {
        case "ease-in": return { out: { speed: 0, influence: 1 / 3 }, in: { speed: slope * 2, influence: 1 / 3 } };
        case "ease-out": return { out: { speed: slope * 2, influence: 1 / 3 }, in: { speed: 0, influence: 1 / 3 } };
        case "ease-in-out": return { out: { speed: 0, influence: 1 / 3 }, in: { speed: 0, influence: 1 / 3 } };
        case "hold": return { out: { speed: 0, influence: 0 }, in: { speed: 0, influence: 0 } };
        default: return { out: { speed: slope, influence: 1 / 3 }, in: { speed: slope, influence: 1 / 3 } };
    }
}

/** Sorts once and deterministically keeps the last key at a timestamp. */
export function normalizedKeyframes(keyframes: readonly Keyframe[]): Keyframe[] {
    const indexed = keyframes.map((keyframe, index) => ({ keyframe, index }));
    indexed.sort((a, b) => a.keyframe.time - b.keyframe.time || a.index - b.index);
    const result: Keyframe[] = [];
    indexed.forEach(({ keyframe }) => {
        const previous = result[result.length - 1];
        if(previous && Math.abs(previous.time - keyframe.time) < 1e-9) result[result.length - 1] = keyframe;
        else result.push(keyframe);
    });
    return result;
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
        keyframes: normalizedKeyframes(Array.isArray(track.keyframes) ? track.keyframes.map(restoreKeyframe).filter((keyframe): keyframe is Keyframe => !!keyframe) : []),
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
        temporal: restoreTemporalTangents(keyframe.temporal),
    };
}

function restoreTemporalTangents(input: Partial<TemporalTangents> | undefined): TemporalTangents | undefined {
    if(!input || typeof input !== "object") return undefined;
    const incoming = restoreTemporalHandle(input.in);
    const outgoing = restoreTemporalHandle(input.out);
    if(!incoming && !outgoing) return undefined;
    return { in: incoming, out: outgoing, linked: input.linked !== false };
}

function restoreTemporalHandle(input: Partial<TemporalHandle> | undefined): TemporalHandle | undefined {
    if(!input || !Number.isFinite(input.speed) || !Number.isFinite(input.influence)) return undefined;
    return { speed: Number(input.speed), influence: clamp01(Number(input.influence)) };
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

export function interpolateAnimationColor(from: unknown, to: unknown, t: number): string {
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
        color.alpha = interpolateNumber(fromColor.alpha ?? 1, toColor.alpha ?? 1, t);
        return color.serialized;
    }

    const color = new Color(rgbToHex({
        r: Math.round(interpolateNumber(fromColor.rgb.r, toColor.rgb.r, t)),
        g: Math.round(interpolateNumber(fromColor.rgb.g, toColor.rgb.g, t)),
        b: Math.round(interpolateNumber(fromColor.rgb.b, toColor.rgb.b, t)),
    }));
    color.alpha = interpolateNumber(fromColor.alpha ?? 1, toColor.alpha ?? 1, t);
    return color.serialized;
}

function parseAnimationColor(value: unknown): (AnimationColorValue & { space?: ColorSpace }) | undefined {
    if(value instanceof Color) {
        return {
            type: "color",
            space: value.preferredSpace,
            hex: value.hex,
            rgb: value.rgb,
            hsl: value.hsl,
            alpha: value.alpha,
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
                alpha: color.alpha,
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
    const shorthand = /^#([0-9a-f])([0-9a-f])([0-9a-f])(?:[0-9a-f])?$/i.exec(value);
    if(shorthand) {
        return {
            r: parseInt(shorthand[1] + shorthand[1], 16),
            g: parseInt(shorthand[2] + shorthand[2], 16),
            b: parseInt(shorthand[3] + shorthand[3], 16),
        };
    }

    const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(value);
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

function cubicCoefficients(
    x0: number, x1: number, x2: number, x3: number,
    y0: number, y1: number, y2: number, y3: number,
): TemporalSegmentCoefficients {
    return {
        timeA: -x0 + 3 * x1 - 3 * x2 + x3,
        timeB: 3 * x0 - 6 * x1 + 3 * x2,
        timeC: -3 * x0 + 3 * x1,
        timeD: x0,
        valueA: -y0 + 3 * y1 - 3 * y2 + y3,
        valueB: 3 * y0 - 6 * y1 + 3 * y2,
        valueC: -3 * y0 + 3 * y1,
        valueD: y0,
    };
}

function solveTemporalTime(coefficients: TemporalSegmentCoefficients, time: number): number {
    const start = coefficients.timeD;
    const end = cubicValue(coefficients.timeA, coefficients.timeB, coefficients.timeC, coefficients.timeD, 1);
    let u = end === start ? 1 : clamp01((time - start) / (end - start));
    for(let iteration = 0; iteration < 5; iteration++) {
        const error = cubicValue(coefficients.timeA, coefficients.timeB, coefficients.timeC, coefficients.timeD, u) - time;
        const derivative = cubicDerivative(coefficients.timeA, coefficients.timeB, coefficients.timeC, u);
        if(Math.abs(error) < 1e-7 || Math.abs(derivative) < 1e-9) break;
        const next = u - error / derivative;
        if(next < 0 || next > 1) break;
        u = next;
    }
    let low = 0;
    let high = 1;
    for(let iteration = 0; iteration < 14; iteration++) {
        const value = cubicValue(coefficients.timeA, coefficients.timeB, coefficients.timeC, coefficients.timeD, u);
        if(Math.abs(value - time) < 1e-7) break;
        if(value < time) low = u; else high = u;
        u = (low + high) / 2;
    }
    return u;
}

function cubicValue(a: number, b: number, c: number, d: number, u: number): number {
    return ((a * u + b) * u + c) * u + d;
}

function cubicDerivative(a: number, b: number, c: number, u: number): number {
    return (3 * a * u + 2 * b) * u + c;
}
