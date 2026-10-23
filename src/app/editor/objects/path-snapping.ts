import { cubicPoint } from './curve-geometry';
import { Group } from './elements/group.object';
import { Path } from './elements/path.object';
import { Shape } from './elements/shape.object';
import { EllipseQueryTarget, ellipseCommonTangents, nearestEllipseContact } from './ellipse-geometry';
import { combinedMotionAdjustedMatrixFor } from './motion-path.object';
import { Point } from './point.object';
import { AnyElement, SVG } from './svg.object';
import { applyMatrix } from './transform.object';
import { MoveSnapFeedback, MoveSnapSession, moveSnapCandidates, SNAP_ACQUIRE_PX, SNAP_RELEASE_PX } from './snapping.object';
import { PathGeometryQuery, PathQuerySegment } from './path-geometry-query';

export interface PathSnapCandidate {
    id: string;
    point: { x: number; y: number };
    kind: 'anchor' | 'midpoint' | 'intersection' | 'path' | 'tangent' | 'perpendicular';
    label: string;
    tangent?: { x: number; y: number };
    origin?: { x: number; y: number };
}
export interface PointSnapFeedback {
    target?: PathSnapCandidate;
    guides?: MoveSnapFeedback;
}
export interface PathSnapExclusion {
    path: Path;
    points: ReadonlySet<Point>;
}

/** Freeze visible geometry. Exclude the moving anchor and every segment it deforms. */
export function pathSnapCandidates(svg: SVG, exclusion?: PathSnapExclusion): PathSnapCandidate[] {
    return pathSnapGeometry(svg, exclusion).points;
}

export function pathSnapGeometry(svg: SVG, exclusion?: PathSnapExclusion, roots = svg.elements): { points: PathSnapCandidate[]; segments: PathQuerySegment[]; ellipses: EllipseQueryTarget[] } {
    const anchors: PathSnapCandidate[] = [], midpoints: PathSnapCandidate[] = [];
    const segments: PathQuerySegment[] = [];
    const ellipses: EllipseQueryTarget[] = [];
    const visit = (elements: AnyElement[]) => elements.forEach((element) => {
        if(!element.visible) return;
        if(element instanceof Group) {
            // Exact clip containment is a separate geometry query. Never attract to masked-out points.
            if(!element.clipElement) visit(element.elements);
            return;
        }
        if(element instanceof Shape && element.type === 'ellipse') {
            const matrix = combinedMotionAdjustedMatrixFor(svg, element);
            if(element.radiusX > 0 && element.radiusY > 0) ellipses.push({ id: element.id, label: element.name,
                center: applyMatrix(matrix, element.centerX, element.centerY),
                axisX: { x: matrix.a * element.radiusX, y: matrix.b * element.radiusX },
                axisY: { x: matrix.c * element.radiusY, y: matrix.d * element.radiusY },
            });
            return;
        }
        if(!(element instanceof Path)) return;
        const matrix = combinedMotionAdjustedMatrixFor(svg, element);
        const ignored = element === exclusion?.path ? exclusion.points : new Set<Point>();
        const seen = new Set<Point>();
        for(const contour of element.contours) {
            const first = contour.lines[0]?.points[0], last = contour.lines.at(-1)?.points[1];
            const closing = contour.closed && first && last && Math.hypot(first.x - last.x, first.y - last.y) > 1e-8
                ? [{ id: `${contour.id}:close`, type: 'line' as const, points: [last, first] }] : [];
            for(const line of [...contour.lines, ...closing]) {
                for(const point of line.points) {
                    if(seen.has(point)) continue;
                    seen.add(point);
                    // A rounded control vertex is not on the rendered outline.
                    if(ignored.has(point) || point.cornerRadius > 0) continue;
                    anchors.push({ id: `${element.id}:anchor:${point.id}`, point: applyMatrix(matrix, point.x, point.y),
                        kind: 'anchor', label: `Anchor · ${element.name}` });
                }
                const [start, end] = line.points;
                if(!start || !end || ignored.has(start) || ignored.has(end) || start.cornerRadius > 0 || end.cornerRadius > 0) continue;
                segments.push({ id: `${element.id}:segment:${line.id}`, label: element.name,
                    start: applyMatrix(matrix, start.x, start.y), end: applyMatrix(matrix, end.x, end.y),
                    ...(line.type === 'bezier' && line.controlStart && line.controlEnd ? {
                        controlStart: applyMatrix(matrix, line.controlStart.x, line.controlStart.y),
                        controlEnd: applyMatrix(matrix, line.controlEnd.x, line.controlEnd.y),
                    } : {}),
                });
                const point = line.type === 'bezier' && line.controlStart && line.controlEnd
                    ? cubicPoint(start, line.controlStart, line.controlEnd, end, .5)
                    : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
                midpoints.push({ id: `${element.id}:midpoint:${line.id}`, point: applyMatrix(matrix, point.x, point.y),
                    kind: 'midpoint', label: `Midpoint · ${element.name}` });
            }
        }
    });
    visit(roots);
    return { points: [...anchors, ...midpoints], segments, ellipses };
}

