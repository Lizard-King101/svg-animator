import { RenderNodeCache } from './render-node-cache';
import { readAnimationProperty, writeAnimationProperty } from "../objects/animation-targets";
import { Group } from "../objects/elements/group.object";
import { Path } from "../objects/elements/path.object";
import { Shape } from "../objects/elements/shape.object";
import { TextElement } from "../objects/elements/text.object";
import { motionAdjustedMatrix } from "../objects/motion-path.object";
import { gradientPaints, gradientStopOpacity, gradientTransformValue, paintOpacity, paintSVGValue } from "../objects/paint.object";
import { AnyElement, SVG } from "../objects/svg.object";
import { matrixToSvg } from "../objects/transform.object";
import { drawProgressVisible, effectiveStrokeAlignment } from "../objects/stroke-style.object";
import { CompiledAnimationTrack } from "./animation-evaluation-plan";
import { isClippingGeometry, projectedDefinitionId, renderTargetNodes } from "../../../../packages/runtime/src/render-roles.internal";
import { outlineGradientTransform, outlineStrokePaint, projectPathOutline } from '../path-outline';

type RenderDomain = "transform" | "geometry" | "appearance" | "visibility" | "gradient";

/** Retained direct-DOM adapter used only while previewing animation. */
export class ImperativeSvgRenderer {
    private nodeRevision = -1;
    private nodes = new Map<string, SVGElement[]>();
    private dirty = new Map<AnyElement, Set<RenderDomain>>();

    private readonly roles: RenderNodeCache;
    constructor(private svg: SVG, private root: ParentNode = document) { this.roles = new RenderNodeCache(root); }

    destroy(): void { this.clear(); this.roles.destroy(); }

    apply(track: CompiledAnimationTrack, value: unknown): boolean {
        const target = track.target;
        if(target && (track.property.startsWith('transform.') || track.property === 'opacity' || track.property === 'visible')
            && Object.is(readAnimationProperty(target, track.property), value)) return true;
        if(!target || !writeAnimationProperty(target, track.property, value)) return false;
        this.markDirty(target, [renderDomain(track.property)]);
        return true;
    }

    /** Rig evaluation changes several artwork properties after all channels have sampled. */
    markDirty(target: AnyElement, changed: RenderDomain[] = ['geometry', 'transform']): void {
        let domains = this.dirty.get(target);
        if(!domains) {
            domains = new Set<RenderDomain>();
            this.dirty.set(target, domains);
        }
        changed.forEach(domain => domains!.add(domain));
    }

    flush(): void {
        this.dirty.forEach((domains, target) => {
            this.targetNodes(target.id).forEach(node => {
                if(domains.has("visibility")) node.style.display = node.getAttribute('data-render-projection') === 'clip' || target.visible ? '' : 'none';
                if(domains.has("transform")) setAttribute(node, "transform", matrixToSvg(motionAdjustedMatrix(this.svg, target)));
                if(domains.has("geometry") || target instanceof Path && target.outlineSections !== undefined && domains.has('appearance')) this.writeGeometry(node, target);
                if(domains.has("appearance") && !isClippingGeometry(node)) this.writeAppearance(node, target);
            });
            if(domains.has("gradient")) this.writeGradients(target);
        });
        this.dirty.clear();
    }

    clear(): void {
        this.dirty.clear();
        this.nodes.clear();
        this.roles.clear();
    }

    private writeAppearance(node: SVGElement, target: AnyElement): void {
        setAttribute(node, "opacity", target.opacity === 1 ? null : target.opacity);
        const settings = target.settings as Record<string, unknown>;
        const fillNodes = this.roles.paint(node, 'fill');
        const strokeNodes = this.roles.paint(node, 'stroke');
        if("fill" in settings) {
            fillNodes.forEach((item) => {
                setAttribute(item, "fill", paintSVGValue(settings["fill"] as never) ?? "none");
                setAttribute(item, "fill-opacity", paintOpacity(settings["fill"] as never));
            });
        }
        if("stroke" in settings) {
            strokeNodes.forEach((item) => {
                setAttribute(item, "stroke", paintSVGValue(settings["stroke"] as never));
                setAttribute(item, "stroke-opacity", paintOpacity(settings["stroke"] as never));
            });
            if(target instanceof Path && target.outlineSections !== undefined) this.roles.query(node, '[data-render-role~="outline"]').forEach(item => {
                const paint = outlineStrokePaint(target);
                setAttribute(item, 'fill', paint === `url(#outline-paint-${target.id})` ? `url(#${projectedDefinitionId(node, `outline-paint-${target.id}`)})` : paint ?? 'none');
                setAttribute(item, 'fill-opacity', paintOpacity(target.settings.stroke));
            });
        }
        if("color" in settings && node.getAttribute('data-render-projection') !== 'stroke') {
            setAttribute(node, "fill", paintSVGValue(settings["color"] as never) ?? "#000000");
            setAttribute(node, "fill-opacity", paintOpacity(settings["color"] as never));
        }
        if("stroke_width" in settings) strokeNodes.forEach((item) => setAttribute(item, "stroke-width",
            Number(settings["stroke_width"]) * ((target instanceof Path || target instanceof Shape) && effectiveStrokeAlignment(target) !== 'center' ? 2 : 1)));
        if("stroke_width" in settings && target instanceof Path) {
            this.roles.reveal(node, target.id).forEach((item) => setAttribute(item, "stroke-width", Number(settings["stroke_width"]) * 4));
        }
        if("stroke_dashoffset" in settings && (!(target instanceof Path) || target.settings.stroke_dasharray.length > 0)) {
            strokeNodes.forEach((item) => setAttribute(item, "stroke-dashoffset", settings["stroke_dashoffset"] as number));
        }
        if(target instanceof Path) this.writePathDrawVisibility(node, target);
    }

