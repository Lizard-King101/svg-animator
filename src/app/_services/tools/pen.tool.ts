import { tangentAlignedHandle } from '../../editor/objects/ellipse-geometry';
import { IconName } from "@fortawesome/fontawesome-svg-core";
import { Line } from "src/app/editor/objects/line.object";
import { Path } from "src/app/editor/objects/elements/path.object";
import { Point } from "src/app/editor/objects/point.object";
import { snapPoint, SNAP_ACQUIRE_PX } from "src/app/editor/objects/snapping.object";
import { EditorService } from "../editor.service";
import { Tool } from "./tool";
import { PointSnappingInteraction } from './point-snapping.interaction';
import { SVG } from '../../editor/objects/svg.object';
import { applyDrawingPaint } from '../../editor/objects/drawing-paint';
import { clonePaint } from '../../editor/objects/paint.object';

export class PenTool extends Tool{
    override readonly preferenceKey = 'pen';
    override readonly label = 'Bézier / Pen';
    override icon: IconName = 'pen-fancy';

    workingLine?: Line;
    pendingPoint?: Point;
    suppressClick: boolean = false;
    draggingBezier: boolean = false;

    tmpPath?:Path;
    private snapping: PointSnappingInteraction;
    private snapReady = false;
    private snapDocument?: SVG;
    private lastPointer?: MouseEvent;
    private pendingPointer?: Point;
    private handlePointer?: MouseEvent;
    private straightOrigin?: Point;
    private pendingAnchor?: Point;
    private ellipseCaptured = false;
    get pointSnapFeedback() { return this.snapping.feedback; }

    constructor(private _editor: EditorService, parentTool?: Tool) {
        super(_editor, parentTool);
        this.snapping = new PointSnappingInteraction(_editor);
    }

    private mirroredHandle(anchor: Point, handle: Point) {
        return anchor.add(anchor.subtract(handle));
    }

    private eventPoint(event: MouseEvent, placement = true): Point {
        const point = this._editor.toCanvasPoint(event.clientX, event.clientY);
        if(placement) {
            if(!this.snapReady || this.snapDocument !== this._editor.selectedSVG) this.refreshTargets();
            this.lastPointer = event;
            const snapped = this.snapping.update(point, event.altKey || event.ctrlKey || event.metaKey);
            this.updateStraightOrigin();
            return snapped;
        }
        return snapPoint(this._editor.selectedSVG, point, {
            guides: true,
            ignore: !this._editor.objectSnapping || event.altKey || event.ctrlKey || event.metaKey,
        }).point;
    }

    private updateStraightOrigin(): void {
        const path = this._editor.activeElement, start = this.workingLine?.points[0];
        if(!(path instanceof Path) || path.lines.length !== 1 || !start || this.workingLine?.controlStart) return;
        this.straightOrigin ??= new Point(start.x, start.y);
        const origin = this.snapping.feedback?.target?.origin ?? this.straightOrigin;
        start.x = origin.x; start.y = origin.y;
    }

    private restoreStraightOrigin(): void {
        const start = this.workingLine?.points[0];
        if(this.straightOrigin && start && this.workingLine!.points.length === 1) {
            start.x = this.straightOrigin.x; start.y = this.straightOrigin.y;
        }
        this.straightOrigin = undefined;
    }

    private refreshTargets(curveEndpoint = !!this.workingLine?.controlStart): void {
        const path = this._editor.activeElement;
        const start = this.workingLine?.points[0];
        this.snapping.begin(path instanceof Path && start ? { path, points: new Set([start]) } : undefined,
            curveEndpoint ? undefined : start, curveEndpoint, path instanceof Path && path.lines.length === 1);
        this.snapDocument = this._editor.selectedSVG;
        this.snapReady = !!this.snapDocument;
    }

    private clearSnapping(): void { this.snapping.clear(); this.snapReady = false; this.snapDocument = undefined; this.lastPointer = undefined; }

