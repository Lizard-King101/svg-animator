import { IconName } from "@fortawesome/fontawesome-svg-core";
import { Line } from "src/app/editor/objects/line.object";
import { Path } from "src/app/editor/objects/elements/path.object";
import { Point } from "src/app/editor/objects/point.object";
import { snapPoint } from "src/app/editor/objects/snapping.object";
import { EditorService } from "../editor.service";
import { Tool } from "./tool";

export class PenTool extends Tool{
    override icon: IconName = 'pen-fancy';

    workingLine?: Line;
    pendingPoint?: Point;
    suppressClick: boolean = false;
    draggingBezier: boolean = false;

    tmpPath?:Path;

    constructor(private _editor: EditorService) {
        super(_editor);
    }

    private mirroredHandle(anchor: Point, handle: Point) {
        return anchor.add(anchor.subtract(handle));
    }

    private eventPoint(event: MouseEvent): Point {
        const point = this._editor.toCanvasPoint(event.clientX, event.clientY);
        return snapPoint(this._editor.selectedSVG, point, {
            guides: true,
            geometry: event.shiftKey,
            ignore: event.ctrlKey || event.metaKey,
        }).point;
    }

    private updateBezierSegment(line: Line, start: Point, end: Point, handle: Point) {
        line.type = 'bezier';
        line.points = [start, end];
        line.controlStart = line.controlStart ?? start.add(0,0);
        line.controlEnd = handle;
    }

    private updatePreviewSegment(start: Point, end: Point, handle?: Point) {
        if(!this.tmpPath?.lines[0]) {
            return;
        }

        const previewLine = this.tmpPath.lines[0];
        if(handle || this.workingLine?.controlStart) {
            previewLine.controlStart = this.workingLine?.controlStart;
            this.updateBezierSegment(previewLine, start, end, handle ?? end);
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
                let line = new Line(this._editor);
                line.points.push(point);
                path.lines.push(line);

                this.tmpPath = new Path(this._editor);
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
                    if(distance <= this._editor.settings.snapDistance) {
                        this.workingLine.points.push(activePath.lines[0].points[0]);
                        if(this.workingLine.controlStart) {
                            this.workingLine.type = 'bezier';
                            this.workingLine.controlEnd = activePath.lines[0].points[0].add(0,0);
                        }
                        activePath.closed = true;
                        this.tmpPath?.destroy();
                        this.tmpPath = undefined;
                        this._editor.selectedElement = activePath;
                        this._editor.activeElement = undefined;
                        this.workingLine = undefined;
                    } else {
                        this.workingLine.points.push(point);
                        if(this.workingLine.controlStart) {
                            this.workingLine.type = 'bezier';
                            this.workingLine.controlEnd = point.add(0,0);
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

            console.log(this._editor.selectedSVG);
        }
    }

    override onselect() {
        if(this._editor.activeElement instanceof Path && !this._editor.activeElement.closed && this._editor.selectedSVG) {
            let line = this._editor.activeElement.lines[this._editor.activeElement.lines.length - 1];
            let point = line.points[0];
            this._editor.activeElement.lines.pop();
            this.workingLine = line;
            this.tmpPath = new Path(this._editor);
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
        if(this._editor.activeElement instanceof Path && this.workingLine) {
            this.pendingPoint = this.eventPoint(event);
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
            const handlePoint = this.eventPoint(event);
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
        }

        this.pendingPoint = undefined;
        this.draggingBezier = false;
    }

    private finishPath() {
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
        switch(key) {
            case 'Escape':
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
            const handlePoint = this.eventPoint(event);

            if(handlePoint.distanceFrom(this.pendingPoint) > 0) {
                this.draggingBezier = true;
                this.updatePreviewSegment(this.workingLine.points[0], this.pendingPoint, handlePoint);
            }
            return;
        }

        if(this.workingLine) {
            this.updatePreviewSegment(this.workingLine.points[0], this.eventPoint(event));
        }
    }

    override reset() {
        this.workingLine = undefined;
        this.pendingPoint = undefined;
        this.draggingBezier = false;
        this.suppressClick = false;
    }

    override deselect(): void {
        super.deselect();
        this.tmpPath?.destroy();
        this.tmpPath = undefined;
        this.workingLine = undefined;
        this.pendingPoint = undefined;
        this.draggingBezier = false;
        this.suppressClick = false;
    }
}
