import { IconName } from "@fortawesome/fontawesome-common-types";
import { Line } from "src/app/editor/objects/line.object";
import { Path, PathContour } from "src/app/editor/objects/elements/path.object";
import { Point } from "src/app/editor/objects/point.object";
import { AnyElement } from "src/app/editor/objects/svg.object";
import { combinedMatrixFor, localBounds, parentMatrixFor, pinAncestorTransformOrigins, pinTransformOrigin, resolvedOrigin } from "src/app/editor/objects/element-bounds";
import { Bounds, TransformState, applyMatrix, invertMatrix, transformMatrix } from "src/app/editor/objects/transform.object";
import { EditorService } from "../editor.service";
import { Tool } from "./tool";

export class SelectTool extends Tool {
    override icon: IconName = "mouse-pointer";
    override interactsWithGuides = true;

    canDeselect: boolean = false;
    movedElement: boolean = false;

    movingElement: boolean = false;
    moveStart?: Point;
    movingPoint?: Point;
    movingPointRole?: 'anchor' | 'control-start' | 'control-end' | 'anchor-convert';
    movingLine?: Line;
    movingLines?: Line[];
    convertingIncomingLine?: Line;
    convertingOutgoingLine?: Line;
    transformDrag?: TransformDrag;

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
        return this.allLines(path).find((line) => {
            return line.id == id;
        });
    }

    private allLines(path: Path): Line[] {
        return path.contours.flatMap((contour) => contour.lines);
    }

    private contourForLine(path: Path, line: Line): PathContour | undefined {
        return path.contours.find((contour) => contour.lines.includes(line));
    }

    private contourForAnchor(path: Path, anchor: Point): PathContour | undefined {
        return path.contours.find((contour) => {
            return contour.lines.some((line) => line.points[0] == anchor || line.points[1] == anchor);
        });
    }

    private cloneTransform(transform: TransformState): TransformState {
        return {
            translateX: transform.translateX,
            translateY: transform.translateY,
            scaleX: transform.scaleX,
            scaleY: transform.scaleY,
            rotation: transform.rotation,
            originX: transform.originX,
            originY: transform.originY,
        };
    }

    private findTransformHandle(target: HTMLElement): string | undefined {
        let current: HTMLElement | null = target;
        while(current) {
            const handle = current.dataset['transformHandle'];
            if(handle) {
                return handle;
            }
            current = current.parentElement;
        }

        return undefined;
    }

    private rootElements(): AnyElement[] {
        return this._editor.selectedSVG?.elements ?? [];
    }

    private canvasToSelectedLocal(point: Point): Point {
        if(!this._editor.selectedElement) {
            return point;
        }

        const inverse = invertMatrix(combinedMatrixFor(this.rootElements(), this._editor.selectedElement));
        const local = applyMatrix(inverse, point.x, point.y);
        return new Point(local.x, local.y);
    }

    private canvasToParentLocal(element: AnyElement, point: Point): Point {
        const inverse = invertMatrix(parentMatrixFor(this.rootElements(), element));
        const local = applyMatrix(inverse, point.x, point.y);
        return new Point(local.x, local.y);
    }

    private rotateVector(point: Point, degrees: number): Point {
        const radians = degrees * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        return new Point(
            (point.x * cos) - (point.y * sin),
            (point.x * sin) + (point.y * cos),
        );
    }

    private oppositeHandlePoint(bounds: Bounds, handle: string): Point {
        const x = handle.includes('w')
            ? bounds.x + bounds.width
            : handle.includes('e')
                ? bounds.x
                : bounds.x + bounds.width / 2;
        const y = handle.includes('n')
            ? bounds.y + bounds.height
            : handle.includes('s')
                ? bounds.y
                : bounds.y + bounds.height / 2;
        return new Point(x, y);
    }

    private handlePoint(bounds: Bounds, handle: string): Point {
        const x = handle.includes('w')
            ? bounds.x
            : handle.includes('e')
                ? bounds.x + bounds.width
                : bounds.x + bounds.width / 2;
        const y = handle.includes('n')
            ? bounds.y
            : handle.includes('s')
                ? bounds.y + bounds.height
                : bounds.y + bounds.height / 2;
        return new Point(x, y);
    }

    private beginTransformDrag(handle: string, event: MouseEvent) {
        const element = this._editor.selectedElement;
        if(!element || element.locked || !element.visible) {
            return false;
        }

        if(handle == 'move') {
            pinAncestorTransformOrigins(this.rootElements(), element);
            const canvasPoint = this._editor.toCanvasPoint(event.clientX, event.clientY);
            this.moveStart = this.canvasToParentLocal(element, canvasPoint);
            this.movingElement = true;
            this.canDeselect = false;
            return true;
        }

        const bounds = localBounds(element);
        const origin = handle == 'origin' ? resolvedOrigin(element) : pinTransformOrigin(element);
        const initial = this.cloneTransform(element.transform);
        const own = transformMatrix(initial, origin);
        const pivotLocal = handle == 'origin' || event.altKey
            ? new Point(origin.x, origin.y)
            : this.oppositeHandlePoint(bounds, handle);
        const pivotParent = applyMatrix(own, pivotLocal.x, pivotLocal.y);
        const handleLocal = this.handlePoint(bounds, handle);
        const canvasPoint = this._editor.toCanvasPoint(event.clientX, event.clientY);
        const parentPoint = this.canvasToParentLocal(element, canvasPoint);

        this.transformDrag = {
            handle,
            element,
            bounds,
            origin,
            initial,
            pivotLocal,
            pivotParent: new Point(pivotParent.x, pivotParent.y),
            handleLocal,
            startAngle: Math.atan2(parentPoint.y - pivotParent.y, parentPoint.x - pivotParent.x) * 180 / Math.PI,
        };
        this.canDeselect = false;
        return true;
    }

    private updateTransformDrag(event: MouseEvent) {
        if(!this.transformDrag) {
            return false;
        }

        const drag = this.transformDrag;
        const canvasPoint = this._editor.toCanvasPoint(event.clientX, event.clientY);
        const parentPoint = this.canvasToParentLocal(drag.element, canvasPoint);
        const next = this.cloneTransform(drag.initial);

        if(drag.handle == 'origin') {
            next.originX = parentPoint.x - drag.initial.translateX;
            next.originY = parentPoint.y - drag.initial.translateY;
            drag.element.transform = next;
            return true;
        }

        if(drag.handle == 'rotate') {
            const angle = Math.atan2(parentPoint.y - drag.pivotParent.y, parentPoint.x - drag.pivotParent.x) * 180 / Math.PI;
            next.rotation = drag.initial.rotation + angle - drag.startAngle;
            drag.element.transform = next;
            return true;
        }

        const hasX = drag.handle.includes('e') || drag.handle.includes('w');
        const hasY = drag.handle.includes('n') || drag.handle.includes('s');
        const currentVector = parentPoint.subtract(drag.pivotParent);
        const unrotated = this.rotateVector(currentVector, -drag.initial.rotation);
        const initialVector = drag.handleLocal.subtract(drag.pivotLocal);

        if(hasX && Math.abs(initialVector.x) > 0.000001) {
            next.scaleX = this.nonZeroScale(unrotated.x / initialVector.x);
        }

        if(hasY && Math.abs(initialVector.y) > 0.000001) {
            next.scaleY = this.nonZeroScale(unrotated.y / initialVector.y);
        }

        if(event.shiftKey) {
            const ratio = hasX
                ? next.scaleX / drag.initial.scaleX
                : next.scaleY / drag.initial.scaleY;
            next.scaleX = this.nonZeroScale(drag.initial.scaleX * ratio);
            next.scaleY = this.nonZeroScale(drag.initial.scaleY * ratio);
        }

        const own = transformMatrix(next, drag.origin);
        const mappedPivot = applyMatrix(own, drag.pivotLocal.x, drag.pivotLocal.y);
        next.translateX += drag.pivotParent.x - mappedPivot.x;
        next.translateY += drag.pivotParent.y - mappedPivot.y;
        drag.element.transform = next;
        return true;
    }

    private nonZeroScale(value: number): number {
        if(Math.abs(value) < 0.01) {
            return value < 0 ? -0.01 : 0.01;
        }

        return value;
    }

    private moveAnchor(path: Path, anchor: Point, delta: Point) {
        const moved: Point[] = [anchor];
        anchor.addTo(delta);

        this.allLines(path).forEach((line) => {
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
            return this.allLines(path).find((candidate) => {
                return candidate.points[1] == anchor && !!candidate.controlEnd;
            })?.controlEnd;
        }

        const anchor = line.points[1];
        return this.allLines(path).find((candidate) => {
            return candidate.points[0] == anchor && !!candidate.controlStart;
        })?.controlStart;
    }

    private findIncomingLine(path: Path, anchor: Point) {
        return this.allLines(path).find((line) => {
            return line.points[1] == anchor;
        });
    }

    private findOutgoingLine(path: Path, anchor: Point) {
        return this.allLines(path).find((line) => {
            return line.points[0] == anchor;
        });
    }

    private moveLines(lines: Line[], delta: Point) {
        const moved: Point[] = [];
        lines.forEach((line) => {
            [
                ...line.points,
                ...(line.controlStart ? [line.controlStart] : []),
                ...(line.controlEnd ? [line.controlEnd] : []),
            ].forEach((point) => {
                if(!moved.includes(point)) {
                    point.addTo(delta);
                    moved.push(point);
                }
            });
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
            for(const line of this.allLines(this._editor.selectedElement)) {
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
        const contour = this.contourForLine(path, line);
        const lines = contour?.lines;
        const index = lines?.indexOf(line) ?? -1;
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

            lines!.splice(index + 1, 0, next);
            this._editor.selectedPathAnchor = midpoint;
            this._editor.selectedPathLine = next;
            return;
        }

        const midpoint = this.lerpPoint(start, end, t);
        line.points = [start, midpoint];

        const next = new Line(this._editor, {
            points: [midpoint, end],
        });

        lines!.splice(index + 1, 0, next);
        this._editor.selectedPathAnchor = midpoint;
        this._editor.selectedPathLine = next;
    }

    private deleteAnchor(path: Path, anchor: Point) {
        const contour = this.contourForAnchor(path, anchor);
        if(!contour) {
            return;
        }

        const lines = contour.lines;
        const anchorCount = lines.length + (contour.closed ? 0 : 1);
        if(anchorCount <= 2) {
            return;
        }

        const isClosedBoundaryAnchor = contour.closed && lines.length > 1 && lines[0].points[0] == anchor;
        if(isClosedBoundaryAnchor) {
            const firstLine = lines[0];
            const lastLine = lines[lines.length - 1];
            const nextAnchor = firstLine.points[1];
            const previousAnchor = lastLine.points[0];
            const mergedIsBezier = lastLine.type == 'bezier' || firstLine.type == 'bezier';
            const merged = new Line(this._editor, {
                type: mergedIsBezier ? 'bezier' : 'line',
                points: [previousAnchor, nextAnchor],
                controlStart: lastLine.type == 'bezier' ? lastLine.controlStart : (mergedIsBezier ? this.clonePoint(previousAnchor) : undefined),
                controlEnd: firstLine.type == 'bezier' ? firstLine.controlEnd : (mergedIsBezier ? this.clonePoint(nextAnchor) : undefined),
            });

            lines.splice(lines.length - 1, 1);
            lines.splice(0, 1, merged);
            this._editor.selectedPathAnchor = undefined;
            this._editor.selectedPathLine = merged;
            return;
        }

        const incomingIndex = lines.findIndex((line) => {
            return line.points[1] == anchor;
        });
        const outgoingIndex = lines.findIndex((line) => {
            return line.points[0] == anchor;
        });

        if(incomingIndex < 0 && outgoingIndex < 0) {
            return;
        }

        if(incomingIndex < 0) {
            lines.splice(outgoingIndex, 1);
            this._editor.selectedPathLine = lines[outgoingIndex] ?? lines[outgoingIndex - 1];
        } else if(outgoingIndex < 0) {
            lines.splice(incomingIndex, 1);
            this._editor.selectedPathLine = lines[incomingIndex] ?? lines[incomingIndex - 1];
        } else {
            const incoming = lines[incomingIndex];
            const outgoing = lines[outgoingIndex];
            const mergedStart = incoming.points[0];
            const mergedEnd = outgoing.points[1];
            const isBezier = incoming.type == 'bezier' || outgoing.type == 'bezier';
            const merged = new Line(this._editor, {
                type: isBezier ? 'bezier' : 'line',
                points: [mergedStart, mergedEnd],
                controlStart: incoming.type == 'bezier' ? incoming.controlStart : (isBezier ? this.clonePoint(mergedStart) : undefined),
                controlEnd: outgoing.type == 'bezier' ? outgoing.controlEnd : (isBezier ? this.clonePoint(mergedEnd) : undefined),
            });

            lines.splice(incomingIndex, 1, merged);
            lines.splice(outgoingIndex > incomingIndex ? outgoingIndex : outgoingIndex + 1, 1);
            this._editor.selectedPathLine = merged;
        }

        this._editor.selectedPathAnchor = undefined;
    }

    override down(event: MouseEvent) {
        let target = <HTMLElement>event.target;
        const canvasPoint = this._editor.toCanvasPoint(event.clientX, event.clientY);
        this.moveStart = canvasPoint;

        const transformHandle = this.findTransformHandle(target);
        if(transformHandle && this.beginTransformDrag(transformHandle, event)) {
            this._editor.selectedPathAnchor = undefined;
            this._editor.selectedPathLine = undefined;
            this._editor.selectedPathLines = [];
            return;
        }

        const overlayPoint = this.findOverlayPoint(target);
        if(overlayPoint) {
            if(this._editor.selectedElement) {
                pinAncestorTransformOrigins(this.rootElements(), this._editor.selectedElement);
                pinTransformOrigin(this._editor.selectedElement);
            }
            this.moveStart = this.canvasToSelectedLocal(canvasPoint);
            if(overlayPoint.role == 'anchor' && this._editor.keysDown['Alt'] && this._editor.selectedElement instanceof Path) {
                this.movingPoint = overlayPoint.point;
                this.movingPointRole = 'anchor-convert';
                this.convertingIncomingLine = this.findIncomingLine(this._editor.selectedElement, overlayPoint.point);
                this.convertingOutgoingLine = this.findOutgoingLine(this._editor.selectedElement, overlayPoint.point);
                this._editor.selectedPathAnchor = overlayPoint.point;
                this._editor.selectedPathLine = undefined;
                this._editor.selectedPathLines = [];
                this.canDeselect = false;
                return;
            }

            this.movingPoint = overlayPoint.point;
            this.movingPointRole = overlayPoint.role;
            this.movingLine = overlayPoint.line;
            this._editor.selectedPathAnchor = overlayPoint.role == 'anchor' ? overlayPoint.point : undefined;
            this._editor.selectedPathLine = overlayPoint.line;
            this._editor.selectedPathLines = [];
            this.canDeselect = false;
            return;
        }

        const overlaySegment = this.findOverlaySegment(target);
        if(overlaySegment) {
            if(this._editor.selectedElement) {
                pinAncestorTransformOrigins(this.rootElements(), this._editor.selectedElement);
                pinTransformOrigin(this._editor.selectedElement);
            }
            this.moveStart = this.canvasToSelectedLocal(canvasPoint);
            const selectedGroup = this._editor.selectedPathLines.includes(overlaySegment)
                ? this._editor.selectedPathLines
                : [overlaySegment];
            this.movingLines = selectedGroup;
            this._editor.selectedPathLine = overlaySegment;
            this._editor.selectedPathLines = selectedGroup;
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
                pinAncestorTransformOrigins(this.rootElements(), foundElement);
                this.moveStart = this.canvasToParentLocal(foundElement, canvasPoint);
                this._editor.selectedElement = foundElement;
                this._editor.selectedPathAnchor = undefined;
                this._editor.selectedPathLine = undefined;
                this._editor.selectedPathLines = [];
            }
        } else {
            this.canDeselect = true;
        }
    }

    override drag(event: MouseEvent) {
        if(this.updateTransformDrag(event)) {
            this.movedElement = true;
            this.canDeselect = false;
            return;
        }

        if(this.moveStart && this.movingPoint && this._editor.selectedElement instanceof Path) {
            let pos = this.canvasToSelectedLocal(this._editor.toCanvasPoint(event.clientX, event.clientY));
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

        if(this.moveStart && this.movingLines?.length && this._editor.selectedElement instanceof Path) {
            let pos = this.canvasToSelectedLocal(this._editor.toCanvasPoint(event.clientX, event.clientY));
            let delta = pos.subtract(this.moveStart);
            this.moveStart = pos;
            this.moveLines(this.movingLines, delta);
            this.movedElement = true;
            this.canDeselect = false;
            return;
        }

        if(this.moveStart && this.movingElement && this._editor.selectedElement && this._editor.selectedSVG) {
            let pos = this.canvasToParentLocal(this._editor.selectedElement, this._editor.toCanvasPoint(event.clientX, event.clientY));
            let delta = pos.subtract(this.moveStart);
            this.moveStart = pos;
            this._editor.selectedElement.transform.translateX += delta.x;
            this._editor.selectedElement.transform.translateY += delta.y;
            this.movedElement = true;
            this.canDeselect = false;
        }
    }

    override up(event: MouseEvent) {
        this.movingElement = false;
        this.transformDrag = undefined;
        this.movingPoint = undefined;
        this.movingPointRole = undefined;
        this.movingLine = undefined;
        this.movingLines = undefined;
        this.convertingIncomingLine = undefined;
        this.convertingOutgoingLine = undefined;
        if(!this.movedElement && this.canDeselect) {
            this._editor.selectedElement = undefined;
            this._editor.selectedPathAnchor = undefined;
            this._editor.selectedPathLine = undefined;
            this._editor.selectedPathLines = [];
            this.canDeselect = false;
        }
        this.movedElement = false;
    }

    override doubleClick(event: MouseEvent): void {
        const target = <HTMLElement>event.target;
        if(!(this._editor.selectedElement instanceof Path) || this._editor.selectedElement.locked || !this._editor.selectedElement.visible) {
            return;
        }

        const overlaySegment = this.findOverlaySegment(target);
        if(!overlaySegment) {
            return;
        }

        const contour = this.contourForLine(this._editor.selectedElement, overlaySegment);
        if(!contour) {
            return;
        }

        this._editor.selectedPathLine = overlaySegment;
        this._editor.selectedPathLines = contour.lines.filter((line) => line.points.length >= 2);
        this._editor.selectedPathAnchor = undefined;
        this.canDeselect = false;
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
            this._editor.selectedPathLines = [];
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
            this._editor.selectedPathLines = [overlaySegment];
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

interface TransformDrag {
    handle: string;
    element: AnyElement;
    bounds: Bounds;
    origin: { x: number; y: number };
    initial: TransformState;
    pivotLocal: Point;
    pivotParent: Point;
    handleLocal: Point;
    startAngle: number;
}
