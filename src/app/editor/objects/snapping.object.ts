import { AnyElement, SVG } from "./svg.object";
import { Point } from "./point.object";
import { arrangementBounds } from './arrangement-bounds';
import { Group } from './elements/group.object';
import { findElementChain } from './element-bounds';
import { Bounds, unionBounds } from './transform.object';

export const SNAP_ACQUIRE_PX = 6;
export const SNAP_RELEASE_PX = 10;

export interface SnapOptions {
    guides?: boolean;
    geometry?: boolean;
    ignore?: boolean;
}

export interface SnapHit {
    axis: "x" | "y";
    value: number;
    source: "guide" | "canvas" | "geometry";
}

export interface SnapResult {
    point: Point;
    x?: SnapHit;
    y?: SnapHit;
}

export function snapPoint(svg: SVG | undefined, point: Point, options: SnapOptions = {}): SnapResult {
    if(!svg || options.ignore) {
        return { point };
    }

    const threshold = SNAP_ACQUIRE_PX / Math.max(0.01, svg.zoom || 1);
    const result = new Point(point.x, point.y);
    let x = nearestGuide(svg, "x", point.x, threshold);
    let y = nearestGuide(svg, "y", point.y, threshold);

    if(options.guides !== false) {
        if(x) {
            result.x = x.value;
        }
        if(y) {
            result.y = y.value;
        }
    } else {
        x = undefined;
        y = undefined;
    }

    return {
        point: result,
        x,
        y,
    };
}

type SnapFeature = 'start' | 'center' | 'end';
export interface MoveSnapCandidate extends SnapHit {
    id: string;
    label: string;
    extent: [number, number];
    target?: Bounds;
}
export interface MoveSnapMatch {
    candidate: MoveSnapCandidate;
    feature: SnapFeature;
    correction: number;
}
export interface MoveSnapFeedback {
    bounds: Bounds;
    matches: MoveSnapMatch[];
}

/** Targets are frozen at pointer-down so the moving selection cannot chase its own ancestors. */
export function moveSnapCandidates(svg: SVG, moving: AnyElement[]): MoveSnapCandidate[] {
    const excluded = new Set(moving);
    const ancestors = new Set(moving.flatMap((element) => findElementChain(svg.elements, element)?.slice(0, -1) ?? []));
    const candidates: MoveSnapCandidate[] = [];
    const addBounds = (bounds: Bounds, id: string, name: string, source: 'canvas' | 'geometry') => {
        for(const axis of ['x', 'y'] as const) {
            features(bounds, axis).forEach(({ feature, value }) => candidates.push({
                id: `${id}:${axis}:${feature}`, axis, value, source,
                label: `${featureLabel(axis, feature)} · ${name}`,
                extent: axis === 'x' ? [bounds.y, bounds.y + bounds.height] : [bounds.x, bounds.x + bounds.width],
                target: source === 'geometry' ? bounds : undefined,
            }));
        }
    };
    svg.guides.forEach((guide) => candidates.push({
        id: `guide:${guide.id}`, axis: guide.axis, value: guide.value, source: 'guide', label: 'Guide',
        extent: guide.axis === 'x' ? [svg.canvasBounds.y, svg.canvasBounds.y + svg.height]
            : [svg.canvasBounds.x, svg.canvasBounds.x + svg.width],
    }));
    addBounds(svg.canvasBounds, 'canvas', 'Canvas', 'canvas');
    const visit = (elements: AnyElement[]) => elements.forEach((element) => {
        // Visible locked artwork is still a useful alignment reference.
        if(!element.visible || excluded.has(element)) return;
        if(!ancestors.has(element)) addBounds(arrangementBounds(svg, element), `object:${element.id}`, element.name, 'geometry');
        // A clipped composition acts as one target; hidden mask geometry must not attract a move.
        if(element instanceof Group && !element.clipElement) visit(element.elements);
    });
    visit(svg.elements);
    return candidates;
}

/** One gesture's axis locks and feedback. Deltas always refer to the original unsnapped position. */
export class MoveSnapSession {
    feedback?: MoveSnapFeedback;
    private locks: Partial<Record<'x' | 'y', MoveSnapMatch>> = {};
    constructor(private bounds: Bounds, private candidates: MoveSnapCandidate[]) {}

    update(delta: { x: number; y: number }, zoom: number, bypass = false): { x: number; y: number } {
        const scale = Math.max(.01, zoom || 1);
        if(bypass || Math.hypot(delta.x, delta.y) * scale < .01) {
            this.clear();
            return delta;
        }
        const proposed = { ...this.bounds, x: this.bounds.x + delta.x, y: this.bounds.y + delta.y };
        const matches: MoveSnapMatch[] = [];
        const result = { ...delta };
        for(const axis of ['x', 'y'] as const) {
            const anchors = features(proposed, axis);
            const previous = this.locks[axis];
            let match: MoveSnapMatch | undefined;
            if(previous) {
                const correction = previous.candidate.value - anchors.find((anchor) => anchor.feature === previous.feature)!.value;
                if(Math.abs(correction) * scale <= SNAP_RELEASE_PX) match = { ...previous, correction };
            }
            if(!match) {
                let bestDistance = Infinity;
                for(const candidate of this.candidates) {
                    if(candidate.axis !== axis) continue;
                    for(const anchor of anchors) {
                        const correction = candidate.value - anchor.value, distance = Math.abs(correction);
                        // Strict comparison preserves deterministic source/draw-order ties (guides first).
                        if(distance * scale <= SNAP_ACQUIRE_PX && distance < bestDistance - 1e-8) {
                            match = { candidate, feature: anchor.feature, correction };
                            bestDistance = distance;
                        }
                    }
                }
            }
            this.locks[axis] = match;
            if(match) { result[axis] += match.correction; matches.push(match); }
        }
        this.feedback = matches.length ? { bounds: { ...this.bounds, x: this.bounds.x + result.x, y: this.bounds.y + result.y }, matches } : undefined;
        return result;
    }

    clear(): void { this.locks = {}; this.feedback = undefined; }
}

export function movingSnapBounds(svg: SVG, moving: AnyElement[]): Bounds {
    return unionBounds(moving.map((element) => arrangementBounds(svg, element)));
}

function features(bounds: Bounds, axis: 'x' | 'y'): { feature: SnapFeature; value: number }[] {
    const start = bounds[axis], size = axis === 'x' ? bounds.width : bounds.height;
    return [{ feature: 'start', value: start }, { feature: 'center', value: start + size / 2 }, { feature: 'end', value: start + size }];
}

export function featureLabel(axis: 'x' | 'y', feature: SnapFeature): string {
    return feature === 'center' ? 'Center' : axis === 'x' ? (feature === 'start' ? 'Left' : 'Right') : (feature === 'start' ? 'Top' : 'Bottom');
}

function nearestGuide(svg: SVG, axis: "x" | "y", value: number, threshold: number): SnapHit | undefined {
    const candidates = svg.guides
        .filter((guide) => guide.axis === axis)
        .map((guide) => ({
            axis,
            value: guide.value,
            source: "guide" as const,
            distance: Math.abs(guide.value - value),
        }))
        .filter((guide) => guide.distance <= threshold)
        .sort((a, b) => a.distance - b.distance);

    return candidates[0]
        ? { axis, value: candidates[0].value, source: candidates[0].source }
        : undefined;
}