    private refreshBypass(altKey: boolean): void {
        const event = this.lastPointer;
        if(this.pendingPoint && this.handlePointer) {
            this.updateDraggedCurve(this.handlePointer, altKey);
            return;
        }
        if(!event || this.pendingPoint) return;
        const point = this.snapping.update(this._editor.toCanvasPoint(event.clientX, event.clientY), altKey || event.ctrlKey || event.metaKey);
        this.updateStraightOrigin();
        if(this.workingLine) this.updatePreviewSegment(this.workingLine.points[0], point);
    }

    private curveHandle(end: Point, handle: Point): Point {
        const tangent = this.snapping.feedback?.target?.tangent;
        const aligned = tangent ? tangentAlignedHandle(end, handle, tangent) : handle;
        return new Point(aligned.x, aligned.y);
    }

    private updateDraggedCurve(event: MouseEvent, bypass = event.altKey || !!this._editor.keysDown['Alt']): void {
        if(!this.pendingPointer || !this.workingLine) return;
        this.handlePointer = event;
        const raw = this._editor.toCanvasPoint(this.pendingPointer.x, this.pendingPointer.y);
        const snapped = this.snapping.update(raw, bypass || event.ctrlKey || event.metaKey);
        if(this.snapping.feedback?.target?.tangent) { this.ellipseCaptured = true; this.pendingPoint = snapped; }
        else { this.pendingPoint = this.ellipseCaptured ? raw : this.pendingAnchor ?? snapped; this.snapping.clearFeedback(); }
        this.updateStraightOrigin();
        this.updatePreviewSegment(this.workingLine.points[0], this.pendingPoint, this.eventPoint(event, false));
    }

    private updateBezierSegment(line: Line, start: Point, end: Point, handle: Point) {
        line.type = 'bezier';
        line.points = [start, end];
        line.controlStart = line.controlStart ?? start.add(0,0);
        line.controlEnd = this.curveHandle(end, handle);
    }

    private updatePreviewSegment(start: Point, end: Point, handle?: Point) {
        if(!this.tmpPath?.lines[0]) {
            return;
        }

        const previewLine = this.tmpPath.lines[0];
        if(handle || this.workingLine?.controlStart) {
            previewLine.controlStart = this.workingLine?.controlStart;
            const incoming = handle ?? (this.snapping.feedback?.target?.tangent
                ? new Point(end.x + (start.x - end.x) / 3, end.y + (start.y - end.y) / 3) : end);
            this.updateBezierSegment(previewLine, start, end, incoming);
            return;
        }

        previewLine.type = 'line';
        previewLine.points = [start, end];
        previewLine.controlStart = undefined;
        previewLine.controlEnd = undefined;
    }

