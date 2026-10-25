/** Match the compiler's animation precision rather than exposing arithmetic rounding at loop edges. */
export function actionTime(value) { return Math.round(value * 1e12) / 1e12; }
/** Start inclusive, end exclusive. Adjacent blocks never compete at their boundary. */
export function activeActionWindow(windows, time) {
    const sample = actionTime(time);
    return windows.find(window => sample >= actionTime(window.start) && sample < actionTime(window.end));
}
/** Repeat the trimmed source interval; the enclosing window owns the exclusive scene end. */
export function actionLocalTime(window, time) {
    if (!window.timing)
        return time - window.start;
    const { sourceStart, sourceEnd, rate } = window.timing;
    const span = sourceEnd - sourceStart, elapsed = (time - window.start) * rate;
    const cycles = elapsed / span;
    const nearest = Math.round(cycles);
    const phase = Math.abs(cycles - nearest) < 1e-10 ? 0 : elapsed % span;
    return sourceStart + phase;
}
//# sourceMappingURL=composition.internal.js.map