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

export function defaultTransform(): TransformState {
    return {
        translateX: 0,
        translateY: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
    };
}

export function restoreTransform(save?: TransformSave | null): TransformState {
    return {
        translateX: save?.translateX ?? 0,
        translateY: save?.translateY ?? 0,
        scaleX: save?.scaleX ?? 1,
        scaleY: save?.scaleY ?? 1,
        rotation: save?.rotation ?? 0,
        originX: save?.originX,
        originY: save?.originY,
    };
}

export function serializeTransform(transform: TransformState): TransformSave {
    return {
        translateX: round(transform.translateX),
        translateY: round(transform.translateY),
        scaleX: round(transform.scaleX),
        scaleY: round(transform.scaleY),
        rotation: round(transform.rotation),
        originX: transform.originX == null ? undefined : round(transform.originX),
        originY: transform.originY == null ? undefined : round(transform.originY),
    };
}

export function identityMatrix(): Matrix {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function translationMatrix(x: number, y: number): Matrix {
    return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function scaleMatrix(x: number, y: number): Matrix {
    return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

export function rotationMatrix(degrees: number): Matrix {
    const radians = degrees * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function multiplyMatrix(left: Matrix, right: Matrix): Matrix {
    return {
        a: left.a * right.a + left.c * right.b,
        b: left.b * right.a + left.d * right.b,
        c: left.a * right.c + left.c * right.d,
        d: left.b * right.c + left.d * right.d,
        e: left.a * right.e + left.c * right.f + left.e,
        f: left.b * right.e + left.d * right.f + left.f,
    };
}

export function invertMatrix(matrix: Matrix): Matrix {
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if(Math.abs(determinant) < 0.000001) {
        return identityMatrix();
    }

    return {
        a: matrix.d / determinant,
        b: -matrix.b / determinant,
        c: -matrix.c / determinant,
        d: matrix.a / determinant,
        e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
        f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
    };
}

export function applyMatrix(matrix: Matrix, x: number, y: number): { x: number; y: number } {
    return {
        x: matrix.a * x + matrix.c * y + matrix.e,
        y: matrix.b * x + matrix.d * y + matrix.f,
    };
}

export function matrixToSvg(matrix: Matrix): string | null {
    if(isIdentityMatrix(matrix)) {
        return null;
    }

    return `matrix(${round(matrix.a)} ${round(matrix.b)} ${round(matrix.c)} ${round(matrix.d)} ${round(matrix.e)} ${round(matrix.f)})`;
}

export function transformMatrix(transform: TransformState, origin: { x: number; y: number }): Matrix {
    return [
        translationMatrix(transform.translateX, transform.translateY),
        translationMatrix(origin.x, origin.y),
        rotationMatrix(transform.rotation),
        scaleMatrix(transform.scaleX, transform.scaleY),
        translationMatrix(-origin.x, -origin.y),
    ].reduce((matrix, next) => multiplyMatrix(matrix, next), identityMatrix());
}

export function transformedBounds(bounds: Bounds, matrix: Matrix): Bounds {
    const points = [
        applyMatrix(matrix, bounds.x, bounds.y),
        applyMatrix(matrix, bounds.x + bounds.width, bounds.y),
        applyMatrix(matrix, bounds.x + bounds.width, bounds.y + bounds.height),
        applyMatrix(matrix, bounds.x, bounds.y + bounds.height),
    ];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function boundsCenter(bounds: Bounds): { x: number; y: number } {
    return {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
    };
}

export function unionBounds(bounds: Bounds[]): Bounds {
    if(bounds.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }

    const minX = Math.min(...bounds.map((bound) => bound.x));
    const minY = Math.min(...bounds.map((bound) => bound.y));
    const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));
    const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function isIdentityMatrix(matrix: Matrix): boolean {
    return close(matrix.a, 1) && close(matrix.b, 0) && close(matrix.c, 0)
        && close(matrix.d, 1) && close(matrix.e, 0) && close(matrix.f, 0);
}

function close(a: number, b: number): boolean {
    return Math.abs(a - b) < 0.000001;
}

function round(value: number): number {
    return Math.round(value * 10000) / 10000;
}
