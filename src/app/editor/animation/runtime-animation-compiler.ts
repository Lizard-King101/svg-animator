import {
    AnimationDocument,
    AnimationTrack,
    Keyframe,
    normalizedKeyframes,
    temporalSegmentCoefficients,
} from "../objects/animation.object";
import { SVGSave } from "../objects/svg.object";

export interface RuntimeCompileDiagnostic {
    code: "orphaned-target" | "unsupported-property" | "invalid-value" | "skipped-track";
    trackId: string;
    message: string;
}

export interface CompiledNumericTrackV1 {
    kind: "number";
    target: number;
    property: number;
    times: number[];
    values: number[];
    segmentModes: RuntimeSegmentMode[];
    /** Eight polynomial coefficients per temporal segment, otherwise eight zeroes. */
    temporalCoefficients: number[];
}

export interface CompiledColorTrackV1 {
    kind: "color";
    target: number;
    property: number;
    times: number[];
    /** RGBA packed as 0xRRGGBBAA. */
    values: number[];
    interpolationSpaces: ("rgb" | "hsl")[];
    segmentModes: RuntimeSegmentMode[];
}

export interface CompiledDiscreteTrackV1 {
    kind: "boolean" | "string";
    target: number;
    property: number;
    times: number[];
    values: (boolean | string)[];
}

export type RuntimeSegmentMode = "linear" | "hold" | "ease-in" | "ease-out" | "ease-in-out" | "temporal";
export type CompiledRuntimeTrackV1 = CompiledNumericTrackV1 | CompiledColorTrackV1 | CompiledDiscreteTrackV1;

export interface CompiledAnimationV1 {
    kind: "svg-animator/compiled-animation";
    version: 1;
    targets: string[];
    properties: string[];
    duration: number;
    loop: boolean;
    markers: AnimationDocument["markers"];
    variables: NonNullable<AnimationDocument["variables"]>;
    tracks: CompiledRuntimeTrackV1[];
    diagnostics: RuntimeCompileDiagnostic[];
}

/** Pure deterministic compiler boundary shared by editor playback and export. */
export function compileRuntimeAnimation(document: SVGSave): CompiledAnimationV1 {
    const animation = document.animation;
    const result: CompiledAnimationV1 = {
        kind: "svg-animator/compiled-animation",
        version: 1,
        targets: [],
        properties: [],
        duration: animation?.duration ?? 0,
        loop: animation?.loop ?? false,
        markers: (animation?.markers ?? []).map((marker) => ({ ...marker })),
        variables: (animation?.variables ?? []).map((variable) => ({ ...variable })),
        tracks: [],
        diagnostics: [],
    };
    if(!animation) return result;

    const elementIds = collectElementIds(document.elements as unknown[]);
    const targets = new Map<string, number>();
    const properties = new Map<string, number>();
    const intern = (table: string[], map: Map<string, number>, value: string) => {
        const existing = map.get(value);
        if(existing != null) return existing;
        const index = table.length;
        table.push(value);
        map.set(value, index);
        return index;
    };

    animation.tracks.forEach((track) => {
        if(track.enabled === false) return;
        if(!elementIds.has(track.targetId)) {
            diagnostic(result, track, "orphaned-target", `Target “${track.targetId}” does not exist.`);
            diagnostic(result, track, "skipped-track", "Track was skipped because its target is unavailable.");
            return;
        }
        if(!supportedProperty(track.property)) {
            diagnostic(result, track, "unsupported-property", `Property “${track.property}” is not supported by runtime v1.`);
            diagnostic(result, track, "skipped-track", "Track was skipped because its property is unsupported.");
            return;
        }
        const keyframes = normalizedKeyframes(track.keyframes);
        if(keyframes.length === 0) {
            diagnostic(result, track, "skipped-track", "Track has no valid keyframes.");
            return;
        }
        const target = intern(result.targets, targets, track.targetId);
        const property = intern(result.properties, properties, track.property);
        const compiled = compileTrack(track, keyframes, target, property, result);
        if(compiled) result.tracks.push(compiled);
    });
    return result;
}

