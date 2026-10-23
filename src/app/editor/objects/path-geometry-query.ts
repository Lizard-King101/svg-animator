import type paperCore from 'paper/dist/paper-core';
import { curveContacts } from './curve-constraints';
import { EllipseQueryTarget, ellipseTangentContacts, ellipsePerpendicularContacts, nearestEllipseContact } from './ellipse-geometry';

declare const paper: typeof paperCore;

type Position = { x: number; y: number };
export interface PathQuerySegment {
    id: string;
    label: string;
    start: Position;
    end: Position;
    controlStart?: Position;
    controlEnd?: Position;
}
export interface PathQueryHit {
    id: string;
    label: string;
    point: Position;
}

/** Frozen canvas-space path curves and analytic ellipses; no project or scene items. */
export class PathGeometryQuery {
    private curves: Array<{ segment: PathQuerySegment; curve: paper.Curve }> = [];
    private crossings = new Map<string, PathQueryHit[]>();

    constructor(segments: PathQuerySegment[], private ellipses: EllipseQueryTarget[] = []) {
        this.ellipses = ellipses.map((ellipse) => ({ ...ellipse, center: { ...ellipse.center },
            axisX: { ...ellipse.axisX }, axisY: { ...ellipse.axisY } }));
        if(typeof paper === 'undefined') return;
        for(const segment of segments) {
            const { start, end } = segment;
            const c1 = segment.controlStart ?? start, c2 = segment.controlEnd ?? end;
            if(![start, end, c1, c2].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) continue;
            const curve = new paper.Curve([start.x, start.y], [c1.x - start.x, c1.y - start.y],
                [c2.x - end.x, c2.y - end.y], [end.x, end.y]);
            // A collapsed segment has no interior to acquire.
            if(curve.bounds.width < 1e-9 && curve.bounds.height < 1e-9) continue;
            this.curves.push({ segment, curve });
        }
    }

    contacts(origin: Position): Array<PathQueryHit & { kind: 'tangent' | 'perpendicular' }> {
        return [...this.curves.flatMap(({ segment }) => curveContacts(segment, origin).map((contact, index) => ({
            id: `${segment.id}:${contact.kind}:${index}`, label: segment.label, point: contact.point, kind: contact.kind,
        }))), ...this.ellipses.flatMap((ellipse) => (['tangent', 'perpendicular'] as const).flatMap(kind =>
            (kind === 'tangent' ? ellipseTangentContacts(ellipse, origin) : ellipsePerpendicularContacts(ellipse, origin)).map((point, index) => ({
                id: `${ellipse.id}:${kind}:${index}`, label: ellipse.label, point, kind,
            }))))];
    }

    nearestEllipse(point: Position, radius: number, preferredId?: string): (PathQueryHit & { tangent: Position }) | undefined {
        let best: (PathQueryHit & { tangent: Position }) | undefined, distance = radius;
        for(const ellipse of this.ellipses) {
            if(preferredId && ellipse.id !== preferredId) continue;
            const contact = nearestEllipseContact(ellipse, point);
            if(!contact) continue;
            const next = Math.hypot(contact.point.x - point.x, contact.point.y - point.y);
            if(next <= distance) { distance = next; best = { id: ellipse.id, label: ellipse.label, ...contact }; }
        }
        return best;
    }

    nearest(point: Position, radius: number, preferredId?: string): PathQueryHit | undefined {
        let best: PathQueryHit | undefined, distance = radius + 1e-8;
        for(const { segment, curve } of this.curves) {
            if(preferredId && segment.id !== preferredId || !nearBounds(curve, point, radius)) continue;
            const location = curve.getNearestLocation([point.x, point.y]);
            if(location.distance < distance) {
                best = { id: segment.id, label: segment.label, point: { x: location.point.x, y: location.point.y } };
                distance = location.distance;
            }
        }
        return best;
    }

    intersections(point: Position, radius: number): PathQueryHit[] {
        // Only nearby bounds participate; solve each encountered pair once per frozen session.
        const nearby = this.curves.filter(({ curve }) => nearBounds(curve, point, radius));
        const result: PathQueryHit[] = [];
        for(let i = 0; i < nearby.length; i++) for(let j = i; j < nearby.length; j++) {
            const a = nearby[i], b = nearby[j];
            const key = JSON.stringify([a.segment.id, b.segment.id]);
            let hits = this.crossings.get(key);
            if(!hits) {
                hits = a.curve.getIntersections(b.curve).filter((hit) => !hit.hasOverlap()).map((hit, index) => ({
                    id: `${key}:${index}`, label: a.segment.label === b.segment.label
                        ? a.segment.label : `${a.segment.label} / ${b.segment.label}`,
                    point: { x: hit.point.x, y: hit.point.y },
                }));
                this.crossings.set(key, hits);
            }
            for(const hit of hits) {
                if(Math.hypot(hit.point.x - point.x, hit.point.y - point.y) <= radius + 1e-8 &&
                    !result.some((other) => Math.hypot(other.point.x - hit.point.x, other.point.y - hit.point.y) < 1e-7)) result.push(hit);
            }
        }
        return result;
    }
}

function nearBounds(curve: paper.Curve, point: Position, radius: number): boolean {
    const bounds = curve.bounds;
    return point.x >= bounds.left - radius && point.x <= bounds.right + radius &&
        point.y >= bounds.top - radius && point.y <= bounds.bottom + radius;
}
