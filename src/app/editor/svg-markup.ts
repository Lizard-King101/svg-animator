import { Path } from "./objects/elements/path.object";
import { Shape } from "./objects/elements/shape.object";
import { TextElement } from "./objects/elements/text.object";
import { SVG } from "./objects/svg.object";

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

export function buildSVGMarkup(svg: SVG): string {
    const lines: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${escapeXmlAttribute(svg.width)}" height="${escapeXmlAttribute(svg.height)}" viewBox="0 0 ${escapeXmlAttribute(svg.width)} ${escapeXmlAttribute(svg.height)}">`
    ];

    for(const element of svg.elements) {
        if(!element.visible) continue;

        if(element instanceof Path) {
            const s = element.settings;
            lines.push(
                `  <path` +
                attr('d', element.raw) +
                attr('fill', s.fill_enabled && s.fill ? s.fill.hex : 'none') +
                attr('stroke', s.stroke?.hex ?? null) +
                attr('stroke-width', s.stroke_width ?? null) +
                attr('stroke-linecap', s.line_cap ?? null) +
                attr('stroke-linejoin', s.line_join ?? null) +
                `/>`
            );
        } else if(element instanceof TextElement) {
            const s = element.settings;
            const tspans = element.lines.map((line, i) =>
                `    <tspan${i === 0 ? '' : attr('x', element.x) + attr('dy', element.lineHeight)}>${escapeXmlText(line)}</tspan>`
            ).join('\n');
            lines.push(
                `  <text` +
                attr('x', element.x) +
                attr('y', element.y) +
                attr('font-size', s.font_size) +
                attr('font-family', s.font_family) +
                attr('font-weight', s.font_weight) +
                attr('text-anchor', element.textAnchor) +
                attr('fill', s.color?.hex ?? '#000000') +
                ` dominant-baseline="hanging">` +
                `\n${tspans}\n  </text>`
            );
        } else if(element instanceof Shape) {
            const s = element.settings;
            const fillAttr = attr('fill', s.fill?.hex ?? 'none');
            const strokeAttr = attr('stroke', s.stroke?.hex ?? null);
            const swAttr = attr('stroke-width', s.stroke_width ?? null);
            if(element.type === 'rectangle') {
                const cr = s.corner_radius || null;
                lines.push(
                    `  <rect` +
                    attr('x', element.x) +
                    attr('y', element.y) +
                    attr('width', element.width) +
                    attr('height', element.height) +
                    attr('rx', cr) +
                    attr('ry', cr) +
                    fillAttr + strokeAttr + swAttr +
                    `/>`
                );
            } else {
                lines.push(
                    `  <ellipse` +
                    attr('cx', element.centerX) +
                    attr('cy', element.centerY) +
                    attr('rx', element.radiusX) +
                    attr('ry', element.radiusY) +
                    fillAttr + strokeAttr + swAttr +
                    `/>`
                );
            }
        }
    }

    lines.push('</svg>');
    return lines.join('\n');
}
