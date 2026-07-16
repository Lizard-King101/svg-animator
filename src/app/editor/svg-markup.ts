import { Group } from "./objects/elements/group.object";
import { Path } from "./objects/elements/path.object";
import { Shape } from "./objects/elements/shape.object";
import { TextElement } from "./objects/elements/text.object";
import { motionAdjustedMatrix } from "./objects/motion-path.object";
import { AnyElement, ImportedSourceNode, SVG } from "./objects/svg.object";
import { matrixToSvg } from "./objects/transform.object";
import { GradientPaint, gradientPaints, gradientTransformValue, paintOpacity, paintSVGValue } from "./objects/paint.object";
import { effectiveStrokeAlignment, strokeDasharrayAttr } from "./objects/stroke-style.object";

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
        `<svg xmlns="http://www.w3.org/2000/svg" width="${escapeXmlAttribute(svg.width)}" height="${escapeXmlAttribute(svg.height)}" viewBox="${escapeXmlAttribute(svg.viewBoxX)} ${escapeXmlAttribute(svg.viewBoxY)} ${escapeXmlAttribute(svg.width)} ${escapeXmlAttribute(svg.height)}">`
    ];
    const gradients = collectGradients(svg.elements);
    if(gradients.length > 0) {
        lines.push("  <defs>");
        gradients.forEach((gradient) => appendGradient(gradient, lines, 2));
        lines.push("  </defs>");
    }

    const appendElements = (elements: AnyElement[], depth: number, parentId: string | null | undefined, clipGeometry = false) => {
        const indent = '  '.repeat(depth);
        for(const element of elements) {
            if(!element.visible) continue;
            const transform = matrixToSvg(motionAdjustedMatrix(svg, element));

            if(element instanceof Group) {
                if(element.clipElement) {
                    lines.push(`${indent}<defs>`);
                    lines.push(`${indent}  <clipPath${attr('id', element.clipPathId)}>`);
                    appendElements([element.clipElement] as AnyElement[], depth + 2, undefined, true);
                    lines.push(`${indent}  </clipPath>`);
                    lines.push(`${indent}</defs>`);
                }
                lines.push(`${indent}<g${attr('id', element.id)}${attr('transform', transform)}${attr('opacity', opacityAttr(element.opacity))}${attr('clip-path', element.clipElement ? `url(#${element.clipPathId})` : null)}>`);
                appendElements(element.renderedElements as AnyElement[], depth + 1, element.id, clipGeometry);
                lines.push(`${indent}</g>`);
            } else if(element instanceof Path) {
                const s = element.settings;
                const d = bakeRoundedCorners ? element.raw : element.rawUnrounded;
                if(clipGeometry) {
                    lines.push(`${indent}<path${attr('id', element.id)}${attr('d', d)}${attr('transform', transform)}${attr('fill-rule', element.fillRule)}/>`);
                    continue;
                }
                const alignment = effectiveStrokeAlignment(element);
                const authoredDash = strokeDasharrayAttr(s.stroke_dasharray);
                if(alignment !== "center" || authoredDash) {
                    appendAlignedPath(element, d, transform, lines, depth);
                    continue;
                }
                lines.push(
                    `${indent}<path` +
                    attr('id', element.id) +
                    attr('d', d) +
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
                    attr('stroke-miterlimit', s.stroke_miterlimit) +
                    attr('pathLength', authoredDash ? null : drawAttr(element, 1)) +
                    attr('stroke-dasharray', authoredDash ?? drawAttr(element, 1)) +
                    attr('stroke-dashoffset', authoredDash ? s.stroke_dashoffset : drawDashoffsetAttr(element)) +
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
                    attr('fill', paintSVGValue(s.color) ?? '#000000') +
                    attr('fill-opacity', paintOpacity(s.color)) +
                    ` dominant-baseline="hanging">` +
                    `\n${tspans}\n${indent}</text>`
                );
            } else if(element instanceof Shape) {
                const s = element.settings;
                if(clipGeometry) {
                    lines.push(`${indent}${shapeGeometryMarkup(element, transform, element.id)}`);
                    continue;
                }
                if(effectiveStrokeAlignment(element) !== "center") {
                    appendAlignedShape(element, transform, lines, depth);
                    continue;
                }
                const fillAttr = attr('fill', paintSVGValue(s.fill) ?? 'none');
                const strokeAttr = attr('stroke', paintSVGValue(s.stroke));
                const fillOpacityAttr = attr('fill-opacity', paintOpacity(s.fill));
                const strokeOpacityAttr = attr('stroke-opacity', paintOpacity(s.stroke));
                const swAttr = attr('stroke-width', s.stroke_width ?? null);
                const strokeStyleAttrs = attr('stroke-linecap', s.line_cap) + attr('stroke-linejoin', s.line_join)
                    + attr('stroke-miterlimit', s.stroke_miterlimit) + attr('stroke-dasharray', strokeDasharrayAttr(s.stroke_dasharray))
                    + attr('stroke-dashoffset', s.stroke_dasharray.length ? s.stroke_dashoffset : null);
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
                        fillAttr + fillOpacityAttr + strokeAttr + strokeOpacityAttr + swAttr + strokeStyleAttrs +
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
                        fillAttr + fillOpacityAttr + strokeAttr + strokeOpacityAttr + swAttr + strokeStyleAttrs +
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

function appendAlignedPath(path: Path, d: string, transform: string | null, lines: string[], depth: number): void {
    const indent = "  ".repeat(depth);
    const child = "  ".repeat(depth + 1);
    const settings = path.settings;
    const alignment = effectiveStrokeAlignment(path);
    const effectId = `stroke-${alignment}-${path.id}`;
    const drawId = `stroke-draw-${path.id}`;
    lines.push(`${indent}<defs>`);
    if(alignment === "inside") {
        lines.push(`${child}<clipPath${attr('id', effectId)}><path${attr('d', d)}${attr('fill-rule', path.fillRule)}/></clipPath>`);
    } else if(alignment === "outside") {
        lines.push(`${child}<mask${attr('id', effectId)} x="-100%" y="-100%" width="300%" height="300%" maskUnits="objectBoundingBox"><rect x="-100%" y="-100%" width="300%" height="300%" fill="white"/><path${attr('d', d)}${attr('fill-rule', path.fillRule)} fill="black"/></mask>`);
    }
    if(settings.stroke_dasharray.length) {
        lines.push(`${child}<mask${attr('id', drawId)} x="-100%" y="-100%" width="300%" height="300%" maskUnits="objectBoundingBox"><path${attr('d', d)} fill="none" stroke="white"${attr('stroke-width', settings.stroke_width * 4)}${attr('stroke-linecap', settings.line_cap)} pathLength="1" stroke-dasharray="1"${attr('stroke-dashoffset', drawOffsetAttr(path))}/></mask>`);
    }
    lines.push(`${indent}</defs>`);
    lines.push(`${indent}<g${attr('id', path.id)}${attr('transform', transform)}${attr('opacity', opacityAttr(path.opacity))}>`);
    lines.push(`${child}<path${attr('d', d)}${attr('fill', settings.fill_enabled ? paintSVGValue(settings.fill) ?? 'none' : 'none')}${attr('fill-opacity', settings.fill_enabled ? paintOpacity(settings.fill) : null)}${attr('fill-rule', path.fillRule)}/>`);
    if(alignment === "outside") lines.push(`${child}<g${attr('mask', `url(#${effectId})`)}>`);
    lines.push(`${alignment === 'outside' ? child + '  ' : child}<path${attr('d', d)} fill="none"${strokePaintAttrs(settings, alignment === 'center' ? 1 : 2)}${attr('pathLength', settings.stroke_dasharray.length ? null : drawAttr(path, 1))}${attr('stroke-dasharray', settings.stroke_dasharray.length ? strokeDasharrayAttr(settings.stroke_dasharray) : drawAttr(path, 1))}${attr('stroke-dashoffset', settings.stroke_dasharray.length ? settings.stroke_dashoffset : drawDashoffsetAttr(path))}${attr('clip-path', alignment === 'inside' ? `url(#${effectId})` : null)}${attr('mask', settings.stroke_dasharray.length ? `url(#${drawId})` : null)}/>`);
    if(alignment === "outside") lines.push(`${child}</g>`);
    lines.push(`${indent}</g>`);
}

function appendAlignedShape(shape: Shape, transform: string | null, lines: string[], depth: number): void {
    const indent = "  ".repeat(depth);
    const child = "  ".repeat(depth + 1);
    const settings = shape.settings;
    const alignment = effectiveStrokeAlignment(shape);
    const effectId = `stroke-${alignment}-${shape.id}`;
    const geometry = shapeGeometryMarkup(shape, null, "");
    lines.push(`${indent}<defs>`);
    if(alignment === "inside") {
        lines.push(`${child}<clipPath${attr('id', effectId)}>${geometry}</clipPath>`);
    } else {
        lines.push(`${child}<mask${attr('id', effectId)} x="-100%" y="-100%" width="300%" height="300%" maskUnits="objectBoundingBox"><rect x="-100%" y="-100%" width="300%" height="300%" fill="white"/>${geometry.replace('/>', ' fill="black"/>')}</mask>`);
    }
    lines.push(`${indent}</defs>`);
    lines.push(`${indent}<g${attr('id', shape.id)}${attr('transform', transform)}${attr('opacity', opacityAttr(shape.opacity))}>`);
    lines.push(`${child}${geometry.replace('/>', `${attr('fill', paintSVGValue(settings.fill) ?? 'none')}${attr('fill-opacity', paintOpacity(settings.fill))}/>` )}`);
    lines.push(`${child}${geometry.replace('/>', ` fill="none"${strokePaintAttrs(settings, 2)}${attr('stroke-dasharray', strokeDasharrayAttr(settings.stroke_dasharray))}${attr('stroke-dashoffset', settings.stroke_dasharray.length ? settings.stroke_dashoffset : null)}${attr(alignment === 'inside' ? 'clip-path' : 'mask', `url(#${effectId})`)}/>` )}`);
    lines.push(`${indent}</g>`);
}

function strokePaintAttrs(settings: Path["settings"] | Shape["settings"], widthMultiplier: number): string {
    return attr('stroke', paintSVGValue(settings.stroke))
        + attr('stroke-opacity', paintOpacity(settings.stroke))
        + attr('stroke-width', settings.stroke_width * widthMultiplier)
        + attr('stroke-linecap', settings.line_cap)
        + attr('stroke-linejoin', settings.line_join)
        + attr('stroke-miterlimit', settings.stroke_miterlimit);
}

function shapeGeometryMarkup(shape: Shape, transform: string | null, id?: string): string {
    const common = attr('id', id) + attr('transform', transform);
    if(shape.type === 'rectangle') {
        const radius = shape.settings.corner_radius || null;
        return `<rect${common}${attr('x', shape.x)}${attr('y', shape.y)}${attr('width', shape.width)}${attr('height', shape.height)}${attr('rx', radius)}${attr('ry', radius)}/>`;
    }
    return `<ellipse${common}${attr('cx', shape.centerX)}${attr('cy', shape.centerY)}${attr('rx', shape.radiusX)}${attr('ry', shape.radiusY)}/>`;
}

function collectGradients(elements: AnyElement[]): GradientPaint[] {
    const gradients = new Map<string, GradientPaint>();
    const visit = (element: AnyElement) => {
        const settings = element.settings as Record<string, unknown>;
        gradientPaints(settings).forEach((paint) => gradients.set(paint.id, paint));
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
