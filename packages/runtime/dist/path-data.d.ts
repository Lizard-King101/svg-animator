import { RuntimeContourV1, RuntimeLineV1, RuntimePointV1 } from "./contracts";
/** Shared framework-free path reconstruction used by authoring and playback. */
export declare function buildRuntimePathData(contours: RuntimeContourV1[], rounded?: boolean): string;
/** The implicit Z edge, retaining the caller's endpoint identities without changing saved geometry. */
export declare function contourClosingPoints<T extends RuntimePointV1>(lines: readonly {
    points: readonly T[];
}[], closed: boolean): [T, T] | undefined;
/** Straight geometry may be encoded as a cubic with collapsed or collinear handles. */
export declare function isStraightPathSegment(line: {
    type: 'line' | 'bezier';
    points: readonly {
        x: number;
        y: number;
    }[];
    controlStart?: {
        x: number;
        y: number;
    };
    controlEnd?: {
        x: number;
        y: number;
    };
}): boolean;
export interface Corner {
    before: RuntimePointV1;
    after: RuntimePointV1;
    controlBefore: RuntimePointV1;
    controlAfter: RuntimePointV1;
}
export declare function roundedCorner(incoming: RuntimeLineV1, outgoing: RuntimeLineV1): Corner | null;
//# sourceMappingURL=path-data.d.ts.map