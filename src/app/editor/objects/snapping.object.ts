import { SVG } from "./svg.object";
import { Point } from "./point.object";

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

    const threshold = 6 / Math.max(0.01, svg.zoom || 1);
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
