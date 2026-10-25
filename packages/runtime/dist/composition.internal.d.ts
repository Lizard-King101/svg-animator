/** Match the compiler's animation precision rather than exposing arithmetic rounding at loop edges. */
export declare function actionTime(value: number): number;
/** Start inclusive, end exclusive. Adjacent blocks never compete at their boundary. */
export declare function activeActionWindow<T extends {
    start: number;
    end: number;
}>(windows: readonly T[], time: number): T | undefined;
export interface ActionTimeMapping {
    sourceStart: number;
    sourceEnd: number;
    rate: number;
}
/** Repeat the trimmed source interval; the enclosing window owns the exclusive scene end. */
export declare function actionLocalTime(window: {
    start: number;
    timing?: ActionTimeMapping;
}, time: number): number;
//# sourceMappingURL=composition.internal.d.ts.map