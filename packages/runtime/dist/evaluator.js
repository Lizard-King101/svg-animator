import { evaluateTemporalCubicArray } from "./temporal.internal";
export function evaluateRuntimeTrack(track, time) {
    if (track.times.length === 0)
        return undefined;
    if (time <= track.times[0])
        return track.values[0];
    const last = track.times.length - 1;
    if (time >= track.times[last])
        return track.values[last];
    const segment = findSegment(track.times, time);
    if (track.kind === "boolean" || track.kind === "string")
        return track.values[segment];
    const start = track.times[segment];
    const end = track.times[segment + 1];
    const raw = (time - start) / Math.max(1e-12, end - start);
    if (track.kind === "color") {
        const mode = track.segmentModes[segment];
        if (mode === "hold")
            return track.values[segment];
        return interpolatePackedColor(track.values[segment], track.values[segment + 1], ease(raw, mode), track.interpolationSpaces[segment]);
    }
    const numericTrack = track;
    const mode = numericTrack.segmentModes[segment];
    if (mode === "hold")
        return numericTrack.values[segment];
    if (mode === "temporal") {
        const offset = segment * 8;
        const coefficients = numericTrack.temporalCoefficients;
        return evaluateTemporalCubicArray(time, coefficients, offset);
    }
    const amount = ease(raw, mode);
    return numericTrack.values[segment] + (numericTrack.values[segment + 1] - numericTrack.values[segment]) * amount;
}
export function packedColorValue(value) {
    const color = `#${((value >>> 8) & 0xffffff).toString(16).padStart(6, "0")}`;
    return { color, opacity: (value & 255) / 255 };
}
function findSegment(times, time) {
    let low = 0;
    let high = times.length - 1;
    while (low + 1 < high) {
        const middle = (low + high) >>> 1;
        if (times[middle] <= time)
            low = middle;
        else
            high = middle;
    }
    return low;
}
function ease(value, mode) {
    return mode === "ease-in" ? value * value
        : mode === "ease-out" ? 1 - (1 - value) * (1 - value)
            : mode === "ease-in-out" ? (value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2)
                : value;
}
function interpolatePackedColor(from, to, amount, space) {
    const first = [(from >>> 24) & 255, (from >>> 16) & 255, (from >>> 8) & 255];
    const second = [(to >>> 24) & 255, (to >>> 16) & 255, (to >>> 8) & 255];
    let red;
    let green;
    let blue;
    if (space === "hsl") {
        const a = rgbToHsl(...first);
        const b = rgbToHsl(...second);
        const hueDelta = ((b[0] - a[0] + 540) % 360) - 180;
        [red, green, blue] = hslToRgb((a[0] + hueDelta * amount + 360) % 360, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount);
    }
    else {
        red = Math.round(first[0] + (second[0] - first[0]) * amount);
        green = Math.round(first[1] + (second[1] - first[1]) * amount);
        blue = Math.round(first[2] + (second[2] - first[2]) * amount);
    }
    const alpha = Math.round((from & 255) + ((to & 255) - (from & 255)) * amount);
    return ((red << 24) | (green << 16) | (blue << 8) | alpha) >>> 0;
}
function rgbToHsl(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    if (max === min)
        return [0, 0, lightness];
    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    const hue = max === r ? ((g - b) / delta + (g < b ? 6 : 0)) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return [hue * 60, saturation, lightness];
}
function hslToRgb(hueDegrees, saturation, lightness) {
    if (saturation === 0) {
        const gray = Math.round(lightness * 255);
        return [gray, gray, gray];
    }
    const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    const hue = hueDegrees / 360;
    const channel = (offset) => {
        let value = hue + offset;
        if (value < 0)
            value += 1;
        if (value > 1)
            value -= 1;
        const result = value < 1 / 6 ? p + (q - p) * 6 * value : value < 1 / 2 ? q : value < 2 / 3 ? p + (q - p) * (2 / 3 - value) * 6 : p;
        return Math.round(result * 255);
    };
    return [channel(1 / 3), channel(0), channel(-1 / 3)];
}
//# sourceMappingURL=evaluator.js.map