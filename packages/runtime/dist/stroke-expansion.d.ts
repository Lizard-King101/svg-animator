import { CurvePoint } from './curve-range';
/** Shared offset/join primitives for generated stroke geometry and Stroke to Path. */
export declare function strokeNormal(direction: CurvePoint, side: number): CurvePoint;
export declare function strokeOffset(point: CurvePoint, normal: CurvePoint, distance: number): CurvePoint;
export declare function strokeIntersection(a: CurvePoint, directionA: CurvePoint, b: CurvePoint, directionB: CurvePoint, epsilon?: number): CurvePoint | null;
//# sourceMappingURL=stroke-expansion.d.ts.map