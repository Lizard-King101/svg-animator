import { ConstructionTool } from '../../_services/tools/construction.tool';
import { NgFor, NgIf } from "@angular/common";
import { Component, HostBinding, Input } from "@angular/core";
import { EditorService } from "../../_services/editor.service";
import { canvasToWorkspaceProjection, canvasViewProjection } from "../../editor/canvas-workspace-projection";
import { localBounds, resolvedOrigin } from "../../editor/objects/element-bounds";
import { Path } from "../../editor/objects/elements/path.object";
import { gradientGeometry, GradientGeometry } from "../../editor/objects/gradient-geometry";
import { Line } from "../../editor/objects/line.object";
import { combinedMotionAdjustedMatrixFor } from "../../editor/objects/motion-path.object";
import { Point } from "../../editor/objects/point.object";
import { AnyElement } from "../../editor/objects/svg.object";
import { applyMatrix, Bounds, Matrix, matrixToSvg, multiplyMatrix, transformedBounds } from "../../editor/objects/transform.object";
import type { CanvasWorkspaceComponent } from "../canvas-workspace/canvas-workspace.component";
import { SelectTool } from "../../_services/tools/select.tool";
import { selectionFrame, selectionRoots } from "../../editor/selection";
import { CropTool } from "../../_services/tools/crop.tool";
import { SnapFeedbackOverlayComponent, projectMoveSnapFeedback, projectPointSnapFeedback, projectEdgeRotationFeedback } from '../snap-feedback-overlay/snap-feedback-overlay.component';
import { PenTool } from '../../_services/tools/pen.tool';

@Component({
    selector: "svg[editorOverlay]",
    standalone: true,
    imports: [NgFor, NgIf, SnapFeedbackOverlayComponent],
    templateUrl: "svg-editor-overlay.component.html",
    styleUrl: "svg-editor-overlay.component.scss",
})
export class SVGEditorOverlayComponent {
    @Input({ required: true }) artwork?: SVGElement;
    @Input({ required: true }) workspace?: CanvasWorkspaceComponent;

    @HostBinding("class.editor-overlay") readonly overlayClass = true;
    @HostBinding("attr.width") readonly width = "100%";
    @HostBinding("attr.height") readonly height = "100%";
    @HostBinding("style.visibility") get visibility(): string | null {
        return this.editor.selectedTool instanceof CropTool ? "hidden" : null;
    }

    constructor(public editor: EditorService) {}

    get editableElement(): AnyElement | undefined {
        if(this.editor.selectedTool && !(this.editor.selectedTool instanceof SelectTool)) return undefined;
        const element = this.editor.selectedElement;
        const svg = this.editor.selectedSVG;
        return element && svg && selectionRoots(svg, [element]).length ? element : undefined;
    }

    asPath(element: unknown): Path | null { return element instanceof Path ? element : null; }

    /** Authoring guides stay visible independently of the path's eventual fill/stroke. */
    drawingPath() {
        const pen = this.editor.activeTool, path = this.editor.activeElement, svg = this.editor.selectedSVG;
        if(!(pen instanceof PenTool) || !(path instanceof Path) || path.closed || !svg) return undefined;
        const start = path.lines[0]?.points[0]; if(!start) return undefined;
        const matrix = multiplyMatrix(canvasViewProjection(svg).canvasToWorkspace, combinedMotionAdjustedMatrixFor(svg, path));
        return { data: path.raw, preview: pen.tmpPath?.raw ?? '', transform: matrixToSvg(matrix), start: applyMatrix(matrix, start.x, start.y) };
    }

    screenPx(px: number): number { return px; }
    screenDash(first: number, second: number): string { return `${first} ${second}`; }

    projectedTransform(element: AnyElement): string | null {
        const matrix = this.elementToWorkspaceMatrix(element);
        return matrix ? matrixToSvg(matrix) : null;
    }

    selectionBox(element?: AnyElement): SelectionBox | null {
        const matrix = element ? this.elementToWorkspaceMatrix(element) : undefined;
        if(!element || !matrix || !element.visible || element.locked) return null;
        if(this.editor.selectedSVG && !selectionRoots(this.editor.selectedSVG, [element]).length) return null;
        const bounds = localBounds(element);
        const origin = resolvedOrigin(element);
        return projectSelectionBox(bounds, origin, matrix);
    }

    selectedBox(): SelectionBox | null {
        if(this.editor.selectedTool && !(this.editor.selectedTool instanceof SelectTool)) return null;
        if((this.editor.selectedElements?.length ?? 0) < 2) return this.selectionBox(this.editor.selectedElement);
        const svg = this.editor.selectedSVG;
        const projection = this.canvasToWorkspaceMatrix();
        const frame = svg && selectionFrame(svg, this.editor.selectedElements);
        if(!frame || !projection) return null;
        const bounds = frame.bounds;
        const box = projectSelectionBox(bounds, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
            multiplyMatrix(projection, frame.matrix));
        box.handles = frame.canTransform ? box.handles.filter((handle) => handle.role.length === 2) : [];
        box.showOrigin = false;
        box.canRotate = frame.canTransform && frame.canRotate;
        box.canMove = frame.canTransform;
        box.multiple = true;
        return box;
    }

