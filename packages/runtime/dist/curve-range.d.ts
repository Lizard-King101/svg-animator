/** Framework-free curve primitives shared by authoring and derived rendering. */
export interface CurvePoint {
    x: number;
    y: number;
}
export interface CurveLengthSample {
    t: number;
    length: number;
}
export interface CurveLine {
    type: 'line' | 'bezier';
    points: readonly CurvePoint[];
    controlStart?: CurvePoint;
    controlEnd?: CurvePoint;
}
export declare function lerpCurvePoint(a: CurvePoint, b: CurvePoint, t: number): CurvePoint;
export declare function cubicPoint(a: CurvePoint, b: CurvePoint, c: CurvePoint, d: CurvePoint, t: number): CurvePoint;
export declare function splitCubic(a: CurvePoint, b: CurvePoint, c: CurvePoint, d: CurvePoint, t: number): [[CurvePoint, CurvePoint, CurvePoint, CurvePoint], [CurvePoint, CurvePoint, CurvePoint, CurvePoint]];
export declare function cubicRange(a: CurvePoint, b: CurvePoint, c: CurvePoint, d: CurvePoint, start: number, end: number): [CurvePoint, CurvePoint, CurvePoint, CurvePoint];
export declare function curvePoint(line: CurveLine, t: number): CurvePoint;
export declare function curveLengthSamples(line: CurveLine, steps?: number): CurveLengthSample[];
export declare function curveTAtLength(samples: CurveLengthSample[], target: number): number;
//# sourceMappingURL=curve-range.d.ts.map