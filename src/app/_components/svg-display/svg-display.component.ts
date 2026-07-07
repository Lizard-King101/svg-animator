import { AfterViewInit, Component, ElementRef, HostBinding } from "@angular/core";
import { NgFor, NgIf, NgTemplateOutlet } from "@angular/common";
import { EditorService } from "src/app/_services/editor.service";
import { Group } from "src/app/editor/objects/elements/group.object";
import { Line } from "src/app/editor/objects/line.object";
import { Path } from "src/app/editor/objects/elements/path.object";
import { Point } from "src/app/editor/objects/point.object";
import { Shape } from "src/app/editor/objects/elements/shape.object";
import { TextElement } from "src/app/editor/objects/elements/text.object";

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