    override click(event: MouseEvent) {
        if(this.suppressClick) {
            this.suppressClick = false;
            return;
        }

        if(this._editor.selectedSVG) {
            let point = this.eventPoint(event);
            if(this._editor.activeElement instanceof Path && this._editor.activeElement.closed) {
                this._editor.activeElement = undefined;
            }

            if(this._editor.activeElement == undefined) {
                let path = new Path(this._editor);
                applyDrawingPaint(path.settings, this._editor.drawingPaint, false);
                let line = new Line(this._editor);
                line.points.push(point);
                path.lines.push(line);

                this.tmpPath = new Path(this._editor);
                this.tmpPath.settings.stroke = clonePaint(path.settings.stroke);
                let tmpLine = new Line(this._editor, {points: [point, point.add(0,0)]});
                this.tmpPath.lines.push(tmpLine);
                this._editor.selectedSVG.tempElements.push(this.tmpPath);

                this._editor.activeElement = path;
                this._editor.selectedElement = undefined;
                this.workingLine = line;
                this._editor.selectedSVG.elements.push(path);
            } else {
                if(this.workingLine && this._editor.activeElement instanceof Path) {
                    let activePath = this._editor.activeElement;
                    let distance = activePath.lines[0].points[0].distanceFrom(point);
                    const tolerance = this._editor.objectSnapping && !(event.altKey || event.ctrlKey || event.metaKey)
                        ? SNAP_ACQUIRE_PX / Math.max(.01, this._editor.selectedSVG.zoom) : .000001;
                    if(activePath.lines.length >= 2 && distance <= tolerance) {
                        this.workingLine.points.push(activePath.lines[0].points[0]);
                        if(this.workingLine.controlStart) {
                            this.workingLine.type = 'bezier';
                            this.workingLine.controlEnd = activePath.lines[0].points[0].add(0,0);
                        }
                        activePath.closed = true;
                        activePath.settings.fill_enabled = activePath.settings.fill !== null;
                        this.tmpPath?.destroy();
                        this.tmpPath = undefined;
                        this._editor.selectedElement = activePath;
                        this._editor.activeElement = undefined;
                        this.workingLine = undefined;
                    } else {
                        this.workingLine.points.push(point);
                        if(this.workingLine.controlStart) {
                            this.workingLine.type = 'bezier';
                            this.workingLine.controlEnd = this.curveHandle(point, this.snapping.feedback?.target?.tangent
                                ? new Point(point.x + (this.workingLine.points[0].x - point.x) / 3, point.y + (this.workingLine.points[0].y - point.y) / 3) : point);
                        }

                        let line = new Line(this._editor, {points: [point]});
                        if(this.workingLine.type == 'bezier' && this.workingLine.controlEnd && !this._editor.keysDown['Alt']) {
                            line.type = 'bezier';
                            line.controlStart = this.mirroredHandle(point, this.workingLine.controlEnd);
                        }

                        this.workingLine = line;
                        this.updatePreviewSegment(point, point.add(0,0));
                        activePath.lines.push(line);
                    }
                }
            }

            this.clearSnapping();
            this.straightOrigin = undefined;
        }
    }

    override onselect() {
        super.onselect();
        this.clearSnapping();
        if(this._editor.activeElement instanceof Path && !this._editor.activeElement.closed && this._editor.selectedSVG) {
            let line = this._editor.activeElement.lines[this._editor.activeElement.lines.length - 1];
            let point = line.points[0];
            this.workingLine = line;
            this.tmpPath = new Path(this._editor);
            this.tmpPath.settings.stroke = clonePaint(this._editor.activeElement.settings.stroke);
            this.tmpPath.settings.stroke_width = this._editor.activeElement.settings.stroke_width;
            this.tmpPath.lines.push(new Line(this._editor, {
                type: line.type,
                points: [point, point.add(0,0)],
                controlStart: line.controlStart,
                controlEnd: line.controlEnd,
            }));
            this._editor.selectedSVG.tempElements.push(this.tmpPath);
        }
        return true;
    }

    override down(event: MouseEvent) {
        this.suppressClick = false;
        this.pendingPointer = new Point(event.clientX, event.clientY);
        if(this._editor.activeElement instanceof Path && this.workingLine) {
            this.pendingPoint = this.eventPoint(event);
            this.pendingAnchor = this.pendingPoint;
            this.ellipseCaptured = !!this.snapping.feedback?.target?.tangent;
            this.draggingBezier = false;
        }
    }

    override up(event: MouseEvent) {
        if(
            this.draggingBezier &&
            this.pendingPoint &&
            this.workingLine &&
            this._editor.activeElement instanceof Path
        ) {
            this.updateDraggedCurve(event);
            const handlePoint = this.curveHandle(this.pendingPoint, this.eventPoint(event, false));
            const activePath = this._editor.activeElement;

            this.updateBezierSegment(this.workingLine, this.workingLine.points[0], this.pendingPoint, handlePoint);

            const nextLine = new Line(this._editor, {points: [this.pendingPoint]});
            if(!this._editor.keysDown['Alt']) {
                nextLine.type = 'bezier';
                nextLine.controlStart = this.mirroredHandle(this.pendingPoint, handlePoint);
            }
            this.workingLine = nextLine;
            activePath.lines.push(nextLine);
            this.updatePreviewSegment(this.pendingPoint, this.pendingPoint.add(0,0), this.pendingPoint.add(0,0));
            this.suppressClick = true;
            this.clearSnapping();
        }

        this.pendingPoint = undefined;
        this.pendingPointer = undefined;
        this.handlePointer = undefined;
        this.pendingAnchor = undefined;
        this.ellipseCaptured = false;
        if(this.draggingBezier) this.straightOrigin = undefined;
        this.draggingBezier = false;
        // An ordinary click follows mouseup. Keep its captured target until click commits it.
    }

