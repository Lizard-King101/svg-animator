import { NgFor, NgIf } from "@angular/common";
import { Component, HostBinding, Input } from "@angular/core";
import { EditorService } from "../../_services/editor.service";
import { canvasToWorkspaceProjection } from "../../editor/canvas-workspace-projection";
import { localBounds, resolvedOrigin } from "../../editor/objects/element-bounds";
import { Path } from "../../editor/objects/elements/path.object";
import { gradientGeometry, GradientGeometry } from "../../editor/objects/gradient-geometry";
import { Line } from "../../editor/objects/line.object";
import { combinedMotionAdjustedMatrixFor } from "../../editor/objects/motion-path.object";
import { Point } from "../../editor/objects/point.object";
import { AnyElement } from "../../editor/objects/svg.object";
import { applyMatrix, Bounds, Matrix, matrixToSvg, multiplyMatrix, transformedBounds } from "../../editor/objects/transform.object";
import type { CanvasWorkspaceComponent } from "../canvas-workspace/canvas-workspace.component";

@Component({
    selector: "svg[editorOverlay]",
    standalone: true,
    imports: [NgFor, NgIf],
    templateUrl: "svg-editor-overlay.component.html",
})
export class SVGEditorOverlayComponent {
    @Input({ required: true }) artwork?: SVGElement;
    @Input({ required: true }) workspace?: CanvasWorkspaceComponent;

    @HostBinding("class.editor-overlay") readonly overlayClass = true;
    @HostBinding("attr.width") readonly width = "100%";
    @HostBinding("attr.height") readonly height = "100%";

    constructor(public editor: EditorService) {}

    asPath(element: unknown): Path | null { return element instanceof Path ? element : null; }

    screenPx(px: number): number { return px; }
    screenDash(first: number, second: number): string { return `${first} ${second}`; }

    projectedTransform(element: AnyElement): string | null {
        const matrix = this.elementToWorkspaceMatrix(element);
        return matrix ? matrixToSvg(matrix) : null;
    }

    selectionBox(element?: AnyElement): SelectionBox | null {
        const matrix = element ? this.elementToWorkspaceMatrix(element) : undefined;
        if(!element || !matrix || !element.visible || element.locked) return null;
        const bounds = localBounds(element);
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
        const center = applyMatrix(matrix, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return {
            points: `${corners.nw.x},${corners.nw.y} ${corners.ne.x},${corners.ne.y} ${corners.se.x},${corners.se.y} ${corners.sw.x},${corners.sw.y}`,
            topCenter: corners.n,
            rotate: rotationHandle(corners.nw, corners.ne, corners.n, center, 34),
            pivot: applyMatrix(matrix, origin.x, origin.y),
            handles: [
                { role: "nw", ...corners.nw }, { role: "n", ...corners.n }, { role: "ne", ...corners.ne },
                { role: "e", ...corners.e }, { role: "se", ...corners.se }, { role: "s", ...corners.s },
                { role: "sw", ...corners.sw }, { role: "w", ...corners.w },
            ].filter((handle) => (bounds.width > 0.000001 || !/[ew]/.test(handle.role))
                && (bounds.height > 0.000001 || !/[ns]/.test(handle.role))),
            hitBounds: transformedBounds(bounds, matrix),
        };
    }

    pathAnchors(path: Path): ProjectedPoint[] {
        const matrix = this.elementToWorkspaceMatrix(path);
        if(!matrix) return [];
        const anchors: Point[] = [];
        path.contours.flatMap((contour) => contour.lines).forEach((line) => line.points.forEach((point) => {
            if(!anchors.includes(point)) anchors.push(point);
        }));
        return anchors.map((point) => ({ point, ...applyMatrix(matrix, point.x, point.y) }));
    }

    bezierSegments(path: Path): ProjectedBezierSegment[] {
        const matrix = this.elementToWorkspaceMatrix(path);
        if(!matrix) return [];
        return path.contours.flatMap((contour) => contour.lines)
            .filter((line) => line.type === "bezier" && !!line.controlStart && !!line.controlEnd && line.points.length >= 2)
            .map((line) => ({
                line,
                start: applyMatrix(matrix, line.points[0].x, line.points[0].y),
                end: applyMatrix(matrix, line.points[1].x, line.points[1].y),
                controlStart: applyMatrix(matrix, line.controlStart!.x, line.controlStart!.y),
                controlEnd: applyMatrix(matrix, line.controlEnd!.x, line.controlEnd!.y),
            }));
    }

    completeSegments(path: Path): Line[] {
        return path.contours.flatMap((contour) => contour.lines).filter((line) => line.points.length >= 2);
    }

    segmentSelected(segment: Line): boolean {
        return this.editor.selectedPathLine === segment || this.editor.selectedPathLines.includes(segment);
    }

    segmentPath(path: Path, line: Line): string { return path.segmentRaw(line); }

    gradient(element?: AnyElement): GradientGeometry | null {
        const matrix = element ? this.elementToWorkspaceMatrix(element) : undefined;
        if(!element || !matrix) return null;
        const geometry = gradientGeometry(element, this.editor.selectedGradientPaintKey);
        if(!geometry) return null;
        const project = (point?: { x: number; y: number }) => point ? applyMatrix(matrix, point.x, point.y) : undefined;
        return {
            ...geometry,
            start: project(geometry.start),
            end: project(geometry.end),
            center: project(geometry.center),
            radius: project(geometry.radius),
            focal: project(geometry.focal),
        };
    }

    private elementToWorkspaceMatrix(element: AnyElement): Matrix | undefined {
        const svg = this.editor.selectedSVG;
        const artwork = this.artwork;
        const workspace = this.workspace?.element;
        if(!svg || !artwork || !workspace) return undefined;
        const projection = canvasToWorkspaceProjection(
            artwork.getBoundingClientRect(),
            workspace.getBoundingClientRect(),
            { x: 0, y: 0, width: svg.width, height: svg.height },
        );
        return multiplyMatrix(projection.canvasToWorkspace, combinedMotionAdjustedMatrixFor(svg, element));
    }
}

export interface SelectionBox {
    points: string;
    topCenter: { x: number; y: number };
    rotate: { x: number; y: number };
    pivot: { x: number; y: number };
    handles: Array<{ role: string; x: number; y: number }>;
    hitBounds: Bounds;
}

export interface ProjectedPoint {
    point: Point;
    x: number;
    y: number;
}

export interface ProjectedBezierSegment {
    line: Line;
    start: { x: number; y: number };
    end: { x: number; y: number };
    controlStart: { x: number; y: number };
    controlEnd: { x: number; y: number };
}

function rotationHandle(
    topLeft: { x: number; y: number },
    topRight: { x: number; y: number },
    topCenter: { x: number; y: number },
    center: { x: number; y: number },
    distance: number,
): { x: number; y: number } {
    const edgeX = topRight.x - topLeft.x;
    const edgeY = topRight.y - topLeft.y;
    const length = Math.hypot(edgeX, edgeY);
    if(length < 0.000001) return { x: topCenter.x, y: topCenter.y - distance };
    let normalX = -edgeY / length;
    let normalY = edgeX / length;
    const awayX = topCenter.x - center.x;
    const awayY = topCenter.y - center.y;
    if(normalX * awayX + normalY * awayY < 0) {
        normalX *= -1;
        normalY *= -1;
    }
    return { x: topCenter.x + normalX * distance, y: topCenter.y + normalY * distance };
}
