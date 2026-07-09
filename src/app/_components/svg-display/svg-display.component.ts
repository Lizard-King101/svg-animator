import { AfterViewInit, Component, ElementRef, HostBinding } from "@angular/core";
import { NgFor, NgIf, NgTemplateOutlet } from "@angular/common";
import { EditorService } from "src/app/_services/editor.service";
import { Group } from "src/app/editor/objects/elements/group.object";
import { Line } from "src/app/editor/objects/line.object";
import { Path } from "src/app/editor/objects/elements/path.object";
import { Point } from "src/app/editor/objects/point.object";
import { Shape } from "src/app/editor/objects/elements/shape.object";
import { TextElement } from "src/app/editor/objects/elements/text.object";
import { localBounds, resolvedOrigin } from "src/app/editor/objects/element-bounds";
import { combinedMotionAdjustedMatrixFor, motionAdjustedMatrix } from "src/app/editor/objects/motion-path.object";
import { AnyElement } from "src/app/editor/objects/svg.object";
import { Bounds, applyMatrix, matrixToSvg, transformedBounds } from "src/app/editor/objects/transform.object";

@Component({
    standalone: true,
    selector: '[display]',
    imports: [NgFor, NgIf, NgTemplateOutlet],
    templateUrl: 'svg-display.component.html',
    styles: ':host { user-select: none; }'
})
export class SVGDisplay implements AfterViewInit {
    @HostBinding('attr.width') get width() { return this.editor.selectedSVG?.width }
    @HostBinding('attr.height') get height() { return this.editor.selectedSVG?.height }
    @HostBinding('attr.viewBox') get viewbox() { return '0 0 ' + this.editor.selectedSVG?.width + ' ' + this.editor.selectedSVG?.height }
    @HostBinding('style.top') get y() { return (this.editor.selectedSVG?.pos.y || 0) + 'px' }
    @HostBinding('style.left') get x() { return (this.editor.selectedSVG?.pos.x || 0) + 'px' }
    @HostBinding('style.scale') get zoom() { return this.editor.selectedSVG?.zoom }

    constructor(public editor: EditorService, private host: ElementRef<SVGElement>) {}

    ngAfterViewInit() {
        if (this.host.nativeElement.tagName !== "svg") {
            throw new Error("Cannot use display on non SVG Element");
        }
    }

    asShape(element: any): Shape | null {
        return element instanceof Shape ? element : null;
    }

    asPath(element: any): Path | null {
        return element instanceof Path ? element : null;
    }

    asText(element: any): TextElement | null {
        return element instanceof TextElement ? element : null;
    }

    asGroup(element: any): Group | null {
        return element instanceof Group ? element : null;
    }

    clipUrl(group: Group): string | null {
        return group.clipElement ? `url(#${group.clipPathId})` : null;
    }

    clipElementList(group: Group): Array<Group['elements'][number]> {
        return group.clipElement ? [group.clipElement] : [];
    }

    transformAttr(element: AnyElement): string | null {
        return matrixToSvg(motionAdjustedMatrix(this.editor.selectedSVG, element));
    }

    opacityAttr(element: AnyElement): number | null {
        return element.opacity === 1 ? null : element.opacity;
    }

    drawOffsetAttr(path: Path): number {
        return 1 - Math.max(0, Math.min(1, path.drawProgress));
    }

    screenPx(px: number): number {
        const zoom = Math.max(0.01, this.editor.selectedSVG?.zoom || 1);
        return px / Math.pow(zoom, 0.85);
    }

    screenDash(first: number, second: number): string {
        return `${this.screenPx(first)} ${this.screenPx(second)}`;
    }

    selectedOverlayTransformAttr(element: AnyElement): string | null {
        return this.editor.selectedSVG
            ? matrixToSvg(combinedMotionAdjustedMatrixFor(this.editor.selectedSVG, element))
            : null;
    }

    selectionBox(element?: AnyElement): SelectionBox | null {
        if(!element || !this.editor.selectedSVG || !element.visible || element.locked) {
            return null;
        }

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
        const topCenter = corners.n;
        const rotate = applyMatrix(matrix, bounds.x + bounds.width / 2, bounds.y - this.screenPx(34));
        const pivot = applyMatrix(matrix, origin.x, origin.y);
        const hitBounds = transformedBounds(bounds, matrix);

        return {
            points: `${corners.nw.x},${corners.nw.y} ${corners.ne.x},${corners.ne.y} ${corners.se.x},${corners.se.y} ${corners.sw.x},${corners.sw.y}`,
            topCenter,
            rotate,
            pivot,
            handles: [
                { role: 'nw', ...corners.nw },
                { role: 'n', ...corners.n },
                { role: 'ne', ...corners.ne },
                { role: 'e', ...corners.e },
                { role: 'se', ...corners.se },
                { role: 's', ...corners.s },
                { role: 'sw', ...corners.sw },
                { role: 'w', ...corners.w },
            ],
            hitBounds,
        };
    }

    textTspans(text: TextElement): Array<{ text: string; dy: number }> {
        return text.lines.map((line, i) => ({ text: line, dy: i === 0 ? 0 : text.lineHeight }));
    }

    pathAnchors(path: Path): Point[] {
        const anchors: Point[] = [];

        path.lines.forEach((line) => {
            line.points.forEach((point) => {
                if(!anchors.includes(point)) {
                    anchors.push(point);
                }
            });
        });

        return anchors;
    }

    bezierSegments(path: Path): Line[] {
        return path.lines.filter((line) => {
            return line.type == 'bezier' && !!line.controlStart && !!line.controlEnd && line.points.length >= 2;
        });
    }

    completeSegments(path: Path): Line[] {
        return path.lines.filter((line) => {
            return line.points.length >= 2;
        });
    }

    segmentPath(line: Line) {
        if(line.points.length < 2) {
            return '';
        }

        const start = line.points[0];
        const end = line.points[1];
        if(line.type == 'bezier' && line.controlStart && line.controlEnd) {
            return `M ${start.x} ${start.y} C ${line.controlStart.x} ${line.controlStart.y} ${line.controlEnd.x} ${line.controlEnd.y} ${end.x} ${end.y}`;
        }

        return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
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
