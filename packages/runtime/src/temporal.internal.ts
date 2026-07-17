/** Shared temporal-cubic evaluator used by editor preview and portable playback. */
export function evaluateTemporalCubic(
    time: number,
    timeA: number,
    timeB: number,
    timeC: number,
    timeD: number,
    valueA: number,
    valueB: number,
    valueC: number,
    valueD: number,
): number {
    const position = solveTemporalCubicPosition(time, timeA, timeB, timeC, timeD);
    return ((valueA * position + valueB) * position + valueC) * position + valueD;
}

/** Solves the monotonic time cubic shared by temporal evaluation and speed graphs. */
export function solveTemporalCubicPosition(
    time: number,
    timeA: number,
    timeB: number,
    timeC: number,
    timeD: number,
): number {
    const end = ((timeA + timeB) + timeC) + timeD;
    let position = end === timeD ? 1 : Math.max(0, Math.min(1, (time - timeD) / (end - timeD)));
    for(let index = 0; index < 5; index++) {
        const error = ((timeA * position + timeB) * position + timeC) * position + timeD - time;
        const derivative = (3 * timeA * position + 2 * timeB) * position + timeC;
        if(Math.abs(error) < 1e-7 || Math.abs(derivative) < 1e-9) break;
        const next = position - error / derivative;
        if(next < 0 || next > 1) break;
        position = next;
    }
    let low = 0;
    let high = 1;
    for(let index = 0; index < 14; index++) {
        const sampledTime = ((timeA * position + timeB) * position + timeC) * position + timeD;
        if(Math.abs(sampledTime - time) < 1e-7) break;
        if(sampledTime < time) low = position; else high = position;
        position = (low + high) / 2;
    }
    return position;
}

/** Array-backed adapter for the compact runtime bundle representation. */
export function evaluateTemporalCubicArray(time: number, coefficients: readonly number[], offset = 0): number {
    return evaluateTemporalCubic(
        time,
        coefficients[offset], coefficients[offset + 1], coefficients[offset + 2], coefficients[offset + 3],
        coefficients[offset + 4], coefficients[offset + 5], coefficients[offset + 6], coefficients[offset + 7],
    );
}
