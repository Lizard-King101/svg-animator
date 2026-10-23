import { IconName } from "@fortawesome/fontawesome-common-types";
import { Line } from "src/app/editor/objects/line.object";
import { Path, PathContour } from "src/app/editor/objects/elements/path.object";
import { Point } from "src/app/editor/objects/point.object";
import { AnyElement } from "src/app/editor/objects/svg.object";
import { combinedMatrixFor, findElementChain, pinAncestorTransformOrigins, pinTransformOrigin } from "src/app/editor/objects/element-bounds";
import { applyMatrix, invertMatrix } from "src/app/editor/objects/transform.object";
import { EditorService } from "../editor.service";
import { Tool } from "./tool";
import { contourForLine, deletePathAnchor, insertPathPoint, togglePathLineType } from "./path-edit.helpers";
import { TransformInteraction } from "./transform.interaction";
import { elementGradient, GradientHandle, moveGradientHandle } from "src/app/editor/objects/gradient-geometry";
import { GradientPaint } from "src/app/editor/objects/paint.object";
import { MarqueeInteraction } from "./marquee.interaction";
import { PathAnchorInteraction } from './path-anchor.interaction';

export class SelectTool extends Tool {
    override readonly preferenceKey = "select";
    override icon: IconName = "mouse-pointer";
    override interactsWithGuides = true;

    canDeselect: boolean = false;
    movedElement: boolean = false;

    moveStart?: Point;
    movingPoint?: Point;
    movingPointRole?: 'control-start' | 'control-end' | 'anchor-convert';
    movingLine?: Line;
    movingLines?: Line[];
    convertingIncomingLine?: Line;
    convertingOutgoingLine?: Line;
    private readonly transformInteraction: TransformInteraction;
    private readonly marquee: MarqueeInteraction;
    private readonly anchorInteraction: PathAnchorInteraction;
    get pointSnapFeedback() { return this.anchorInteraction.feedback; }
    get marqueeBounds() { return this.marquee.bounds; }
    get snapFeedback() { return this.transformInteraction.snapFeedback; }
    get rotationSnapFeedback() { return this.transformInteraction.rotationSnapFeedback; }
    private gradientDrag?: { element: AnyElement; paint: GradientPaint; handle: GradientHandle };

