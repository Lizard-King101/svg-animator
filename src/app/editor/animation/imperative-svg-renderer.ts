import { writeAnimationProperty } from "../objects/animation-targets";
import { Group } from "../objects/elements/group.object";
import { Path } from "../objects/elements/path.object";
import { motionAdjustedMatrix } from "../objects/motion-path.object";
import { gradientPaints, gradientStopOpacity, paintOpacity, paintSVGValue } from "../objects/paint.object";
import { AnyElement, SVG } from "../objects/svg.object";
import { matrixToSvg } from "../objects/transform.object";
import { CompiledAnimationTrack } from "./animation-evaluation-plan";

type RenderDomain = "transform" | "geometry" | "appearance" | "visibility" | "gradient";

/** Retained direct-DOM adapter used only while previewing animation. */
export class ImperativeSvgRenderer {
    private nodes = new Map<string, SVGElement | null>();
    private dirty = new Map<AnyElement, Set<RenderDomain>>();

    constructor(private svg: SVG, private root: ParentNode = document) {}

    apply(track: CompiledAnimationTrack, value: unknown): boolean {
        const target = track.target;
        if(!target || !writeAnimationProperty(target, track.property, value)) return false;
        let domains = this.dirty.get(target);
        if(!domains) {
            domains = new Set<RenderDomain>();
            this.dirty.set(target, domains);
        }
        domains.add(renderDomain(track.property));
        return true;
    }

    flush(): void {
        this.dirty.forEach((domains, target) => {
            const node = this.node(target.id);
            if(!node) return;
            if(domains.has("visibility")) node.style.display = target.visible ? "" : "none";
            if(domains.has("transform")) setAttribute(node, "transform", matrixToSvg(motionAdjustedMatrix(this.svg, target)));
            if(domains.has("geometry") && target instanceof Path) {
                setAttribute(node, "d", target.raw);
                const progress = Math.max(0, Math.min(1, target.drawProgress));
                setAttribute(node, "pathLength", progress < 1 ? 1 : null);
                setAttribute(node, "stroke-dasharray", progress < 1 ? 1 : null);
                setAttribute(node, "stroke-dashoffset", progress < 1 ? 1 - progress : null);
            }
            if(domains.has("appearance")) this.writeAppearance(node, target);
            if(domains.has("gradient")) this.writeGradients(target);
        });
        this.dirty.clear();
    }

    clear(): void {
        this.dirty.clear();
        this.nodes.clear();
    }

    private writeAppearance(node: SVGElement, target: AnyElement): void {
        setAttribute(node, "opacity", target.opacity === 1 ? null : target.opacity);
        const settings = target.settings as Record<string, unknown>;
        if("fill" in settings) {
            setAttribute(node, "fill", paintSVGValue(settings["fill"] as never) ?? "none");
            setAttribute(node, "fill-opacity", paintOpacity(settings["fill"] as never));
        }
        if("stroke" in settings) {
            setAttribute(node, "stroke", paintSVGValue(settings["stroke"] as never));
            setAttribute(node, "stroke-opacity", paintOpacity(settings["stroke"] as never));
        }
        if("color" in settings) {
            setAttribute(node, "fill", paintSVGValue(settings["color"] as never) ?? "#000000");
            setAttribute(node, "fill-opacity", paintOpacity(settings["color"] as never));
        }
        if("stroke_width" in settings) setAttribute(node, "stroke-width", settings["stroke_width"] as string | number);
    }

    private writeGradients(target: AnyElement): void {
        const settings = target.settings as Record<string, unknown>;
        gradientPaints(settings).forEach((paint) => {
            const gradient = this.node(paint.id);
            if(!gradient) return;
            Object.entries(paint.coordinates).forEach(([key, value]) => setAttribute(gradient, key, value));
            paint.stops.forEach((stop) => {
                const node = this.node(stop.id);
                if(!node) return;
                setAttribute(node, "offset", stop.offset);
                setAttribute(node, "stop-color", stop.color.hex);
                setAttribute(node, "stop-opacity", gradientStopOpacity(stop));
            });
        });
    }

    private node(id: string): SVGElement | null {
        if(this.nodes.has(id)) return this.nodes.get(id)!;
        const node = this.root.querySelector<SVGElement>(`[id="${cssAttributeValue(id)}"]`);
        this.nodes.set(id, node);
        return node;
    }
}

function renderDomain(property: string): RenderDomain {
    if(property === "visible") return "visibility";
    if(property.startsWith("transform.") || property.startsWith("motion.")) return "transform";
    if(property.startsWith("path.points.") || property === "path.drawProgress") return "geometry";
    if(property.includes(".gradient.")) return "gradient";
    return "appearance";
}

function setAttribute(node: SVGElement, name: string, value: string | number | null | undefined): void {
    if(value == null || value === "") node.removeAttribute(name);
    else node.setAttribute(name, String(value));
}

function cssAttributeValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
