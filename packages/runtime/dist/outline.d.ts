import type { RuntimeContourV1, RuntimeLineV1 } from './contracts';
import { CurvePoint } from './curve-range';
export interface OutlinePosition {
    segmentId: string;
    t: number;
}
export interface OutlineTaper {
    length: number;
    tipWidth: number;
}
export interface OutlineSection {
    id: string;
    contourId: string;
    start: OutlinePosition;
    end: OutlinePosition;
    startTaper?: OutlineTaper;
    endTaper?: OutlineTaper;
    /** Distinguishes a whole closed contour from an intentionally empty range. */
    fullContour?: boolean;
}
export interface OutlineStyle {
    width: number;
    alignment?: 'center' | 'inside' | 'outside';
    lineCap?: 'butt' | 'round' | 'square' | null;
    lineJoin?: 'miter' | 'round' | 'bevel' | null;
    miterLimit?: number;
    dasharray?: readonly number[];
    dashoffset?: number;
    drawProgress?: number;
    rounded?: boolean;
}
export interface OutlineProjectionSection {
    id: string;
    data: string;
    length: number;
    start: CurvePoint;
    end: CurvePoint;
}
export interface OutlineProjection {
    strokeData: string;
    sections: OutlineProjectionSection[];
    sourceBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    problem?: string;
}
/** Includes the implicit Z edge without ever adding an editable point. */
export declare function outlineContourSegments(contour: RuntimeContourV1): RuntimeLineV1[];
export declare function outlinePositionPoint(contour: RuntimeContourV1, position: OutlinePosition, rounded?: boolean): CurvePoint | undefined;
/** Nearest source-local address, used by endpoint dragging without changing topology. */
export declare function closestOutlinePosition(contour: RuntimeContourV1, point: CurvePoint, rounded?: boolean): OutlinePosition | undefined;
export declare function outlineSectionLines(contour: RuntimeContourV1, section: OutlineSection, rounded?: boolean): RuntimeLineV1[];
export declare function outlineSectionPathData(contour: RuntimeContourV1, section: OutlineSection, rounded?: boolean): string;
/** The only stroke projection used by editor, export and portable playback. */
export declare function projectOutlineSections(contours: RuntimeContourV1[], sections: readonly OutlineSection[], style: OutlineStyle): OutlineProjection;
export declare function fullOutlineSections(contours: RuntimeContourV1[]): OutlineSection[];
/** Validates authored addresses without projecting or silently repairing their geometry. */
export declare function outlineSectionsProblem(contours: RuntimeContourV1[], sections: readonly OutlineSection[]): string | undefined;
/** Prevent authoring or importing patterns that would create unbounded per-frame geometry. */
export declare function outlineDashComplexityProblem(length: number, input: readonly number[]): string | undefined;
export declare function outlineProjectionProblem(contours: RuntimeContourV1[], sections: readonly OutlineSection[], style: OutlineStyle): string | undefined;
//# sourceMappingURL=outline.d.ts.map