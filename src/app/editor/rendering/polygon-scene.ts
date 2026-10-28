import type { Matrix } from '../../../../packages/runtime/src/rig/transform';
import type { CurvePoint } from '../../../../packages/runtime/src/curve-range';

/** Transient drawing data. IDs/revisions belong to the scene compiler, never the document. */
export type PolygonContours = readonly (readonly CurvePoint[])[];
export type PolygonDraw = {
    id: string;
    revision: number;
    /** Local geometry stays resident when only its world transform changes. */
    transform?: Matrix;
    fillRule?: 'nonzero' | 'evenodd';
    /** Clip IDs refer to an ordered, parent-first list of white mask draws. */
    clipId?: string;
    /** Straight-alpha sRGB components, each in [0, 1]. */
    color: readonly [number, number, number, number];
} & ({ polygons: PolygonContours; vertices?: never } | { vertices: Float32Array<ArrayBuffer>; polygons?: never });

export interface PolygonViewport { width: number; height: number; }

/** Signed triangle fans are for stencil winding, NOT ordinary alpha-blended triangles.
 * Concave polygons and holes require the subsequent nonzero stencil cover pass.
 */
export class PolygonFanBuffer {
    private storage = new Float32Array(0);
    length = 0;
    get data(): Float32Array<ArrayBuffer> { return this.storage.subarray(0, this.length); }
    get capacity(): number { return this.storage.length; }

    reset(): void { this.length = 0; }

    /** Append one borrowed polygon while the outline kernel emits it. */
    append(polygon: readonly CurvePoint[], maxBytes = 64 * 1024 * 1024): void {
        validatePoints(polygon);
        this.reserve(this.length + Math.max(0, polygon.length - 2) * 6, maxBytes);
        this.appendUnchecked(polygon);
    }

    write(polygons: PolygonContours, maxBytes = 64 * 1024 * 1024): void {
        let length = 0;
        for(const polygon of polygons) { length += Math.max(0, polygon.length - 2) * 6; validatePoints(polygon); }
        this.reserve(length, maxBytes);
        this.length = 0;
        for(const polygon of polygons) this.appendUnchecked(polygon);
    }
    private reserve(length: number, maxBytes: number): void {
        if(!Number.isSafeInteger(maxBytes) || maxBytes < 0 || length * 4 > maxBytes) throw new Error('Polygon geometry exceeds the renderer buffer budget.');
        if(this.storage.length >= length) return;
        const next = new Float32Array(Math.min(Math.floor(maxBytes / 4), Math.max(length, this.storage.length * 2, 256)));
        next.set(this.storage.subarray(0, this.length)); this.storage = next;
    }
    private appendUnchecked(polygon: readonly CurvePoint[]): void {
        let offset = this.length;
        for(let index = 1; index + 1 < polygon.length; index++) {
            const a = polygon[0], b = polygon[index], c = polygon[index + 1];
            this.storage[offset++] = a.x; this.storage[offset++] = a.y;
            this.storage[offset++] = b.x; this.storage[offset++] = b.y;
            this.storage[offset++] = c.x; this.storage[offset++] = c.y;
        }
        this.length = offset;
    }

}

export function validatePolygonScene(draws: readonly PolygonDraw[], viewport: PolygonViewport, clips: readonly PolygonDraw[] = []): void {
    if(![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid renderer viewport.');
    if(clips.length > 32) throw new Error('Clip count exceeds the renderer budget.');
    const depths = new Map<string, number>();
    for(const clip of clips) {
        const depth = clip.clipId === undefined ? 1 : (depths.get(clip.clipId) ?? Infinity) + 1;
        if(depth > 16 || depths.has(clip.id)) throw new Error('Invalid clip order, cycle or depth.');
        if(clip.color.some(value => value !== 1)) throw new Error('Clip masks must be white.');
        depths.set(clip.id, depth);
    }
    const ids = new Set<string>();
    for(const draw of [...clips, ...draws]) {
        if(ids.has(draw.id)) throw new Error('Drawing IDs must be unique.');
        ids.add(draw.id);
        if(draw.clipId !== undefined && !depths.has(draw.clipId)) throw new Error('Missing clip mask.');
        if(draw.fillRule !== undefined && draw.fillRule !== 'nonzero' && draw.fillRule !== 'evenodd') throw new Error('Invalid fill rule.');
        if(draw.transform && ![draw.transform.a, draw.transform.b, draw.transform.c, draw.transform.d, draw.transform.e, draw.transform.f].every(validCoordinate)) throw new Error('Invalid drawing transform.');
        if(!Number.isSafeInteger(draw.revision) || draw.color.length !== 4 || !draw.color.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('Invalid drawing revision or color.');
    }
}

function validatePoints(points: readonly CurvePoint[]): void {
    for(const point of points) if(!validCoordinate(point.x) || !validCoordinate(point.y)) throw new Error('Unsupported polygon coordinates.');
}
function validCoordinate(value: number): boolean { return Number.isFinite(value) && Math.abs(value) <= 1e12; }

/** A packed buffer is still validated at the rendering boundary, including worker input. */
export function validateFanVertices(vertices: Float32Array<ArrayBuffer>, maxBytes: number): void {
    if(vertices.length % 6 !== 0 || vertices.byteLength > maxBytes) throw new Error('Invalid packed polygon size.');
    for(const value of vertices) if(!validCoordinate(value)) throw new Error('Unsupported polygon coordinates.');
}
