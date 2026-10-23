import type paperCore from 'paper/dist/paper-core';
import { createScope, DisposablePaperScope, paperPathData } from './paper-geometry';
import { EllipseQueryTarget } from './ellipse-geometry';
import { ellipseArcToCubics } from './arc-geometry';

declare const paper: typeof paperCore;
type Position = { x: number; y: number };
export interface ConstructionOutline { id: string; data: string; ellipse?: EllipseQueryTarget }
interface Edge { id: number; curve: paper.Curve; from: number; to: number; cut: boolean; ellipse?: EllipseQueryTarget }
interface Outline { source: string; closed: boolean; edges: Edge[]; ellipse?: EllipseQueryTarget }
export interface TrimSpan { source: string; data: string; edges: ReadonlySet<number> }
export interface ConstructionRegion { data: string; area: number; item: paper.PathItem }

/** Frozen planar arrangement. Splits cubics exactly; previews never touch document geometry. */
export class ConstructionNetwork {
    readonly regions: ConstructionRegion[] = [];
    readonly spans: TrimSpan[] = [];
    private scope: DisposablePaperScope;
    private outlines: Outline[] = [];
    private edges: Edge[] = [];
    private vertices: Position[] = [];

    constructor(sources: ConstructionOutline[]) {
        this.scope = createScope();
        try { this.build(sources); } catch(error) { this.dispose(); throw error; }
    }
    dispose(): void { this.scope.remove(); }
    regionAt(point: Position): ConstructionRegion | undefined {
        return this.regions.filter(region => region.item.contains([point.x, point.y])).sort((a, b) => a.area - b.area)[0];
    }
    spanAt(point: Position, radius: number): TrimSpan | undefined {
        let best: TrimSpan | undefined, distance = radius;
        // Later sources win coincident-outline ties, matching artwork stacking.
        for(const span of this.spans) for(const id of span.edges) {
            const location = this.edges[id].curve.getNearestLocation([point.x, point.y]);
            if(location.distance <= distance) { best = span; distance = location.distance; }
        }
        return best;
    }
    trimmedData(span: TrimSpan): string {
        return this.outlines.filter(outline => outline.source === span.source).flatMap(outline => {
            if(!outline.edges.some(edge => span.edges.has(edge.id))) return [paperPathData(this.path(outline.edges, outline.closed))];
            const runs: Edge[][] = []; let run: Edge[] = [];
            for(const edge of outline.edges) {
                if(span.edges.has(edge.id)) { if(run.length) runs.push(run); run = []; }
                else run.push(edge);
            }
            if(run.length) runs.push(run);
            if(outline.closed && runs.length > 1 && !span.edges.has(outline.edges[0].id) && !span.edges.has(outline.edges.at(-1)!.id)) {
                runs[0] = [...runs.pop()!, ...runs[0]];
            }
            return runs.map(edges => paperPathData(this.path(edges, false)));
        }).join(' ');
    }
    private build(sources: ConstructionOutline[]): void {
        const curves: Array<{ curve: paper.Curve; outline: Outline; index: number; count: number; times: number[]; cuts: number[] }> = [];
        for(const source of sources) {
            const item = this.scope.PathItem.create(source.data);
            const paths = item instanceof this.scope.CompoundPath ? item.children as paper.Path[] : [item as paper.Path];
            for(const path of paths) {
                const outline: Outline = { source: source.id, closed: path.closed, edges: [], ellipse: source.ellipse };
                this.outlines.push(outline);
                path.curves.forEach((curve, index) => curves.push({ curve, outline, index, count: path.curves.length, times: [0, 1], cuts: [] }));
            }
        }
        // Reject pathological workloads before the quadratic intersection pass.
        if(curves.length > 600) throw new Error('Use a smaller selection (up to 600 curve segments).');
        for(let i = 0; i < curves.length; i++) for(let j = i; j < curves.length; j++) {
            const a = curves[i], b = curves[j];
            if(!a.curve.bounds.intersects(b.curve.bounds.expand(1e-6))) continue;
            const hits = a.curve.getIntersections(b.curve);
            if(a !== b) for(const [first, second] of [[a, b], [b, a]]) for(const t of [0, 1]) {
                const point = first.curve.getPointAtTime(t), nearest = second.curve.getNearestLocation(point);
                if(nearest.distance < 1e-6 && nearest.time > 1e-8 && nearest.time < 1 - 1e-8) {
                    first.cuts.push(t); second.times.push(nearest.time); second.cuts.push(nearest.time);
                }
            }
            for(const hit of hits) {
                const t = hit.time, u = hit.intersection.time;
                const adjacent = a.outline === b.outline && (Math.abs(a.index - b.index) === 1 || a.outline.closed && Math.abs(a.index - b.index) === a.count - 1);
                if(adjacent && (t < 1e-8 || t > 1 - 1e-8) && (u < 1e-8 || u > 1 - 1e-8)) continue;
                a.times.push(t); b.times.push(u); a.cuts.push(t); b.cuts.push(u);
            }
        }
        for(const record of curves) {
            const times = record.times.sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i - 1] > 1e-8);
            for(let i = 1; i < times.length; i++) {
                const curve = record.curve.getPart(times[i - 1], times[i]);
                if(curve.length < 1e-7) continue;
                const edge: Edge = { id: this.edges.length, curve, ellipse: record.outline.ellipse, from: this.vertex(curve.point1), to: this.vertex(curve.point2),
                    cut: record.cuts.some(t => Math.abs(t - times[i]) < 1e-8) };
                this.edges.push(edge); record.outline.edges.push(edge);
            }
        }
        // Contacts cut both incident contours regardless of which way a touching line was drawn.
        const incident: Edge[][] = this.vertices.map(() => []);
        for(const edge of this.edges) { incident[edge.from].push(edge); incident[edge.to].push(edge); }
        for(const outline of this.outlines) {
            if(!outline.edges.length) continue;
            for(const [index, edge] of outline.edges.entries()) {
                const next = outline.edges[index + 1] ?? (outline.closed ? outline.edges[0] : undefined);
                if(incident[edge.to].some(other => other !== edge && other !== next)) edge.cut = true;
            }
            let run: Edge[] = [], runs: Edge[][] = [];
            for(const edge of outline.edges) { run.push(edge); if(edge.cut) { runs.push(run); run = []; } }
            if(run.length) {
                if(outline.closed && runs.length) runs[0] = [...run, ...runs[0]]; else runs.push(run);
            }
            for(const edges of runs) this.spans.push({ source: outline.source, edges: new Set(edges.map(edge => edge.id)), data: paperPathData(this.path(edges, outline.closed && runs.length === 1 && !edges.some(edge => edge.cut))) });
        }
        this.buildRegions();
    }
    private vertex(point: Position): number {
        const index = this.vertices.findIndex(p => Math.hypot(p.x - point.x, p.y - point.y) < 1e-6);
        if(index >= 0) return index;
        return this.vertices.push({ x: point.x, y: point.y }) - 1;
    }
    private path(edges: Edge[], closed: boolean, reverse?: boolean[], compact = true): paper.Path {
        const path = new this.scope.Path({ insert: false });
        for(let index = 0; index < edges.length; index++) {
            const edge = edges[index];
            const curve = reverse?.[index] ? edge.curve.reversed() : edge.curve;
            if(!index) path.moveTo(curve.point1);
            if(compact && edge.ellipse) {
                const ellipse = edge.ellipse, { center, axisX: a, axisY: b } = ellipse;
                const angle = (p: Position) => {
                    const x = p.x - center.x, y = p.y - center.y, det = a.x * b.y - a.y * b.x;
                    return Math.atan2((a.x * y - a.y * x) / det, (x * b.y - y * b.x) / det);
                };
                const start = angle(curve.point1); let delta = 0, last = curve;
                do {
                    last = reverse?.[index] ? edges[index].curve.reversed() : edges[index].curve;
                    const step = angle(last.point2) - angle(last.point1);
                    delta += Math.atan2(Math.sin(step), Math.cos(step));
                    index++;
                } while(index < edges.length && edges[index].ellipse === ellipse && !!reverse?.[index] === !!reverse?.[index - 1]);
                index--;
                for(const arc of ellipseArcToCubics(center, a, b, start, delta, () => 'construction', { id: 'end', x: last.point2.x, y: last.point2.y })) {
                    path.cubicCurveTo([arc.controlStart.x, arc.controlStart.y], [arc.controlEnd.x, arc.controlEnd.y], [arc.end.x, arc.end.y]);
                }
                continue;
            }
            path.cubicCurveTo(curve.point1.add(curve.handle1), curve.point2.add(curve.handle2), curve.point2);
        }
        if(closed) path.closePath();
        return path;
    }
    private buildRegions(): void {
        type Half = { edge: Edge; from: number; to: number; reverse: boolean; twin: Half; angle: number; visited?: boolean };
        const outgoing: Half[][] = this.vertices.map(() => []), halves: Half[] = [];
        const unique: Edge[] = [];
        for(const edge of this.edges) {
            if(unique.some(other => ((other.from === edge.from && other.to === edge.to) || (other.to === edge.from && other.from === edge.to)) &&
                [0.25, 0.5, 0.75].every(t => other.curve.getNearestLocation(edge.curve.getPointAtTime(t)).distance < 1e-6))) continue;
            unique.push(edge);
            const pair = [false, true].map(reverse => {
                const curve = reverse ? edge.curve.reversed() : edge.curve;
                // A point just inside the span disambiguates tangent contacts with equal first derivatives.
                const direction = curve.getPointAtTime(.0001).subtract(curve.point1);
                return { edge, from: reverse ? edge.to : edge.from, to: reverse ? edge.from : edge.to, reverse,
                    angle: Math.atan2(direction.y, direction.x) } as Half;
            });
            pair[0].twin = pair[1]; pair[1].twin = pair[0];
            pair.forEach(half => { outgoing[half.from].push(half); halves.push(half); });
        }
        outgoing.forEach(list => list.sort((a, b) => a.angle - b.angle));
        const faces: paper.Path[] = [], editableFaces: paper.Path[] = [];
        for(const first of halves) {
            if(first.visited) continue;
            const cycle: Half[] = []; let current = first;
            while(!current.visited) {
                current.visited = true; cycle.push(current);
                const choices = outgoing[current.to], index = choices.indexOf(current.twin);
                current = choices[(index - 1 + choices.length) % choices.length];
            }
            if(current !== first) continue;
            // Remove dangling excursions, which otherwise duplicate an edge in a face boundary.
            const cycleSet = new Set(cycle);
            const boundary = cycle.filter(half => !cycleSet.has(half.twin));
            if(!boundary.length) continue;
            const remaining = new Set(boundary);
            for(const start of boundary) {
                if(!remaining.has(start)) continue;
                const loop: Half[] = []; let half: Half | undefined = start;
                while(half && remaining.has(half)) {
                    remaining.delete(half); loop.push(half);
                    if(half.to === start.from) break;
                    const vertex: number = half.to;
                    half = boundary.find(next => remaining.has(next) && next.from === vertex);
                }
                if(loop.at(-1)?.to !== start.from) continue;
                const edges = loop.map(half => half.edge), reverse = loop.map(half => half.reverse);
                const path = this.path(edges, true, reverse, false);
                if(path.area > 1e-7) { faces.push(path); editableFaces.push(this.path(edges, true, reverse)); }
            }
        }
        // Disconnected nested outlines produce holes in their immediate enclosing face.
        const parents = faces.map(face => faces.filter(other => other !== face && other.area > face.area + 1e-7 && other.contains(face.interiorPoint)).sort((a, b) => a.area - b.area)[0]);
        faces.forEach((face, index) => {
            const holes = faces.filter((_, child) => parents[child] === face);
            const item = new this.scope.CompoundPath({ insert: false, fillRule: 'evenodd' });
            item.addChild(face.clone({ insert: false }));
            holes.forEach(hole => item.addChild(hole.clone({ insert: false })));
            const data = [editableFaces[index], ...holes.map(hole => editableFaces[faces.indexOf(hole)])].map(path => paperPathData(path)).join(' ');
            this.regions.push({ item, data, area: face.area - holes.reduce((area, hole) => area + hole.area, 0) });
        });
    }
}
