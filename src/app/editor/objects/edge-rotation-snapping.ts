import { findElementChain } from './element-bounds';
import { Group } from './elements/group.object';
import { Path } from './elements/path.object';
import { Shape } from './elements/shape.object';
import { combinedMotionAdjustedMatrixFor } from './motion-path.object';
import { pathSnapGeometry } from './path-snapping';
import { PathQuerySegment } from './path-geometry-query';
import { AnyElement, SVG } from './svg.object';
import { Matrix, applyMatrix, invertMatrix } from './transform.object';

type Position = { x: number; y: number };
export type FlatEdge = Pick<PathQuerySegment, 'id' | 'label' | 'start' | 'end'>;
export interface EdgeRotationFeedback { moving: FlatEdge; reference: FlatEdge }
const ACQUIRE_DEGREES = 3, RELEASE_DEGREES = 5;

/** Rendered flat sides only; bounding-box edges are not substitutes for artwork edges. */
export function flatEdges(svg: SVG, roots = svg.elements, excluded = new Set<AnyElement>()): FlatEdge[] {
    return roots.flatMap((element): FlatEdge[] => {
        if(!element.visible || excluded.has(element)) return [];
        if(element instanceof Group) return element.clipElement ? [] : flatEdges(svg, element.elements, excluded);
        if(element instanceof Path) return pathSnapGeometry(svg, undefined, [element]).segments
            .filter((segment) => !segment.controlStart && !segment.controlEnd);
        if(!(element instanceof Shape) || element.type !== 'rectangle') return [];
        const { x, y, width: w, height: h } = element;
        const r = Math.max(0, Math.min(element.settings.corner_radius ?? 0, w / 2, h / 2));
        const sides = [[x + r, y, x + w - r, y], [x + w, y + r, x + w, y + h - r],
            [x + w - r, y + h, x + r, y + h], [x, y + h - r, x, y + r]];
        const matrix = combinedMotionAdjustedMatrixFor(svg, element);
        return sides.map(([x1, y1, x2, y2], index) => ({ id: `${element.id}:side:${index}`, label: element.name,
            start: applyMatrix(matrix, x1, y1), end: applyMatrix(matrix, x2, y2) }))
            .filter((edge) => Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y) > 1e-8);
    });
}

export function edgeRotationSession(svg: SVG, selected: AnyElement[], frame: Matrix, pivot: Position): EdgeRotationSnapSession | undefined {
    if(Math.abs(frame.a * frame.d - frame.b * frame.c) < 1e-8 || selected.some((element) =>
        containsMotion(element) || findElementChain(svg.elements, element)?.some((ancestor) =>
            !!ancestor.motion.pathId || !ancestor.visible || ancestor.locked || ancestor instanceof Group && !!ancestor.clipElement))) return undefined;
    return new EdgeRotationSnapSession(flatEdges(svg, selected), flatEdges(svg, svg.elements, new Set(selected)), frame, pivot);
}

function containsMotion(element: AnyElement): boolean {
    return !!element.motion.pathId || element instanceof Group && element.elements.some(containsMotion);
}

/** Parallel orientation modulo 180°, solved in the gesture's rotation frame. */
export class EdgeRotationSnapSession {
    feedback?: EdgeRotationFeedback;
    private candidates: Array<{ angle: number; moving: FlatEdge; reference: FlatEdge }> = [];
    private captured?: typeof this.candidates[number];
    constructor(moving: FlatEdge[], references: FlatEdge[], private frame: Matrix, private pivot: Position) {
        const inverse = invertMatrix(frame);
        const local = (edge: FlatEdge): FlatEdge => ({ ...edge,
            start: applyMatrix(inverse, edge.start.x, edge.start.y), end: applyMatrix(inverse, edge.end.x, edge.end.y) });
        for(const edge of moving.map(local)) for(const reference of references) {
            const target = local(reference);
            if(Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y) < 1e-8 ||
                Math.hypot(target.end.x - target.start.x, target.end.y - target.start.y) < 1e-8) continue;
            this.candidates.push({ angle: angle(target) - angle(edge), moving: edge, reference });
        }
    }
    update(delta: number, bypass: boolean): number {
        if(bypass || Math.abs(delta) < 1e-8) { this.clear(); return delta; }
        const correction = (candidate: typeof this.candidates[number]) => nearestParallel(candidate.angle, delta) - delta;
        if(!this.captured || Math.abs(correction(this.captured)) > RELEASE_DEGREES) {
            this.captured = undefined;
            let best = ACQUIRE_DEGREES + 1e-8;
            for(const candidate of this.candidates) {
                const distance = Math.abs(correction(candidate));
                if(distance < best) { this.captured = candidate; best = distance; }
            }
        }
        if(!this.captured) { this.feedback = undefined; return delta; }
        const next = nearestParallel(this.captured.angle, delta), radians = next * Math.PI / 180;
        const project = (p: Position) => {
            const x = p.x - this.pivot.x, y = p.y - this.pivot.y;
            return applyMatrix(this.frame, this.pivot.x + x * Math.cos(radians) - y * Math.sin(radians),
                this.pivot.y + x * Math.sin(radians) + y * Math.cos(radians));
        };
        const edge = this.captured.moving;
        this.feedback = { reference: this.captured.reference,
            moving: { ...edge, start: project(edge.start), end: project(edge.end) } };
        return next;
    }
    clear(): void { this.captured = undefined; this.feedback = undefined; }
}
const angle = (edge: FlatEdge) => Math.atan2(edge.end.y - edge.start.y, edge.end.x - edge.start.x) * 180 / Math.PI;
const nearestParallel = (angle: number, around: number) => angle + 180 * Math.round((around - angle) / 180);
