/** Shared temporal-cubic evaluator used by editor preview and portable playback. */
export declare function evaluateTemporalCubic(time: number, timeA: number, timeB: number, timeC: number, timeD: number, valueA: number, valueB: number, valueC: number, valueD: number): number;
/** Solves the monotonic time cubic shared by temporal evaluation and speed graphs. */
export declare function solveTemporalCubicPosition(time: number, timeA: number, timeB: number, timeC: number, timeD: number): number;
/** Array-backed adapter for the compact runtime bundle representation. */
export declare function evaluateTemporalCubicArray(time: number, coefficients: readonly number[], offset?: number): number;
//# sourceMappingURL=temporal.internal.d.ts.map