    private finishPath() {
        this.clearSnapping();
        this.pendingPointer = undefined;
        this.handlePointer = undefined;
        this.pendingAnchor = undefined;
        this.ellipseCaptured = false;
        this.straightOrigin = undefined;
        if(!(this._editor.activeElement instanceof Path)) return;
        const activePath = this._editor.activeElement;

        // Need at least one complete segment; workingLine always sits at the end
        // with only its start point, so pop it off before finalising.
        if(activePath.lines.length >= 2) {
            activePath.lines.pop();
            this._editor.selectedElement = activePath;
        } else {
            // Only one point placed — nothing worth keeping.
            activePath.destroy();
        }

        this.tmpPath?.destroy();
        this.tmpPath = undefined;
        this._editor.activeElement = undefined;
        this.workingLine = undefined;
        this.pendingPoint = undefined;
        this.draggingBezier = false;
        this.suppressClick = false;
    }

    override contextMenu(_event: MouseEvent) {
        this.finishPath();
    }

    override keyPressed(key: string) {
        if(key === 'Alt') this.refreshBypass(true);
        switch(key) {
            case 'Escape':
                this.clearSnapping();
                this.pendingPointer = undefined;
                this.handlePointer = undefined;
                this.pendingAnchor = undefined;
                this.ellipseCaptured = false;
                this.straightOrigin = undefined;
                if(this._editor.activeElement instanceof Path) {
                    this._editor.activeElement.destroy();
                }
                this._editor.activeElement = undefined;
                this.tmpPath?.destroy();
                this.tmpPath = undefined;
                this.workingLine = undefined;
                this.pendingPoint = undefined;
                this.draggingBezier = false;
                this.suppressClick = false;
                break;
        }
    }

    override drag(event: MouseEvent) {
        if(this.pendingPoint && this.workingLine && this._editor.activeElement instanceof Path) {
            if(this.pendingPointer && Math.hypot(event.clientX - this.pendingPointer.x, event.clientY - this.pendingPointer.y) > 2) {
                if(!this.draggingBezier) this.refreshTargets(true);
                this.draggingBezier = true;
                this.updateDraggedCurve(event);
            }
            return;
        }

        const point = this.eventPoint(event);
        if(this.workingLine) this.updatePreviewSegment(this.workingLine.points[0], point);
    }

    override keyReleased(key: string): void { if(key === 'Alt') this.refreshBypass(false); }

    override reset() {
        this.restoreStraightOrigin();
        this.clearSnapping();
        this.suppressClick = !!this.pendingPointer;
        if(this._editor.activeElement instanceof Path && this.workingLine && this._editor.selectedSVG?.elements.includes(this._editor.activeElement)) {
            const start = this.workingLine.points[0];
            this.updatePreviewSegment(start, start.add(0, 0));
        } else this.workingLine = undefined;
        this.pendingPoint = undefined;
        this.pendingPointer = undefined;
        this.handlePointer = undefined;
        this.pendingAnchor = undefined;
        this.ellipseCaptured = false;
        this.straightOrigin = undefined;
        this.draggingBezier = false;
    }

    override leave(): void { if(!this.pendingPoint) this.clearSnapping(); }

    override deselect(): void {
        this.restoreStraightOrigin();
        this.clearSnapping();
        this.pendingPointer = undefined;
        this.handlePointer = undefined;
        this.pendingAnchor = undefined;
        this.ellipseCaptured = false;
        this.straightOrigin = undefined;
        super.deselect();
        this.tmpPath?.destroy();
        this.tmpPath = undefined;
        this.workingLine = undefined;
        this.pendingPoint = undefined;
        this.draggingBezier = false;
        this.suppressClick = false;
    }
}
