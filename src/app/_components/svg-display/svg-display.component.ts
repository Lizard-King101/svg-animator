import { AfterViewInit, Component, ElementRef, HostBinding } from "@angular/core";
import { NgFor, NgIf, NgTemplateOutlet } from "@angular/common";
import { EditorService } from "src/app/_services/editor.service";
import { Group } from "src/app/editor/objects/elements/group.object";
import { Path } from "src/app/editor/objects/elements/path.object";
import { Shape } from "src/app/editor/objects/elements/shape.object";
import { TextElement } from "src/app/editor/objects/elements/text.object";
import { motionAdjustedMatrix } from "src/app/editor/objects/motion-path.object";
import { AnyElement, ImportedSourceNode } from "src/app/editor/objects/svg.object";
import { matrixToSvg } from "src/app/editor/objects/transform.object";
import { SVGEditorOverlayComponent } from "../svg-editor-overlay/svg-editor-overlay.component";
import { ImportedSVGSourceDirective } from "./imported-svg-source.directive";
import { GradientPaint, gradientPaints, gradientTransformValue, Paint, paintOpacity, paintSVGValue } from "src/app/editor/objects/paint.object";
import { effectiveStrokeAlignment, StrokeAlignment, strokeDasharrayAttr } from "src/app/editor/objects/stroke-style.object";

@Component({
    standalone: true,
    selector: '[display]',
    imports: [NgFor, NgIf, NgTemplateOutlet, SVGEditorOverlayComponent, ImportedSVGSourceDirective],
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

    sourceNodesFor(parentId: string | null): ImportedSourceNode[] {
        return this.editor.selectedSVG?.importedSourceNodes.filter((node) => node.parentId === parentId) ?? [];
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

    drawPathLengthAttr(path: Path): number | null {
        return this.drawOffsetAttr(path) > 0 ? 1 : null;
    }

    drawDasharrayAttr(path: Path): number | null {
        return this.drawOffsetAttr(path) > 0 ? 1 : null;
    }

    drawDashoffsetAttr(path: Path): number | null {
        const offset = this.drawOffsetAttr(path);
        return offset > 0 ? offset : null;
    }

    strokeAlignment(element: Path | Shape): StrokeAlignment { return effectiveStrokeAlignment(element); }
    strokeEffectId(element: Path | Shape): string { return `stroke-${this.strokeAlignment(element)}-${element.id}`; }
    strokeEffectUrl(element: Path | Shape): string { return `url(#${this.strokeEffectId(element)})`; }
    drawMaskId(path: Path): string { return `stroke-draw-${path.id}`; }
    drawMaskUrl(path: Path): string { return `url(#${this.drawMaskId(path)})`; }
    strokeDasharray(element: Path | Shape): string | number | null {
        return strokeDasharrayAttr(element.settings.stroke_dasharray)
            ?? (element instanceof Path ? this.drawDasharrayAttr(element) : null);
    }
    strokeDashoffset(element: Path | Shape): number | null {
        return element.settings.stroke_dasharray.length
            ? element.settings.stroke_dashoffset
            : (element instanceof Path ? this.drawDashoffsetAttr(element) : null);
    }
    strokePathLength(path: Path): number | null {
        return path.settings.stroke_dasharray.length ? null : this.drawPathLengthAttr(path);
    }

    textTspans(text: TextElement): Array<{ text: string; dy: number }> {
        return text.lines.map((line, i) => ({ text: line, dy: i === 0 ? 0 : text.lineHeight }));
    }

    gradients(): GradientPaint[] {
        const gradients = new Map<string, GradientPaint>();
        const visit = (elements: AnyElement[]) => elements.forEach((element) => {
            const settings = element.settings as Record<string, unknown>;
            gradientPaints(settings).forEach((paint) => gradients.set(paint.id, paint));
            if(element instanceof Group) visit(element.elements);
        });
        visit(this.editor.selectedSVG?.elements ?? []);
        return [...gradients.values()];
    }

    paintValue(paint: Paint | null | undefined): string | null { return paintSVGValue(paint); }
    paintOpacity(paint: Paint | null | undefined): number | null { return paintOpacity(paint); }
    gradientTransform(gradient: GradientPaint): string | null { return gradientTransformValue(gradient); }

}