    constructor(private _editor: EditorService) {
        super(_editor);
        this.transformInteraction = new TransformInteraction(_editor);
        this.marquee = new MarqueeInteraction(_editor);
        this.anchorInteraction = new PathAnchorInteraction(_editor);
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

    private findLine(path: Path, id?: string): Line | undefined {
        return this.allLines(path).find((line) => {
            return line.id == id;
        });
    }

    private allLines(path: Path): Line[] {
        return path.contours.flatMap((contour) => contour.lines);
    }

    private contourForLine(path: Path, line: Line): PathContour | undefined {
        return contourForLine(path, line);
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

    private findGradientHandle(target: HTMLElement): GradientHandle | undefined {
        let current: HTMLElement | null = target;
        while(current) {
            const handle = current.dataset['gradientHandle'];
            if(handle === 'start' || handle === 'end' || handle === 'center' || handle === 'radius' || handle === 'focal') return handle;
            current = current.parentElement;
        }
        return undefined;
    }

    private convertLine(line: Line) {
        togglePathLineType(line);
    }

    private insertPoint(path: Path, line: Line, targetPoint?: Point) {
        const result = insertPathPoint(path, line, (options) => new Line(this._editor, options), targetPoint);
        if(result.changed) {
            this._editor.selectedPathAnchor = result.selectedAnchor;
            this._editor.selectedPathLine = result.selectedLine;
        }
    }

    private deleteAnchor(path: Path, anchor: Point) {
        const result = deletePathAnchor(path, anchor, (options) => new Line(this._editor, options));
        if(result.changed) {
            this._editor.selectedPathAnchor = undefined;
            this._editor.selectedPathLine = result.selectedLine;
        }
    }

    override down(event: MouseEvent) {
        this.movedElement = false;
        this.canDeselect = false;
        let target = <HTMLElement>event.target;
        const canvasPoint = this._editor.toCanvasPoint(event.clientX, event.clientY);
        this.moveStart = canvasPoint;

        if((event.shiftKey || event.ctrlKey || event.metaKey) && target.dataset['segmentId'] && this._editor.selectedElement) {
            this._editor.selectedElements = [];
            return;
        }

        const gradientHandle = this.findGradientHandle(target);
        const selectedGradient = this._editor.selectedElement ? elementGradient(this._editor.selectedElement, this._editor.selectedGradientPaintKey) : undefined;
        if(gradientHandle && selectedGradient && this._editor.selectedElement && !this._editor.selectedElement.locked) {
            pinAncestorTransformOrigins(this.rootElements(), this._editor.selectedElement);
            pinTransformOrigin(this._editor.selectedElement);
            this.gradientDrag = { element: this._editor.selectedElement, paint: selectedGradient.paint, handle: gradientHandle };
            this.moveStart = this.canvasToSelectedLocal(canvasPoint);
            this.canDeselect = false;
            return;
        }

        const transformHandle = this.transformInteraction.handle(target);
        const modifyingSelection = event.shiftKey || event.ctrlKey || event.metaKey;
        if(transformHandle && !(transformHandle === 'move' && modifyingSelection) && this.transformInteraction.begin(transformHandle, event)) {
            this.canDeselect = false;
            this._editor.selectedPathAnchor = undefined;
            this._editor.selectedPathLine = undefined;
            this._editor.selectedPathLines = [];
            return;
        }

        const overlayPoint = this.findOverlayPoint(target);
        if(overlayPoint) {
            if(overlayPoint.role === 'anchor' && !(event.altKey || this._editor.keysDown['Alt']) && this._editor.selectedElement instanceof Path) {
                this.anchorInteraction.begin(this._editor.selectedElement, overlayPoint.point, canvasPoint);
                this._editor.selectedPathAnchor = overlayPoint.point;
                this._editor.selectedPathLine = undefined;
                this._editor.selectedPathLines = [];
                return;
            }
            if(this._editor.selectedElement) {
                pinAncestorTransformOrigins(this.rootElements(), this._editor.selectedElement);
                pinTransformOrigin(this._editor.selectedElement);
            }
            this.moveStart = this.canvasToSelectedLocal(canvasPoint);
            if(overlayPoint.role == 'anchor' && this._editor.selectedElement instanceof Path) {
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
            if(overlayPoint.role === 'anchor') return;
            this.movingPointRole = overlayPoint.role;
            this.movingLine = overlayPoint.line;
            this._editor.selectedPathAnchor = undefined;
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

        const foundElement = this.elementAt(event, transformHandle === 'move' && modifyingSelection);
        if(foundElement) {
            const selected = this._editor.selectedElements ?? (this._editor.selectedElement ? [this._editor.selectedElement] : []);
            const selectedAncestor = findElementChain(this.rootElements(), foundElement)?.find((element) => selected.includes(element));
            if(modifyingSelection) {
                const toggled = selectedAncestor ?? foundElement;
                this._editor.selectedElements = selected.includes(toggled)
                    ? selected.filter((element) => element !== toggled) : [...selected, toggled];
                return;
            }
            if(!selectedAncestor) this._editor.selectedElement = foundElement;
            this.transformInteraction.begin('move', event);
        } else if(this._editor.selectedElements) {
            this.marquee.begin(event);
        } else {
            this.canDeselect = true; // Legacy tool hosts without shared selection.
        }
    }

    private elementAt(event: MouseEvent, underneathOverlay: boolean): AnyElement | undefined {
        const targets = underneathOverlay ? document.elementsFromPoint(event.clientX, event.clientY) : [event.target as Element];
        for(const target of targets) {
            let current: Element | null = target;
            while(current) {
                const found = current.id ? this._editor.findElement(current.id) : undefined;
                if(found) {
                    const chain = findElementChain(this.rootElements(), found);
                    return chain?.every((element) => element.visible && !element.locked) ? found : undefined;
                }
                current = current.parentElement;
            }
        }
        return undefined;
    }

    override drag(event: MouseEvent) {
        if(this.marquee.update(event)) return;
        if(this.anchorInteraction.update(this._editor.toCanvasPoint(event.clientX, event.clientY), event.altKey)) {
            this.movedElement = true;
            return;
        }
        if(this.gradientDrag && this._editor.selectedElement === this.gradientDrag.element) {
            const point = this.canvasToSelectedLocal(this._editor.toCanvasPoint(event.clientX, event.clientY));
            if(moveGradientHandle(this.gradientDrag.element, this.gradientDrag.paint, this.gradientDrag.handle, point)) {
                this.movedElement = true;
                this.canDeselect = false;
            }
            return;
        }

        if(this.transformInteraction.update(event)) {
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

    }

    override up(event: MouseEvent) {
        if(this.marquee.end()) return;
        this.transformInteraction.end();
        this.anchorInteraction.end();
        this.gradientDrag = undefined;
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

    override reset(): void {
        this.marquee.cancel();
        this.transformInteraction.cancel();
        this.anchorInteraction.cancel();
        this.gradientDrag = undefined;
        this.movingPoint = undefined;
        this.movingLines = undefined;
        this.movedElement = false;
        this.canDeselect = false;
    }

    override deselect(): void {
        this.reset();
        super.deselect();
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
        if(key === 'Alt') { this.transformInteraction.setSnapBypass(true); this.anchorInteraction.setBypass(true); }
        if(key === 'Escape' && this.anchorInteraction.cancel()) return;
        if(key === 'Escape' && this.marquee.cancel()) return;
        if(key === 'Escape' && this.transformInteraction.cancel()) {
            this.movedElement = false;
            this.canDeselect = false;
            return;
        }
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

    override keyReleased(key: string): void {
        if(key === 'Alt') { this.transformInteraction.setSnapBypass(false); this.anchorInteraction.setBypass(false); }
    }
}