/** Evaluates one compiler payload track for authoring/runtime equivalence tests. */
export function evaluateCompiledRuntimeTrack(track: CompiledRuntimeTrackV1, time: number): number | boolean | string | undefined {
    if(track.times.length === 0) return undefined;
    if(time <= track.times[0]) return track.values[0];
    const last = track.times.length - 1;
    if(time >= track.times[last]) return track.values[last];
    const segment = runtimeSegment(track.times, time);
    if(track.kind === "boolean" || track.kind === "string") return track.values[segment];
    const start = track.times[segment];
    const end = track.times[segment + 1];
    const raw = (time - start) / Math.max(1e-12, end - start);
    if(track.kind === "color") {
        const mode = track.segmentModes[segment];
        if(mode === "hold") return track.values[segment];
        return interpolatePackedColor(track.values[segment], track.values[segment + 1], runtimeEase(raw, mode), track.interpolationSpaces[segment]);
    }
    const numericTrack = track as CompiledNumericTrackV1;
    const mode = numericTrack.segmentModes[segment];
    if(mode === "hold") return numericTrack.values[segment];
    if(mode === "temporal") {
        const offset = segment * 8;
        const c = numericTrack.temporalCoefficients;
        let low = 0;
        let high = 1;
        let u = raw;
        for(let index = 0; index < 16; index++) {
            const x = ((c[offset] * u + c[offset + 1]) * u + c[offset + 2]) * u + c[offset + 3];
            if(x < time) low = u; else high = u;
            u = (low + high) / 2;
        }
        return ((c[offset + 4] * u + c[offset + 5]) * u + c[offset + 6]) * u + c[offset + 7];
    }
    const eased = runtimeEase(raw, mode);
    return numericTrack.values[segment] + (numericTrack.values[segment + 1] - numericTrack.values[segment]) * eased;
}

function compileTrack(
    track: AnimationTrack,
    keys: Keyframe[],
    target: number,
    property: number,
    result: CompiledAnimationV1,
): CompiledRuntimeTrackV1 | undefined {
    const times = keys.map((key) => key.time);
    if(track.valueType === "number") {
        const values = keys.map((key) => Number(key.value));
        if(values.some((value) => !Number.isFinite(value))) {
            diagnostic(result, track, "invalid-value", "Numeric track contains a non-finite value.");
            diagnostic(result, track, "skipped-track", "Invalid numeric track was skipped.");
            return undefined;
        }
        const segmentModes: RuntimeSegmentMode[] = [];
        const temporalCoefficients: number[] = [];
        for(let index = 0; index < keys.length - 1; index++) {
            const from = keys[index];
            const to = keys[index + 1];
            if(from.temporal?.out || to.temporal?.in) {
                segmentModes.push("temporal");
                const c = temporalSegmentCoefficients(from, to);
                temporalCoefficients.push(c.timeA, c.timeB, c.timeC, c.timeD, c.valueA, c.valueB, c.valueC, c.valueD);
            } else {
                segmentModes.push(from.easing?.type ?? "linear");
                temporalCoefficients.push(0, 0, 0, 0, 0, 0, 0, 0);
            }
        }
        return { kind: "number", target, property, times, values, segmentModes, temporalCoefficients };
    }
    if(track.valueType === "color") {
        const colors = keys.map((key) => parseColor(key.value));
        if(colors.some((color) => !color)) {
            diagnostic(result, track, "invalid-value", "Color track contains an invalid color value.");
            diagnostic(result, track, "skipped-track", "Invalid color track was skipped.");
            return undefined;
        }
        return {
            kind: "color",
            target,
            property,
            times,
            values: colors.map((color) => color!.packed),
            interpolationSpaces: keys.slice(0, -1).map((_key, index) => colors[index + 1]!.space ?? colors[index]!.space),
            segmentModes: keys.slice(0, -1).map((key) => key.easing?.type ?? "linear"),
        };
    }
    const valid = track.valueType === "boolean"
        ? keys.every((key) => typeof key.value === "boolean")
        : keys.every((key) => typeof key.value === "string");
    if(!valid) {
        diagnostic(result, track, "invalid-value", `Discrete ${track.valueType} track contains an invalid value.`);
        diagnostic(result, track, "skipped-track", "Invalid discrete track was skipped.");
        return undefined;
    }
    return { kind: track.valueType, target, property, times, values: keys.map((key) => key.value as boolean | string) };
}

function diagnostic(result: CompiledAnimationV1, track: AnimationTrack, code: RuntimeCompileDiagnostic["code"], message: string): void {
    result.diagnostics.push({ code, trackId: track.id, message });
}

function collectElementIds(elements: unknown[]): Set<string> {
    const result = new Set<string>();
    const visit = (items: unknown[]) => items.forEach((item) => {
        if(!item || typeof item !== "object") return;
        const record = item as Record<string, unknown>;
        if(typeof record["id"] === "string") result.add(record["id"] as string);
        if(Array.isArray(record["elements"])) visit(record["elements"] as unknown[]);
    });
    visit(elements);
    return result;
}

