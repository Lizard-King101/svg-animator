import { Component } from "@angular/core";
import { EditorService } from "../../_services/editor.service";
import { localBounds, resolvedOrigin } from "../../editor/objects/element-bounds";
import { Path } from "../../editor/objects/elements/path.object";
import { Line } from "../../editor/objects/line.object";
import { combinedMotionAdjustedMatrixFor } from "../../editor/objects/motion-path.object";
import { Point } from "../../editor/objects/point.object";
import { AnyElement } from "../../editor/objects/svg.object";
import { applyMatrix, Bounds, matrixToSvg, transformedBounds } from "../../editor/objects/transform.object";
import { gradientGeometry, GradientGeometry } from "../../editor/objects/gradient-geometry";

@Component({
    selector: "[editorOverlay]",
    exportAs: "editorOverlay",
    standalone: true,
    template: "<ng-content />",
})
export class SVGEditorOverlayComponent {
    constructor(private editor: EditorService) {}

    asPath(element: unknown): Path | null { return element instanceof Path ? element : null; }

    screenPx(px: number): number {
        const zoom = Math.max(0.01, this.editor.selectedSVG?.zoom || 1);
        return px / Math.pow(zoom, 0.85);
    }

    screenDash(first: number, second: number): string {
        return `${this.screenPx(first)} ${this.screenPx(second)}`;
    }

    selectedTransform(element: AnyElement): string | null {
        return this.editor.selectedSVG
            ? matrixToSvg(combinedMotionAdjustedMatrixFor(this.editor.selectedSVG, element))
            : null;
    }

    selectionBox(element?: AnyElement): SelectionBox | null {
        if(!element || !this.editor.selectedSVG || !element.visible || element.locked) return null;
        const bounds = localBounds(element);
        const matrix = combinedMotionAdjustedMatrixFor(this.editor.selectedSVG, element);
        const origin = resolvedOrigin(element);
        const corners = {
            nw: applyMatrix(matrix, bounds.x, bounds.y),
            n: applyMatrix(matrix, bounds.x + bounds.width / 2, bounds.y),
            ne: applyMatrix(matrix, bounds.x + bounds.width, bounds.y),
            e: applyMatrix(matrix, bounds.x + bounds.width, bounds.y + bounds.height / 2),
            se: applyMatrix(matrix, bounds.x + bounds.width, bounds.y + bounds.height),
            s: applyMatrix(matrix, bounds.x + bounds.width / 2, bounds.y + bounds.height),
            sw: applyMatrix(matrix, bounds.x, bounds.y + bounds.height),
            w: applyMatrix(matrix, bounds.x, bounds.y + bounds.height / 2),
        };
        return {
            points: `${corners.nw.x},${corners.nw.y} ${corners.ne.x},${corners.ne.y} ${corners.se.x},${corners.se.y} ${corners.sw.x},${corners.sw.y}`,
            topCenter: corners.n,
            rotate: applyMatrix(matrix, bounds.x + bounds.width / 2, bounds.y - this.screenPx(34)),
            pivot: applyMatrix(matrix, origin.x, origin.y),
            handles: [
                { role: "nw", ...corners.nw }, { role: "n", ...corners.n }, { role: "ne", ...corners.ne },
                { role: "e", ...corners.e }, { role: "se", ...corners.se }, { role: "s", ...corners.s },
                { role: "sw", ...corners.sw }, { role: "w", ...corners.w },
            ],
            hitBounds: transformedBounds(bounds, matrix),
        };
    }

    pathAnchors(path: Path): Point[] {
        const anchors: Point[] = [];
        path.contours.flatMap((contour) => contour.lines).forEach((line) => line.points.forEach((point) => {
            if(!anchors.includes(point)) anchors.push(point);
        }));
        return anchors;
    }

    bezierSegments(path: Path): Line[] {
        return path.contours.flatMap((contour) => contour.lines)
            .filter((line) => line.type === "bezier" && !!line.controlStart && !!line.controlEnd && line.points.length >= 2);
    }

    completeSegments(path: Path): Line[] {
        return path.contours.flatMap((contour) => contour.lines).filter((line) => line.points.length >= 2);
    }

    segmentSelected(segment: Line): boolean {
        return this.editor.selectedPathLine === segment || this.editor.selectedPathLines.includes(segment);
    }

    segmentPath(path: Path, line: Line): string { return path.segmentRaw(line); }

    gradient(element?: AnyElement): GradientGeometry | null {
        return element ? gradientGeometry(element, this.editor.selectedGradientPaintKey) ?? null : null;
    }
}

interface SelectionBox {
    points: string;
    topCenter: { x: number; y: number };
    rotate: { x: number; y: number };
    pivot: { x: number; y: number };
    handles: Array<{ role: string; x: number; y: number }>;
    hitBounds: Bounds;
}