    private writeGeometry(node: SVGElement, target: AnyElement): void {
        if(target instanceof Path) {
            const data = target.raw;
            this.roles.geometry(node, target.id).forEach(geometry => setAttribute(geometry, 'd', data));
            if(isClippingGeometry(node)) return;
            if(target.outlineSections !== undefined) {
                const outline = projectPathOutline(target).strokeData;
                this.roles.query(node, '[data-render-role~="outline"]').forEach(item => setAttribute(item, 'd', outline));
                this.targetNodes(`outline-paint-${target.id}`).forEach(gradient => setAttribute(gradient, 'gradientTransform', outlineGradientTransform(target)));
                return;
            }
            const progress = Math.max(0, Math.min(1, target.drawProgress));
            if(target.settings.stroke_dasharray.length > 0) this.roles.reveal(node, target.id).forEach((reveal) => setAttribute(reveal, "stroke-dashoffset", 1 - progress));
            else {
                const strokeNodes = this.roles.paint(node, 'stroke');
                strokeNodes.forEach((stroke) => {
                    setAttribute(stroke, "pathLength", progress < 1 ? 1 : null);
                    setAttribute(stroke, "stroke-dasharray", progress < 1 ? "1 2" : null);
                    setAttribute(stroke, "stroke-dashoffset", progress < 1 ? 1 - progress : null);
                });
            }
            this.writePathDrawVisibility(node, target);
            return;
        }
        if(target instanceof Shape) {
            const geometry = this.roles.geometry(node, target.id);
            geometry.forEach((item) => {
                if(target.type === "rectangle") {
                    setAttribute(item, "x", target.x);
                    setAttribute(item, "y", target.y);
                    setAttribute(item, "width", target.width);
                    setAttribute(item, "height", target.height);
                } else {
                    setAttribute(item, "cx", target.centerX);
                    setAttribute(item, "cy", target.centerY);
                    setAttribute(item, "rx", target.radiusX);
                    setAttribute(item, "ry", target.radiusY);
                }
            });
            return;
        }
        if(target instanceof TextElement) {
            setAttribute(node, "x", target.x);
            setAttribute(node, "y", target.y);
            this.roles.query(node, "tspan").forEach((span) => setAttribute(span, "x", target.x));
        }
    }

    private writeGradients(target: AnyElement): void {
        const settings = target.settings as Record<string, unknown>;
        gradientPaints(settings).forEach((paint) => {
            this.targetNodes(paint.id).forEach(gradient => {
                setAttribute(gradient, "gradientTransform", gradientTransformValue(paint));
                Object.entries(paint.coordinates).forEach(([key, value]) => setAttribute(gradient, key, value));
            });
            paint.stops.forEach((stop) => {
                this.targetNodes(stop.id).forEach(node => {
                    setAttribute(node, "offset", stop.offset);
                    setAttribute(node, "stop-color", stop.color.hex);
                    setAttribute(node, "stop-opacity", gradientStopOpacity(stop));
                });
            });
        });
        if(target instanceof Path && target.outlineSections !== undefined) {
            this.targetNodes(`outline-paint-${target.id}`).forEach(gradient => setAttribute(gradient, 'gradientTransform', outlineGradientTransform(target)));
        }
    }

    private writePathDrawVisibility(node: SVGElement, target: Path): void {
        const progress = Math.max(0, Math.min(1, target.drawProgress));
        const reveal = this.roles.reveal(node, target.id);
        if(reveal.length > 0) {
            reveal.forEach((item) => setAttribute(item, "stroke-opacity", drawProgressVisible(progress) ? null : 0));
            return;
        }
        const strokeNodes = this.roles.paint(node, 'stroke');
        strokeNodes.forEach((item) => setAttribute(item, "stroke-opacity", drawProgressVisible(progress) ? paintOpacity(target.settings.stroke) : 0));
    }

    private targetNodes(id: string): SVGElement[] {
        const revision = this.roles.revision;
        if(this.nodeRevision !== revision) { this.nodes.clear(); this.nodeRevision = revision; }
        if(this.nodes.has(id)) return this.nodes.get(id)!;
        const nodes = renderTargetNodes(this.root, id);
        this.nodes.set(id, nodes);
        return nodes;
    }
}

function renderDomain(property: string): RenderDomain {
    if(property === "visible") return "visibility";
    if(property.startsWith("transform.") || property.startsWith("motion.")) return "transform";
    if(property.startsWith("geometry.") || property.startsWith("path.points.") || property === "path.drawProgress") return "geometry";
    if(property.includes(".gradient.")) return "gradient";
    return "appearance";
}

function setAttribute(node: SVGElement, name: string, value: string | number | null | undefined): void {
    const next = value == null || value === '' ? null : String(value);
    if(node.getAttribute(name) === next) return;
    if(next === null) node.removeAttribute(name); else node.setAttribute(name, next);
}