/** Point targets lock both axes together; guide fallback reuses object snapping's axis solver. */
export class PointSnapSession {
    feedback?: PointSnapFeedback;
    private target?: PathSnapCandidate;
    private guides: MoveSnapSession;
    private geometry: PathGeometryQuery;
    constructor(private candidates: PathSnapCandidate[], svg: SVG, segments: PathQuerySegment[] = [], lineOrigin?: { x: number; y: number }, ellipses: EllipseQueryTarget[] = [], private curveEndpoint = false, commonTangents = true) {
        this.geometry = new PathGeometryQuery(segments, ellipses);
        if(lineOrigin) this.candidates = [...this.geometry.contacts(lineOrigin).map((hit) => ({ ...hit,
            label: `${hit.kind === 'tangent' ? 'Tangent' : 'Perpendicular'} · ${hit.label}` })), ...candidates];
        if(lineOrigin && commonTangents) {
            const source = ellipses.map(ellipse => ({ ellipse, contact: nearestEllipseContact(ellipse, lineOrigin) }))
                .filter(item => item.contact && Math.hypot(item.contact.point.x - lineOrigin.x, item.contact.point.y - lineOrigin.y) * (svg.zoom || 1) <= SNAP_ACQUIRE_PX)
                .sort((a, b) => Math.hypot(a.contact!.point.x - lineOrigin.x, a.contact!.point.y - lineOrigin.y) - Math.hypot(b.contact!.point.x - lineOrigin.x, b.contact!.point.y - lineOrigin.y))[0]?.ellipse;
            if(source) this.candidates = [...ellipses.filter(ellipse => ellipse !== source).flatMap(ellipse =>
                ellipseCommonTangents(source, ellipse).map((pair, index): PathSnapCandidate => ({
                    id: `${source.id}:${ellipse.id}:common:${index}`, point: pair.end, origin: pair.start,
                    kind: 'tangent', label: `Common tangent · ${source.label} / ${ellipse.label}`,
                }))), ...this.candidates.filter(candidate => !ellipses.some(ellipse => candidate.id.startsWith(`${ellipse.id}:tangent:`)))];
        }
        this.guides = new MoveSnapSession({ x: 0, y: 0, width: 0, height: 0 },
            moveSnapCandidates(svg, svg.elements).filter((candidate) => candidate.source !== 'geometry'));
    }

    update(point: { x: number; y: number }, zoom: number, bypass = false): Point {
        if(bypass) { this.clear(); return new Point(point.x, point.y); }
        const scale = Math.max(.01, zoom || 1);
        const distance = (candidate: PathSnapCandidate) => Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y) * scale;
        if(!this.target || this.target.kind === 'path' || !!this.target.tangent || distance(this.target) > SNAP_RELEASE_PX) {
            const previousEllipse = this.target?.tangent ? this.target.id : undefined;
            const previousSegment = this.target?.kind === 'path' ? this.target.id : undefined;
            this.target = undefined;
            let best = SNAP_ACQUIRE_PX + 1e-8;
            const intersections: PathSnapCandidate[] = this.geometry.intersections(point, SNAP_ACQUIRE_PX / scale)
                .map((hit) => ({ ...hit, kind: 'intersection', label: `Intersection · ${hit.label}` }));
            for(const candidate of [...this.candidates, ...intersections]) {
                const next = distance(candidate);
                if(next <= SNAP_ACQUIRE_PX + 1e-8 && (!this.target || next < best - 1e-8 ||
                    Math.abs(next - best) < 1e-8 && snapPriority(candidate) < snapPriority(this.target))) {
                    this.target = candidate; best = next;
                }
            }
            if(!this.target && this.curveEndpoint) {
                const hit = (previousEllipse ? this.geometry.nearestEllipse(point, SNAP_RELEASE_PX / scale, previousEllipse) : undefined)
                    ?? this.geometry.nearestEllipse(point, SNAP_ACQUIRE_PX / scale);
                if(hit) this.target = { ...hit, kind: 'tangent', label: `Curve tangent · ${hit.label}` };
            }
            // Discrete landmarks take precedence over a sliding path capture.
            if(!this.target) {
                const hit = (previousSegment ? this.geometry.nearest(point, SNAP_RELEASE_PX / scale, previousSegment) : undefined)
                    ?? this.geometry.nearest(point, SNAP_ACQUIRE_PX / scale);
                if(hit) this.target = { ...hit, kind: 'path', label: `Path · ${hit.label}` };
            }
        }
        if(this.target) {
            this.guides.clear();
            this.feedback = { target: this.target };
            return new Point(this.target.point.x, this.target.point.y);
        }
        const result = this.guides.update(point, zoom);
        this.feedback = this.guides.feedback ? { guides: this.guides.feedback } : undefined;
        return new Point(result.x, result.y);
    }

    clear(): void { this.target = undefined; this.feedback = undefined; this.guides.clear(); }
}

function snapPriority(candidate: PathSnapCandidate): number {
    return candidate.kind === 'anchor' ? 0 : candidate.kind === 'intersection' ? 1
        : candidate.kind === 'tangent' || candidate.kind === 'perpendicular' ? 2 : 3;
}