function supportedProperty(property: string): boolean {
    return /^(geometry\.(x|y|width|height)|transform\.(translateX|translateY|scaleX|scaleY|rotation|originX|originY)|opacity|visible|settings\.(fill|stroke|color|stroke_width|stroke_dashoffset)|path\.drawProgress|motion\.(progress|rotateToPath|offsetAngle|offsetX|offsetY)|path\.points\.[^.]+\.(x|y)|settings\.(fill|stroke|color)\.gradient\.(x1|y1|x2|y2|cx|cy|r|fx|fy|transform\.(a|b|c|d|e|f)|stops\..+\.(offset|color|opacity)))$/.test(property);
}

function parseColor(value: unknown): { packed: number; space: "rgb" | "hsl" } | undefined {
    let hex: string | undefined;
    let alpha = 255;
    let space: "rgb" | "hsl" = "rgb";
    if(typeof value === "string") hex = value;
    else if(value && typeof value === "object") {
        const color = value as { hex?: unknown; alpha?: unknown; space?: unknown };
        if(typeof color.hex === "string") hex = color.hex;
        if(typeof color.alpha === "number" && Number.isFinite(color.alpha)) alpha = Math.round(Math.max(0, Math.min(1, color.alpha)) * 255);
        if(color.space === "hsl") space = "hsl";
    }
    if(!hex) return undefined;
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(expandHex(hex));
    if(!match) return undefined;
    if(match[4]) alpha = parseInt(match[4], 16);
    const packed = ((parseInt(match[1], 16) << 24) | (parseInt(match[2], 16) << 16) | (parseInt(match[3], 16) << 8) | alpha) >>> 0;
    return { packed, space };
}

function expandHex(value: string): string {
    const match = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(value);
    return match ? `#${match[1]}${match[1]}${match[2]}${match[2]}${match[3]}${match[3]}${match[4] ? match[4] + match[4] : ""}` : value;
}

function runtimeSegment(times: readonly number[], time: number): number {
    let low = 0;
    let high = times.length - 1;
    while(low + 1 < high) {
        const middle = (low + high) >>> 1;
        if(times[middle] <= time) low = middle; else high = middle;
    }
    return low;
}

function runtimeEase(value: number, mode: RuntimeSegmentMode): number {
    return mode === "ease-in" ? value * value
        : mode === "ease-out" ? 1 - (1 - value) * (1 - value)
        : mode === "ease-in-out" ? (value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2)
        : value;
}

function interpolatePackedColor(from: number, to: number, amount: number, space: "rgb" | "hsl"): number {
    const fromR = (from >>> 24) & 255;
    const fromG = (from >>> 16) & 255;
    const fromB = (from >>> 8) & 255;
    const toR = (to >>> 24) & 255;
    const toG = (to >>> 16) & 255;
    const toB = (to >>> 8) & 255;
    let r: number;
    let g: number;
    let b: number;
    if(space === "hsl") {
        const first = rgbToHsl(fromR, fromG, fromB);
        const second = rgbToHsl(toR, toG, toB);
        const hueDelta = ((second[0] - first[0] + 540) % 360) - 180;
        [r, g, b] = hslToRgb((first[0] + hueDelta * amount + 360) % 360, first[1] + (second[1] - first[1]) * amount, first[2] + (second[2] - first[2]) * amount);
    } else {
        r = Math.round(fromR + (toR - fromR) * amount);
        g = Math.round(fromG + (toG - fromG) * amount);
        b = Math.round(fromB + (toB - fromB) * amount);
    }
    const alpha = Math.round((from & 255) + ((to & 255) - (from & 255)) * amount);
    return ((r << 24) | (g << 16) | (b << 8) | alpha) >>> 0;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    if(max === min) return [0, 0, lightness];
    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    const hue = max === red ? ((green - blue) / delta + (green < blue ? 6 : 0))
        : max === green ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
    return [hue * 60, saturation, lightness];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    if(s === 0) {
        const gray = Math.round(l * 255);
        return [gray, gray, gray];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = h / 360;
    const channel = (offset: number) => {
        let value = hue + offset;
        if(value < 0) value += 1;
        if(value > 1) value -= 1;
        const result = value < 1 / 6 ? p + (q - p) * 6 * value
            : value < 1 / 2 ? q
            : value < 2 / 3 ? p + (q - p) * (2 / 3 - value) * 6
            : p;
        return Math.round(result * 255);
    };
    return [channel(1 / 3), channel(0), channel(-1 / 3)];
}