    selectionOutlines(): SelectionBox[] {
        return (this.editor.selectedElements?.length ?? 0) > 1
            ? this.editor.selectedElements.map((element) => this.selectionBox(element)).filter((box): box is SelectionBox => !!box) : [];
    }

    marqueeBox(): Bounds | undefined {
        const bounds = this.editor.selectedTool instanceof SelectTool ? this.editor.selectedTool.marqueeBounds : undefined;
        const matrix = this.canvasToWorkspaceMatrix();
        return bounds && matrix ? transformedBounds(bounds, matrix) : undefined;
    }

    snapDisplay() {
        if(!this.editor.objectSnapping) return undefined;
        const tool = this.editor.selectedTool;
        const feedback = tool instanceof SelectTool ? tool.snapFeedback : undefined;
        const rotation = tool instanceof SelectTool ? tool.rotationSnapFeedback : undefined;
        const active = tool?.selectedChild ?? tool;
        const point = active instanceof SelectTool || active instanceof PenTool || active instanceof ConstructionTool
            ? active.pointSnapFeedback : undefined;
        const matrix = this.canvasToWorkspaceMatrix();
        const viewport = this.workspace?.element.getBoundingClientRect();
        if(!matrix || !viewport) return undefined;
        // Leave room for the rulers so feedback stays readable near workspace edges.
        const bounds = { x: 24, y: 24, width: viewport.width - 24, height: viewport.height - 24 };
        return rotation ? projectEdgeRotationFeedback(rotation, matrix, bounds)
            : point ? projectPointSnapFeedback(point, matrix, bounds) : feedback ? projectMoveSnapFeedback(feedback, matrix, bounds) : undefined;
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

    // Projection objects are recreated each check. Keep their DOM targets alive
    // so pointerdown's target still receives the browser's following mousedown.
    trackAnchor(_index: number, anchor: ProjectedPoint): string { return anchor.point.id; }
    trackBezierSegment(_index: number, segment: ProjectedBezierSegment): string { return segment.line.id; }
    trackTransformHandle(_index: number, handle: SelectionBox['handles'][number]): string { return handle.role; }

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
        const matrix = this.canvasToWorkspaceMatrix();
        const svg = this.editor.selectedSVG;
        return svg && matrix ? multiplyMatrix(matrix, combinedMotionAdjustedMatrixFor(svg, element)) : undefined;
    }

    private canvasToWorkspaceMatrix(): Matrix | undefined {
        const svg = this.editor.selectedSVG;
        const artwork = this.artwork;
        const workspace = this.workspace?.element;
        if(!svg || !artwork || !workspace) return undefined;
        return canvasToWorkspaceProjection(artwork.getBoundingClientRect(), workspace.getBoundingClientRect(),
            svg.canvasBounds ?? { x: 0, y: 0, width: svg.width, height: svg.height }).canvasToWorkspace;
    }
}

export interface SelectionBox {
    canMove: boolean;
    canRotate: boolean;
    showOrigin: boolean;
    multiple: boolean;
    points: string;
    topCenter: { x: number; y: number };
    rotate: { x: number; y: number };
    pivot: { x: number; y: number };
    handles: Array<{ role: string; x: number; y: number; cursor: string }>;
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

/** Resize cursors follow the projected axes, including parent transforms and reflection. */
function resizeCursor(matrix: Matrix, role: string): string {
    const x = role.includes("e") ? 1 : role.includes("w") ? -1 : 0;
    const y = role.includes("s") ? 1 : role.includes("n") ? -1 : 0;
    const angle = Math.atan2(matrix.b * x + matrix.d * y, matrix.a * x + matrix.c * y);
    const direction = ((Math.round(angle / (Math.PI / 4)) % 4) + 4) % 4;
    return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][direction];
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

function projectSelectionBox(bounds: Bounds, origin: { x: number; y: number }, matrix: Matrix): SelectionBox {
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
        canMove: true, canRotate: true, showOrigin: true, multiple: false,
        points: `${corners.nw.x},${corners.nw.y} ${corners.ne.x},${corners.ne.y} ${corners.se.x},${corners.se.y} ${corners.sw.x},${corners.sw.y}`,
        topCenter: corners.n,
        rotate: rotationHandle(corners.nw, corners.ne, corners.n, center, 34),
        pivot: applyMatrix(matrix, origin.x, origin.y),
        handles: [
            { role: "nw", ...corners.nw }, { role: "n", ...corners.n }, { role: "ne", ...corners.ne },
            { role: "e", ...corners.e }, { role: "se", ...corners.se }, { role: "s", ...corners.s },
            { role: "sw", ...corners.sw }, { role: "w", ...corners.w },
        ].filter((handle) => (bounds.width > 0.000001 || !/[ew]/.test(handle.role))
            && (bounds.height > 0.000001 || !/[ns]/.test(handle.role)))
            .map((handle) => ({ ...handle, cursor: resizeCursor(matrix, handle.role) })),
        hitBounds: transformedBounds(bounds, matrix),
    };
}
