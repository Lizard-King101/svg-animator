import { Group } from "./objects/elements/group.object";
import { Path } from "./objects/elements/path.object";
import { Shape } from "./objects/elements/shape.object";
import { TextElement } from "./objects/elements/text.object";
import { motionAdjustedMatrix } from "./objects/motion-path.object";
import { AnyElement, ImportedSourceNode, SVG } from "./objects/svg.object";
import { matrixToSvg } from "./objects/transform.object";
import { GradientPaint, gradientTransformValue, isGradientPaint, paintOpacity, paintSVGValue } from "./objects/paint.object";

export function escapeXmlText(value: unknown): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function escapeXmlAttribute(value: unknown): string {
    return escapeXmlText(value)
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function attr(name: string, value: unknown): string {
    return value != null ? ` ${name}="${escapeXmlAttribute(value)}"` : '';
}

function opacityAttr(value: number): number | null {
    return value === 1 ? null : value;
}

function drawOffsetAttr(path: Path): number {
    return 1 - Math.max(0, Math.min(1, path.drawProgress));
}

function drawAttr(path: Path, value: number): number | null {
    return drawOffsetAttr(path) > 0 ? value : null;
}

function drawDashoffsetAttr(path: Path): number | null {
    const offset = drawOffsetAttr(path);
    return offset > 0 ? offset : null;
}

export interface SVGMarkupOptions {
    bakeRoundedCorners?: boolean;
}

export function buildSVGMarkup(svg: SVG, options: SVGMarkupOptions = {}): string {
    const bakeRoundedCorners = options.bakeRoundedCorners ?? true;
    const lines: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${escapeXmlAttribute(svg.width)}" height="${escapeXmlAttribute(svg.height)}" viewBox="0 0 ${escapeXmlAttribute(svg.width)} ${escapeXmlAttribute(svg.height)}">`
    ];
    const gradients = collectGradients(svg.elements);
    if(gradients.length > 0) {
        lines.push("  <defs>");
        gradients.forEach((gradient) => appendGradient(gradient, lines, 2));
        lines.push("  </defs>");
    }

    const appendElements = (elements: AnyElement[], depth: number, parentId: string | null | undefined) => {
        const indent = '  '.repeat(depth);
        for(const element of elements) {
            if(!element.visible) continue;
            const transform = matrixToSvg(motionAdjustedMatrix(svg, element));

            if(element instanceof Group) {
                if(element.clipElement) {
                    lines.push(`${indent}<defs>`);
                    lines.push(`${indent}  <clipPath${attr('id', element.clipPathId)}>`);
                    appendElements([element.clipElement] as AnyElement[], depth + 2, undefined);
                    lines.push(`${indent}  </clipPath>`);
                    lines.push(`${indent}</defs>`);
                }
                lines.push(`${indent}<g${attr('id', element.id)}${attr('transform', transform)}${attr('opacity', opacityAttr(element.opacity))}${attr('clip-path', element.clipElement ? `url(#${element.clipPathId})` : null)}>`);
                appendElements(element.renderedElements as AnyElement[], depth + 1, element.id);
                lines.push(`${indent}</g>`);
            } else if(element instanceof Path) {
                const s = element.settings;
                lines.push(
                    `${indent}<path` +
                    attr('id', element.id) +
                    attr('d', bakeRoundedCorners ? element.raw : element.rawUnrounded) +
                    attr('transform', transform) +
                    attr('opacity', opacityAttr(element.opacity)) +
                    attr('fill', s.fill_enabled ? paintSVGValue(s.fill) ?? 'none' : 'none') +
                    attr('fill-opacity', s.fill_enabled ? paintOpacity(s.fill) : null) +
                    attr('fill-rule', element.fillRule) +
                    attr('stroke', paintSVGValue(s.stroke)) +
                    attr('stroke-opacity', paintOpacity(s.stroke)) +
                    attr('stroke-width', s.stroke_width ?? null) +
                    attr('stroke-linecap', s.line_cap ?? null) +
                    attr('stroke-linejoin', s.line_join ?? null) +
                    attr('pathLength', drawAttr(element, 1)) +
                    attr('stroke-dasharray', drawAttr(element, 1)) +
                    attr('stroke-dashoffset', drawDashoffsetAttr(element)) +
                    `/>`
                );
            } else if(element instanceof TextElement) {
                const s = element.settings;
                const tspanIndent = '  '.repeat(depth + 1);
                const tspans = element.lines.map((line, i) =>
                    `${tspanIndent}<tspan${i === 0 ? '' : attr('x', element.x) + attr('dy', element.lineHeight)}>${escapeXmlText(line)}</tspan>`
                ).join('\n');
                lines.push(
                    `${indent}<text` +
                    attr('id', element.id) +
                    attr('x', element.x) +
                    attr('y', element.y) +
                    attr('transform', transform) +
                    attr('opacity', opacityAttr(element.opacity)) +
                    attr('font-size', s.font_size) +
                    attr('font-family', s.font_family) +
                    attr('font-weight', s.font_weight) +
                    attr('text-anchor', element.textAnchor) +
                    attr('fill', s.color?.hex ?? '#000000') +
                    attr('fill-opacity', s.color && s.color.alpha < 0.9999 ? s.color.alpha : null) +
                    ` dominant-baseline="hanging">` +
                    `\n${tspans}\n${indent}</text>`
                );
            } else if(element instanceof Shape) {
                const s = element.settings;
                const fillAttr = attr('fill', paintSVGValue(s.fill) ?? 'none');
                const strokeAttr = attr('stroke', paintSVGValue(s.stroke));
                const fillOpacityAttr = attr('fill-opacity', paintOpacity(s.fill));
                const strokeOpacityAttr = attr('stroke-opacity', paintOpacity(s.stroke));
                const swAttr = attr('stroke-width', s.stroke_width ?? null);
                if(element.type === 'rectangle') {
                    const cr = s.corner_radius || null;
                    lines.push(
                        `${indent}<rect` +
                        attr('id', element.id) +
                        attr('x', element.x) +
                        attr('y', element.y) +
                        attr('transform', transform) +
                        attr('opacity', opacityAttr(element.opacity)) +
                        attr('width', element.width) +
                        attr('height', element.height) +
                        attr('rx', cr) +
                        attr('ry', cr) +
                        fillAttr + fillOpacityAttr + strokeAttr + strokeOpacityAttr + swAttr +
                        `/>`
                    );
                } else {
                    lines.push(
                        `${indent}<ellipse` +
                        attr('id', element.id) +
                        attr('cx', element.centerX) +
                        attr('cy', element.centerY) +
                        attr('transform', transform) +
                        attr('opacity', opacityAttr(element.opacity)) +
                        attr('rx', element.radiusX) +
                        attr('ry', element.radiusY) +
                        fillAttr + fillOpacityAttr + strokeAttr + strokeOpacityAttr + swAttr +
                        `/>`
                    );
                }
            }
        }

        if(parentId !== undefined) {
            svg.importedSourceNodes
                .filter((node) => node.parentId === parentId)
                .forEach((node) => appendImportedSource(node, lines, depth));
        }
    };

    appendElements(svg.elements, 1, null);

    lines.push('</svg>');
    return lines.join('\n');
}

function collectGradients(elements: AnyElement[]): GradientPaint[] {
    const gradients = new Map<string, GradientPaint>();
    const visit = (element: AnyElement) => {
        const settings = element.settings as Record<string, unknown>;
        [settings["fill"], settings["stroke"]].forEach((paint) => {
            if(isGradientPaint(paint)) gradients.set(paint.id, paint);
        });
        if(element instanceof Group) element.elements.forEach(visit);
    };
    elements.forEach(visit);
    return [...gradients.values()];
}

function appendGradient(gradient: GradientPaint, lines: string[], depth: number): void {
    const indent = "  ".repeat(depth);
    const tag = gradient.type === "linear-gradient" ? "linearGradient" : "radialGradient";
    const coordinateAttrs = Object.entries(gradient.coordinates)
        .map(([name, value]) => attr(name, value)).join("");
    lines.push(`${indent}<${tag}${attr("id", gradient.id)}${attr("gradientUnits", gradient.units)}${attr("spreadMethod", gradient.spreadMethod)}${attr("gradientTransform", gradientTransformValue(gradient))}${coordinateAttrs}>`);
    gradient.stops.forEach((stop) => lines.push(
        `${indent}  <stop${attr("id", stop.id)}${attr("offset", stop.offset)}${attr("stop-color", stop.color.hex)}${attr("stop-opacity", stop.color.alpha < 0.9999 ? stop.color.alpha : null)}/>`
    ));
    lines.push(`${indent}</${tag}>`);
}

function appendImportedSource(node: ImportedSourceNode, lines: string[], depth: number): void {
    const indent = "  ".repeat(depth);
    node.markup.split("\n").forEach((line) => lines.push(`${indent}${line}`));
}
