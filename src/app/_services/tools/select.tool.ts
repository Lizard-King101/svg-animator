import { IconName } from "@fortawesome/fontawesome-common-types";
import { Line } from "src/app/editor/objects/line.object";
import { Path } from "src/app/editor/objects/elements/path.object";
import { Point } from "src/app/editor/objects/point.object";
import { EditorService } from "../editor.service";
import { Tool } from "./tool";

export class SelectTool extends Tool {
    override icon: IconName = "mouse-pointer";

    canDeselect: boolean = false;
    movedElement: boolean = false;

    movingElement: boolean = false;
    moveStart?: Point;
    movingPoint?: Point;
    movingPointRole?: 'anchor' | 'control-start' | 'control-end' | 'anchor-convert';
    movingLine?: Line;
    convertingIncomingLine?: Line;
    convertingOutgoingLine?: Line;

    constructor(private _editor: EditorService) {
        super(_editor);
    }

    private clonePoint(point: Point) {
        return point.add(0,0);
    }

    private lerpPoint(a: Point, b: Point, t: number) {
        return new Point(
            a.x + ((b.x - a.x) * t),
            a.y + ((b.y - a.y) * t),
        );
    }

    private cubicPoint(start: Point, controlStart: Point, controlEnd: Point, end: Point, t: number) {
        const mt = 1 - t;
        return new Point(
            (mt * mt * mt * start.x) + (3 * mt * mt * t * controlStart.x) + (3 * mt * t * t * controlEnd.x) + (t * t * t * end.x),
            (mt * mt * mt * start.y) + (3 * mt * mt * t * controlStart.y) + (3 * mt * t * t * controlEnd.y) + (t * t * t * end.y),
        );
    }

    private closestLineT(start: Point, end: Point, target: Point) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = (dx * dx) + (dy * dy);
        if(lengthSquared == 0) {
            return 0.5;
        }

