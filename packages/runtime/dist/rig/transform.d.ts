export interface TransformSave {
    translateX?: number;
    translateY?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    originX?: number;
    originY?: number;
}
export interface TransformState {
    translateX: number;
    translateY: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    originX?: number;
    originY?: number;
}
export interface Matrix {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}
export interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
export declare function defaultTransform(): TransformState;
export declare function restoreTransform(save?: TransformSave | null): TransformState;
export declare function serializeTransform(transform: TransformState): TransformSave;
export declare function identityMatrix(): Matrix;
export declare function translationMatrix(x: number, y: number): Matrix;
export declare function scaleMatrix(x: number, y: number): Matrix;
export declare function rotationMatrix(degrees: number): Matrix;
export declare function multiplyMatrix(left: Matrix, right: Matrix): Matrix;
export declare function invertMatrix(matrix: Matrix): Matrix;
export declare function applyMatrix(matrix: Matrix, x: number, y: number): {
    x: number;
    y: number;
};
export declare function matrixToSvg(matrix: Matrix): string | null;
export declare function transformMatrix(transform: TransformState, origin: {
    x: number;
    y: number;
}): Matrix;
export declare function transformedBounds(bounds: Bounds, matrix: Matrix): Bounds;
export declare function boundsCenter(bounds: Bounds): {
    x: number;
    y: number;
};
export declare function unionBounds(bounds: Bounds[]): Bounds;
export declare function decomposeTransform(matrix: Matrix): TransformState | undefined;
//# sourceMappingURL=transform.d.ts.map