        return Math.max(0, Math.min(1, (((target.x - start.x) * dx) + ((target.y - start.y) * dy)) / lengthSquared));
    }

    private closestBezierT(start: Point, controlStart: Point, controlEnd: Point, end: Point, target: Point) {
        let bestT = 0.5;
        let bestDistance = Number.POSITIVE_INFINITY;

        for(let i = 0; i <= 40; i++) {
            const t = i / 40;
            const point = this.cubicPoint(start, controlStart, controlEnd, end, t);
            const distance = point.distanceFrom(target);
            if(distance < bestDistance) {
                bestDistance = distance;
                bestT = t;
            }
        }

        return bestT;
    }

    private findLine(path: Path, id?: string): Line | undefined {
        return path.lines.find((line) => {
            return line.id == id;
        });
    }

    private moveAnchor(path: Path, anchor: Point, delta: Point) {
        const moved: Point[] = [anchor];
        anchor.addTo(delta);

        path.lines.forEach((line) => {
            if(line.points[0] == anchor && line.controlStart && !moved.includes(line.controlStart)) {
                line.controlStart.addTo(delta);
                moved.push(line.controlStart);
            }

            if(line.points[1] == anchor && line.controlEnd && !moved.includes(line.controlEnd)) {
                line.controlEnd.addTo(delta);
                moved.push(line.controlEnd);
            }
        });
    }

    private mirroredHandle(anchor: Point, handle: Point) {
        return anchor.add(anchor.subtract(handle));
    }

    private findOppositeHandle(path: Path, line: Line, role: 'control-start' | 'control-end') {
        if(role == 'control-start') {
            const anchor = line.points[0];
            return path.lines.find((candidate) => {
                return candidate.points[1] == anchor && !!candidate.controlEnd;
            })?.controlEnd;
        }

        const anchor = line.points[1];
        return path.lines.find((candidate) => {
            return candidate.points[0] == anchor && !!candidate.controlStart;
        })?.controlStart;
    }

    private findIncomingLine(path: Path, anchor: Point) {
        return path.lines.find((line) => {
            return line.points[1] == anchor;
        });
    }

    private findOutgoingLine(path: Path, anchor: Point) {
        return path.lines.find((line) => {
            return line.points[0] == anchor;
        });
    }

    private findOverlayPoint(target: HTMLElement) {
        if(!(this._editor.selectedElement instanceof Path) || this._editor.selectedElement.locked || !this._editor.selectedElement.visible) {
            return;
        }

        const pointRole = target.dataset['pointRole'];
        const pointId = target.dataset['pointId'];
        const lineId = target.dataset['lineId'];

        if(!pointRole || !pointId) {
            return;
        }

        if(pointRole == 'anchor') {
            for(const line of this._editor.selectedElement.lines) {
                for(const point of line.points) {
                    if(point.id == pointId) {
                        return {
                            point,
                            role: 'anchor' as const,
                        };
                    }
                }
            }
            return;
        }

        const line = this.findLine(this._editor.selectedElement, lineId);
        if(!line) {
            return;
        }

        if(pointRole == 'control-start' && line.controlStart?.id == pointId) {
            return {
                point: line.controlStart,
                role: 'control-start' as const,
                line,
            };
        }

        if(pointRole == 'control-end' && line.controlEnd?.id == pointId) {
            return {
                point: line.controlEnd,
                role: 'control-end' as const,
                line,
            };
        }

        return;
    }

    private findOverlaySegment(target: HTMLElement) {
        if(!(this._editor.selectedElement instanceof Path) || this._editor.selectedElement.locked || !this._editor.selectedElement.visible) {
            return;
        }

        const segmentId = target.dataset['segmentId'];
        if(!segmentId) {
            return;
        }

        return this.findLine(this._editor.selectedElement, segmentId);
    }

    private convertLine(line: Line) {
        if(line.points.length < 2) {
            return;
        }

        if(line.type == 'line') {
            const start = line.points[0];
            const end = line.points[1];
            line.type = 'bezier';
            line.controlStart = this.lerpPoint(start, end, 1 / 3);
            line.controlEnd = this.lerpPoint(start, end, 2 / 3);
            return;
        }

        line.type = 'line';
        line.controlStart = undefined;
        line.controlEnd = undefined;
    }

    private insertPoint(path: Path, line: Line, targetPoint?: Point) {
        const index = path.lines.indexOf(line);
        if(index < 0 || line.points.length < 2) {
            return;
        }

        const start = line.points[0];
        const end = line.points[1];
        const t = line.type == 'bezier' && line.controlStart && line.controlEnd
            ? this.closestBezierT(start, line.controlStart, line.controlEnd, end, targetPoint ?? this.lerpPoint(start, end, 0.5))
            : this.closestLineT(start, end, targetPoint ?? this.lerpPoint(start, end, 0.5));

        if(line.type == 'bezier' && line.controlStart && line.controlEnd) {
            const q0 = this.lerpPoint(start, line.controlStart, t);
            const q1 = this.lerpPoint(line.controlStart, line.controlEnd, t);
            const q2 = this.lerpPoint(line.controlEnd, end, t);
            const r0 = this.lerpPoint(q0, q1, t);
            const r1 = this.lerpPoint(q1, q2, t);
            const midpoint = this.lerpPoint(r0, r1, t);

            line.points = [start, midpoint];
            line.controlStart = q0;
            line.controlEnd = r0;

            const next = new Line(this._editor, {
                type: 'bezier',
                points: [midpoint, end],
                controlStart: r1,
                controlEnd: q2,
            });

            path.lines.splice(index + 1, 0, next);
            this._editor.selectedPathAnchor = midpoint;
            this._editor.selectedPathLine = next;
            return;
        }

        const midpoint = this.lerpPoint(start, end, t);
        line.points = [start, midpoint];

        const next = new Line(this._editor, {
            points: [midpoint, end],
        });

        path.lines.splice(index + 1, 0, next);
        this._editor.selectedPathAnchor = midpoint;
        this._editor.selectedPathLine = next;
    }

    private deleteAnchor(path: Path, anchor: Point) {
        const anchorCount = path.lines.length + (path.closed ? 0 : 1);
        if(anchorCount <= 2) {
            return;
        }

        const isClosedBoundaryAnchor = path.closed && path.lines.length > 1 && path.lines[0].points[0] == anchor;
        if(isClosedBoundaryAnchor) {
            const firstLine = path.lines[0];
            const lastLine = path.lines[path.lines.length - 1];
            const nextAnchor = firstLine.points[1];
            const previousAnchor = lastLine.points[0];
            const mergedIsBezier = lastLine.type == 'bezier' || firstLine.type == 'bezier';
            const merged = new Line(this._editor, {
                type: mergedIsBezier ? 'bezier' : 'line',
                points: [previousAnchor, nextAnchor],
                controlStart: lastLine.type == 'bezier' ? lastLine.controlStart : (mergedIsBezier ? this.clonePoint(previousAnchor) : undefined),
                controlEnd: firstLine.type == 'bezier' ? firstLine.controlEnd : (mergedIsBezier ? this.clonePoint(nextAnchor) : undefined),
            });

            path.lines.splice(path.lines.length - 1, 1);
            path.lines.splice(0, 1, merged);
            this._editor.selectedPathAnchor = undefined;
            this._editor.selectedPathLine = merged;
            return;
        }

        const incomingIndex = path.lines.findIndex((line) => {
            return line.points[1] == anchor;
        });
        const outgoingIndex = path.lines.findIndex((line) => {
            return line.points[0] == anchor;
        });

        if(incomingIndex < 0 && outgoingIndex < 0) {
            return;
        }

        if(incomingIndex < 0) {
            path.lines.splice(outgoingIndex, 1);
            this._editor.selectedPathLine = path.lines[outgoingIndex] ?? path.lines[outgoingIndex - 1];
        } else if(outgoingIndex < 0) {
            path.lines.splice(incomingIndex, 1);
            this._editor.selectedPathLine = path.lines[incomingIndex] ?? path.lines[incomingIndex - 1];
        } else {
            const incoming = path.lines[incomingIndex];
            const outgoing = path.lines[outgoingIndex];
            const mergedStart = incoming.points[0];
            const mergedEnd = outgoing.points[1];
            const isBezier = incoming.type == 'bezier' || outgoing.type == 'bezier';
            const merged = new Line(this._editor, {
                type: isBezier ? 'bezier' : 'line',
                points: [mergedStart, mergedEnd],
                controlStart: incoming.type == 'bezier' ? incoming.controlStart : (isBezier ? this.clonePoint(mergedStart) : undefined),
                controlEnd: outgoing.type == 'bezier' ? outgoing.controlEnd : (isBezier ? this.clonePoint(mergedEnd) : undefined),
            });

            path.lines.splice(incomingIndex, 1, merged);
            path.lines.splice(outgoingIndex > incomingIndex ? outgoingIndex : outgoingIndex + 1, 1);
            this._editor.selectedPathLine = merged;
        }

        this._editor.selectedPathAnchor = undefined;
    }

    override down(event: MouseEvent) {
        let target = <HTMLElement>event.target;
        this.moveStart = this._editor.toCanvasPoint(event.clientX, event.clientY);

        const overlayPoint = this.findOverlayPoint(target);
        if(overlayPoint) {
            if(overlayPoint.role == 'anchor' && this._editor.keysDown['Alt'] && this._editor.selectedElement instanceof Path) {
                this.movingPoint = overlayPoint.point;
                this.movingPointRole = 'anchor-convert';
                this.convertingIncomingLine = this.findIncomingLine(this._editor.selectedElement, overlayPoint.point);
                this.convertingOutgoingLine = this.findOutgoingLine(this._editor.selectedElement, overlayPoint.point);
                this._editor.selectedPathAnchor = overlayPoint.point;
                this._editor.selectedPathLine = undefined;
                this.canDeselect = false;
                return;
            }

            this.movingPoint = overlayPoint.point;
            this.movingPointRole = overlayPoint.role;
            this.movingLine = overlayPoint.line;
            this._editor.selectedPathAnchor = overlayPoint.role == 'anchor' ? overlayPoint.point : undefined;
            this._editor.selectedPathLine = overlayPoint.line;
            this.canDeselect = false;
            return;
        }

        const overlaySegment = this.findOverlaySegment(target);
        if(overlaySegment) {
            this._editor.selectedPathLine = overlaySegment;
            this._editor.selectedPathAnchor = undefined;
            this.canDeselect = false;
            return;
        }

        // Walk up in case the click landed on a child element (e.g. tspan inside text)
        let idTarget: HTMLElement | null = target;
        while (idTarget && !idTarget.id) {
            idTarget = idTarget.parentElement;
        }

        if(idTarget?.id) {
            let foundElement = this._editor.findElement(idTarget.id);
            if(foundElement && !foundElement.locked && foundElement.visible) {
                this.movingElement = true;
                this._editor.selectedElement = foundElement;
                this._editor.selectedPathAnchor = undefined;
                this._editor.selectedPathLine = undefined;
            }
        } else {
            this.canDeselect = true;
        }
    }

    override drag(event: MouseEvent) {
        if(this.moveStart && this.movingPoint && this._editor.selectedElement instanceof Path) {
            let pos = this._editor.toCanvasPoint(event.clientX, event.clientY);
            let delta = pos.subtract(this.moveStart);
            this.moveStart = pos;

            if(this.movingPointRole == 'anchor-convert') {
                if(this.convertingIncomingLine && this.convertingIncomingLine.points.length >= 2) {
                    this.convertingIncomingLine.type = 'bezier';
                    // The dragged handle — follows the mouse
                    this.convertingIncomingLine.controlEnd = this.clonePoint(pos);
                    // The far handle — initialize once with a natural lerp position
                    if(!this.convertingIncomingLine.controlStart) {
                        this.convertingIncomingLine.controlStart = this.lerpPoint(
                            this.convertingIncomingLine.points[0],
                            this.convertingIncomingLine.points[1],
                            1 / 3
                        );
                    }
                }

                if(this.convertingOutgoingLine && this.convertingOutgoingLine.points.length >= 2) {
                    this.convertingOutgoingLine.type = 'bezier';
                    // The mirrored handle — follows the anchor symmetry
                    this.convertingOutgoingLine.controlStart = this.mirroredHandle(this.movingPoint, pos);
                    // The far handle — initialize once with a natural lerp position
                    if(!this.convertingOutgoingLine.controlEnd) {
                        this.convertingOutgoingLine.controlEnd = this.lerpPoint(
                            this.convertingOutgoingLine.points[0],
                            this.convertingOutgoingLine.points[1],
                            2 / 3
                        );
                    }
                }
            } else if(this.movingPointRole == 'anchor') {
                this.moveAnchor(this._editor.selectedElement, this.movingPoint, delta);
            } else {
                this.movingPoint.addTo(delta);

                if(
                    this.movingLine &&
                    this.movingPointRole &&
                    !this._editor.keysDown['Alt']
                ) {
                    const anchor = this.movingPointRole == 'control-start'
                        ? this.movingLine.points[0]
                        : this.movingLine.points[1];
                    const oppositeHandle = this.findOppositeHandle(this._editor.selectedElement, this.movingLine, this.movingPointRole);

                    if(oppositeHandle) {
                        const mirrored = this.mirroredHandle(anchor, this.movingPoint);
                        oppositeHandle.x = mirrored.x;
                        oppositeHandle.y = mirrored.y;
                    }
                }
            }

            this.movedElement = true;
            this.canDeselect = false;
            return;
        }

        if(this.moveStart && this.movingElement && this._editor.selectedElement && this._editor.selectedSVG) {
            let pos = this._editor.toCanvasPoint(event.clientX, event.clientY);
            let delta = pos.subtract(this.moveStart);
            this.moveStart = pos;
            this._editor.selectedElement.moveElement(delta);
            this.movedElement = true;
            this.canDeselect = false;
        }
    }

    override up(event: MouseEvent) {
        this.movingElement = false;
        this.movingPoint = undefined;
        this.movingPointRole = undefined;
        this.movingLine = undefined;
        this.convertingIncomingLine = undefined;
        this.convertingOutgoingLine = undefined;
        if(!this.movedElement && this.canDeselect) {
            this._editor.selectedElement = undefined;
            this._editor.selectedPathAnchor = undefined;
            this._editor.selectedPathLine = undefined;
            this.canDeselect = false;
        }
        this.movedElement = false;
    }

    override contextMenu(event: MouseEvent): void {
        const target = <HTMLElement>event.target;
        if(!(this._editor.selectedElement instanceof Path) || this._editor.selectedElement.locked || !this._editor.selectedElement.visible) {
            this._editor.closeContextMenu();
            return;
        }

        const menuPosition = new Point(event.clientX, event.clientY);
        const canvasPoint = this._editor.toCanvasPoint(event.clientX, event.clientY);

        const overlayPoint = this.findOverlayPoint(target);
        if(overlayPoint?.role == 'anchor') {
            this._editor.selectedPathAnchor = overlayPoint.point;
            this._editor.selectedPathLine = undefined;
            this._editor.openContextMenu(menuPosition.x, menuPosition.y, [
                {
                    label: 'Delete Point',
                    shortcut: 'Del',
                    action: () => {
                        this.deleteAnchor(this._editor.selectedElement as Path, overlayPoint.point);
                    }
                }
            ]);
            this._editor.contextMenu!.infoTitle = 'Path Shortcuts';
            this._editor.contextMenu!.infoLines = [
                'Alt-drag anchor: convert point',
                'Delete or Backspace: delete selected point',
            ];
            return;
        }

        const overlaySegment = this.findOverlaySegment(target);
        if(overlaySegment) {
            this._editor.selectedPathLine = overlaySegment;
            this._editor.selectedPathAnchor = undefined;
            this._editor.openContextMenu(menuPosition.x, menuPosition.y, [
                {
                    label: 'Insert Point',
                    shortcut: 'I',
                    action: () => {
                        this.insertPoint(this._editor.selectedElement as Path, overlaySegment, canvasPoint);
                    }
                },
                {
                    label: overlaySegment.type == 'line' ? 'Convert To Curve' : 'Convert To Line',
                    shortcut: 'C',
                    action: () => {
                        this.convertLine(overlaySegment);
                    }
                }
            ]);
            this._editor.contextMenu!.infoTitle = 'Path Shortcuts';
            this._editor.contextMenu!.infoLines = [
                'C: convert selected segment',
                'I: insert point on selected segment',
                'Alt-drag anchor: convert point',
            ];
            return;
        }

        this._editor.closeContextMenu();
    }

    override keyPressed(key: string): void {
        if(!(this._editor.selectedElement instanceof Path) || this._editor.selectedElement.locked || !this._editor.selectedElement.visible) {
            return;
        }

        switch(key) {
            case 'c':
            case 'C':
                if(this._editor.selectedPathLine) {
                    this.convertLine(this._editor.selectedPathLine);
                }
                break;
            case 'i':
            case 'I':
                if(this._editor.selectedPathLine) {
                    this.insertPoint(this._editor.selectedElement, this._editor.selectedPathLine);
                }
                break;
            case 'Delete':
            case 'Backspace':
                if(this._editor.selectedPathAnchor) {
                    this.deleteAnchor(this._editor.selectedElement, this._editor.selectedPathAnchor);
                }
                break;
        }
    }
}
