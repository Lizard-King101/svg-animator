import {
    RuntimeContourV1,
    RuntimeGradientPaintV1,
    RuntimePaintV1,
    RuntimePointV1,
    RuntimeSceneTargetV1,
} from "./contracts";
import { packedColorValue } from "./evaluator";
import { buildRuntimePathData } from "./path-data";
import { pathRevealNodes } from "./render-roles.internal";

interface Matrix { a: number; b: number; c: number; d: number; e: number; f: number; }
interface SampledMotion { x: number; y: number; tangentAngle: number; }
interface GeometryAffine { scaleX: number; scaleY: number; translateX: number; translateY: number; }

export class RuntimeScene {
    readonly targets: RuntimeSceneTargetV1[];
    private readonly targetById = new Map<string, RuntimeSceneTargetV1>();
    private readonly nodeById = new Map<string, SVGElement | null>();

    constructor(private readonly root: SVGSVGElement, sourceTargets: RuntimeSceneTargetV1[]) {
        this.targets = clone(sourceTargets);
        this.targets.forEach((target) => this.targetById.set(target.id, target));
    }

    write(targetId: string, property: string, value: unknown): boolean {
        const target = this.targetById.get(targetId);
        if(!target) return false;
        const point = /^path\.points\.([^.]+)\.(x|y)$/.exec(property);
        if(point && target.path) return this.writePathPoint(target, point[1], point[2] as "x" | "y", value);
        const gradient = /^settings\.(fill|stroke|color)\.gradient\.(?:(x1|y1|x2|y2|cx|cy|r|fx|fy)|transform\.(a|b|c|d|e|f)|stops\.(.+)\.(offset|color|opacity))$/.exec(property);
        if(gradient) return this.writeGradient(target, gradient, value);
        const numeric = finite(value);
        switch(property) {
            case "geometry.x": return numeric == null ? false : this.writeGeometryPosition(target, "x", numeric);
            case "geometry.y": return numeric == null ? false : this.writeGeometryPosition(target, "y", numeric);
            case "geometry.width": return numeric == null ? false : this.writeGeometrySize(target, "width", numeric);
            case "geometry.height": return numeric == null ? false : this.writeGeometrySize(target, "height", numeric);
            case "transform.translateX": return assignNumber(target.transform, "translateX", numeric);
            case "transform.translateY": return assignNumber(target.transform, "translateY", numeric);
            case "transform.scaleX": return assignNumber(target.transform, "scaleX", numeric);
            case "transform.scaleY": return assignNumber(target.transform, "scaleY", numeric);
            case "transform.rotation": return assignNumber(target.transform, "rotation", numeric);
            case "transform.originX": return target.transform.autoOrigin ? numeric != null : assignNumber(target.transform, "originX", numeric);
            case "transform.originY": return target.transform.autoOrigin ? numeric != null : assignNumber(target.transform, "originY", numeric);
            case "opacity": if(numeric == null) return false; target.opacity = clamp01(numeric); return true;
            case "settings.fill": return this.writeSolidPaint(target, "fill", value);
            case "settings.stroke": return this.writeSolidPaint(target, "stroke", value);
            case "settings.color": return this.writeSolidPaint(target, "color", value);
            case "settings.stroke_width": if(numeric == null || !target.stroke) return false; target.stroke.width = numeric; return true;
            case "settings.stroke_dashoffset": if(numeric == null || !target.stroke) return false; target.stroke.dashoffset = numeric; return true;
            case "visible": target.visible = Boolean(value); return true;
            case "path.drawProgress": if(numeric == null || !target.path) return false; target.path.drawProgress = clamp01(numeric); return true;
            case "motion.pathId": target.motion.pathId = typeof value === "string" && value ? value : null; return true;
            case "motion.progress": if(numeric == null) return false; target.motion.progress = clamp01(numeric); return true;
            case "motion.offsetX": return assignNumber(target.motion, "offsetX", numeric);
            case "motion.offsetY": return assignNumber(target.motion, "offsetY", numeric);
            case "motion.rotateToPath": target.motion.rotateToPath = Boolean(value); return true;
            case "motion.offsetAngle": return assignNumber(target.motion, "offsetAngle", numeric);
            default: return false;
        }
    }

    render(): void {
        this.targets.forEach((target) => {
            const node = this.node(target.id);
            if(!node) return;
            node.style.display = target.visible ? "" : "none";
            setAttribute(node, "opacity", target.opacity === 1 ? null : round(target.opacity));
            setAttribute(node, "transform", matrixToSvg(this.motionAdjustedMatrix(target)));
            this.renderGeometry(node, target);
            this.renderAppearance(node, target);
            this.renderGradients(target);
        });
    }

    clear(): void { this.nodeById.clear(); }

    private writeGeometryPosition(target: RuntimeSceneTargetV1, axis: "x" | "y", value: number): boolean {
        if(target.type === "group") return false;
        const delta = value - target.geometry[axis];
        target.geometry[axis] = value;
        if(target.path) forEachPathPoint(target.path.contours, (point) => point[axis] += delta);
        this.transformAttachedGeometry(target, axis === "x"
            ? { scaleX: 1, scaleY: 1, translateX: delta, translateY: 0 }
            : { scaleX: 1, scaleY: 1, translateX: 0, translateY: delta });
        return true;
    }

    private writeGeometrySize(target: RuntimeSceneTargetV1, axis: "width" | "height", value: number): boolean {
        if(target.type !== "rectangle" && target.type !== "ellipse") return false;
        const next = Math.max(1, value);
        const from = { ...target.geometry };
        target.geometry[axis] = next;
        const scaleX = axis === "width" && from.width > 0.000001 ? next / from.width : 1;
        const scaleY = axis === "height" && from.height > 0.000001 ? next / from.height : 1;
        this.transformAttachedGeometry(target, {
            scaleX,
            scaleY,
            translateX: from.x - from.x * scaleX,
            translateY: from.y - from.y * scaleY,
        });
        return true;
    }

    /** Mirrors the editor's native-geometry mutation contract for pinned origins and user-space paints. */
    private transformAttachedGeometry(target: RuntimeSceneTargetV1, affine: GeometryAffine): void {
        target.transform.originX = target.transform.originX * affine.scaleX + affine.translateX;
        target.transform.originY = target.transform.originY * affine.scaleY + affine.translateY;
        const matrix: Matrix = {
            a: affine.scaleX,
            b: 0,
            c: 0,
            d: affine.scaleY,
            e: affine.translateX,
            f: affine.translateY,
        };
        Object.values(target.paints).forEach((paint) => {
            if(!paint || paint.kind !== "gradient" || paint.units !== "userSpaceOnUse") return;
            const transformed = multiply(matrix, tupleMatrix(paint.transform));
            paint.transform = [transformed.a, transformed.b, transformed.c, transformed.d, transformed.e, transformed.f];
        });
    }

    private writePathPoint(target: RuntimeSceneTargetV1, id: string, axis: "x" | "y", value: unknown): boolean {
        if(!target.path) return false;
        const before = target.geometry;
        if(!writePathPoint(target.path.contours, id, axis, value)) return false;
        const after = pathBounds(target.path.contours);
        if(target.transform.autoOrigin) {
            target.transform.originX += boundsCenter(after, "x") - boundsCenter(before, "x");
            target.transform.originY += boundsCenter(after, "y") - boundsCenter(before, "y");
        }
        target.geometry = after;
        return true;
    }

    private writeSolidPaint(target: RuntimeSceneTargetV1, key: "fill" | "stroke" | "color", value: unknown): boolean {
        if(typeof value !== "number") return false;
        const color = packedColorValue(value);
        target.paints[key] = { kind: "solid", ...color };
        return true;
    }

    private writeGradient(target: RuntimeSceneTargetV1, match: RegExpExecArray, value: unknown): boolean {
        const key = match[1] as "fill" | "stroke" | "color";
        const paint = target.paints[key];
        if(!paint || paint.kind !== "gradient") return false;
        const numeric = finite(value);
        if(match[2]) {
            if(numeric == null) return false;
            paint.coordinates[match[2] as keyof RuntimeGradientPaintV1["coordinates"]] = numeric;
            return true;
        }
        if(match[3]) {
            if(numeric == null) return false;
            paint.transform["abcdef".indexOf(match[3])] = numeric;
            return true;
        }
        const stop = paint.stops.find((candidate) => candidate.id === match[4]);
        if(!stop) return false;
        if(match[5] === "color") {
            if(typeof value !== "number") return false;
            Object.assign(stop, packedColorValue(value));
            return true;
        }
        if(numeric == null) return false;
        if(match[5] === "offset") stop.offset = clamp01(numeric); else stop.opacity = clamp01(numeric);
        return true;
    }

    private renderGeometry(node: SVGElement, target: RuntimeSceneTargetV1): void {
        const geometryNodes = node.tagName.toLowerCase() === "g"
            ? [...node.querySelectorAll<SVGElement>('[data-render-role~="geometry"], [data-render-role~="geometry-effect"]')]
            : [node];
        if(target.path) {
            const data = buildRuntimePathData(target.path.contours, target.path.rounded);
            geometryNodes.forEach((item) => setAttribute(item, "d", data));
            const progress = clamp01(target.path.drawProgress);
            const reveal = pathRevealNodes(this.root, node, target.id);
            if(reveal.length) reveal.forEach((item) => setAttribute(item, "stroke-dashoffset", round(1 - progress)));
            else this.roleNodes(node, "stroke").forEach((item) => {
                setAttribute(item, "pathLength", progress < 1 ? 1 : null);
                setAttribute(item, "stroke-dasharray", progress < 1 ? 1 : target.stroke?.dasharray.join(" ") || null);
                setAttribute(item, "stroke-dashoffset", progress < 1 ? round(1 - progress) : target.stroke?.dasharray.length ? target.stroke.dashoffset : null);
            });
            return;
        }
        if(target.type === "rectangle" || target.type === "ellipse") geometryNodes.forEach((item) => {
            if(target.type === "rectangle") {
                setAttribute(item, "x", target.geometry.x); setAttribute(item, "y", target.geometry.y);
                setAttribute(item, "width", target.geometry.width); setAttribute(item, "height", target.geometry.height);
            } else {
                setAttribute(item, "cx", target.geometry.x + target.geometry.width / 2); setAttribute(item, "cy", target.geometry.y + target.geometry.height / 2);
                setAttribute(item, "rx", target.geometry.width / 2); setAttribute(item, "ry", target.geometry.height / 2);
            }
        });
        if(target.type === "text") {
            setAttribute(node, "x", target.geometry.x); setAttribute(node, "y", target.geometry.y);
            node.querySelectorAll<SVGElement>("tspan").forEach((span) => setAttribute(span, "x", target.geometry.x));
        }
    }

    private renderAppearance(node: SVGElement, target: RuntimeSceneTargetV1): void {
        const fill = target.paints.fill;
        const stroke = target.paints.stroke;
        const color = target.paints.color;
        if(fill !== undefined) this.roleNodes(node, "fill").forEach((item) => writePaint(item, "fill", fill, "none"));
        if(stroke !== undefined) this.roleNodes(node, "stroke").forEach((item) => writePaint(item, "stroke", stroke, null));
        if(color !== undefined) writePaint(node, "fill", color, "#000000");
        if(target.stroke) {
            const multiplier = target.stroke.alignment === "center" ? 1 : 2;
            this.roleNodes(node, "stroke").forEach((item) => {
                setAttribute(item, "stroke-width", round(target.stroke!.width * multiplier));
                if(target.stroke!.dasharray.length) {
                    setAttribute(item, "stroke-dasharray", target.stroke!.dasharray.join(" "));
                    setAttribute(item, "stroke-dashoffset", target.stroke!.dashoffset);
                }
            });
            pathRevealNodes(this.root, node, target.id).forEach((item) => setAttribute(item, "stroke-width", target.stroke!.width * 4));
        }
    }

    private renderGradients(target: RuntimeSceneTargetV1): void {
        Object.values(target.paints).forEach((paint) => {
            if(!paint || paint.kind !== "gradient") return;
            const gradient = this.node(paint.id);
            if(!gradient) return;
            setAttribute(gradient, "gradientTransform", isIdentityTransform(paint.transform) ? null : `matrix(${paint.transform.map(round).join(" ")})`);
            Object.entries(paint.coordinates).forEach(([name, value]) => setAttribute(gradient, name, value));
            paint.stops.forEach((stop) => {
                const stopNode = this.node(stop.id);
                if(!stopNode) return;
                setAttribute(stopNode, "offset", round(stop.offset));
                setAttribute(stopNode, "stop-color", stop.color);
                setAttribute(stopNode, "stop-opacity", stop.opacity < 0.9999 ? round(stop.opacity) : null);
            });
        });
    }

    private roleNodes(node: SVGElement, role: "fill" | "stroke"): SVGElement[] {
        if(node.tagName.toLowerCase() !== "g") return [node];
        return [...node.querySelectorAll<SVGElement>(`[data-render-role~="${role}"]`)];
    }

    private motionAdjustedMatrix(target: RuntimeSceneTargetV1): Matrix {
        const base = this.ownMatrix(target, 0);
        const sampled = this.sampleMotion(target);
        if(!sampled) return base;
        const rotation = (target.motion.rotateToPath ? sampled.tangentAngle : 0) + target.motion.offsetAngle;
        const matrix = this.ownMatrix(target, rotation);
        const origin = { x: target.transform.originX, y: target.transform.originY };
        const currentOrigin = applyMatrix(matrix, origin.x, origin.y);
        const offset = rotateVector(target.motion.offsetX, target.motion.offsetY, target.transform.rotation + rotation);
        return multiply(translation(sampled.x + offset.x - currentOrigin.x, sampled.y + offset.y - currentOrigin.y), matrix);
    }

    private sampleMotion(target: RuntimeSceneTargetV1): SampledMotion | undefined {
        const path = target.motion.pathId ? this.targetById.get(target.motion.pathId) : undefined;
        if(!path?.path || path.id === target.id) return undefined;
        const segments = flattenRuntimePath(path.path.contours, this.combinedMatrix(path));
        const total = segments.reduce((sum, segment) => sum + segment.length, 0);
        if(total <= 0) return undefined;
        const desired = clamp01(target.motion.progress) * total;
        let consumed = 0;
        let selected = segments[segments.length - 1];
        let amount = 1;
        for(const segment of segments) {
            if(consumed + segment.length >= desired) { selected = segment; amount = segment.length ? (desired - consumed) / segment.length : 0; break; }
            consumed += segment.length;
        }
        const world = { x: selected.start.x + (selected.end.x - selected.start.x) * amount, y: selected.start.y + (selected.end.y - selected.start.y) * amount };
        const inverse = invert(this.parentMatrix(target));
        const point = applyMatrix(inverse, world.x, world.y);
        const tangentEnd = applyMatrix(inverse, world.x + selected.end.x - selected.start.x, world.y + selected.end.y - selected.start.y);
        return { x: point.x, y: point.y, tangentAngle: Math.atan2(tangentEnd.y - point.y, tangentEnd.x - point.x) * 180 / Math.PI };
    }

    private combinedMatrix(target: RuntimeSceneTargetV1): Matrix {
        return this.chain(target).reduce((matrix, item) => multiply(matrix, this.ownMatrix(item, 0)), identity());
    }
    private parentMatrix(target: RuntimeSceneTargetV1): Matrix {
        return this.chain(target).slice(0, -1).reduce((matrix, item) => multiply(matrix, this.ownMatrix(item, 0)), identity());
    }
    private chain(target: RuntimeSceneTargetV1): RuntimeSceneTargetV1[] {
        const result: RuntimeSceneTargetV1[] = [target];
        let parentId = target.parentId;
        while(parentId) {
            const parent = this.targetById.get(parentId);
            if(!parent) break;
            result.unshift(parent); parentId = parent.parentId;
        }
        return result;
    }
    private ownMatrix(target: RuntimeSceneTargetV1, extraRotation: number): Matrix {
        const transform = target.transform;
        return [
            translation(transform.translateX, transform.translateY),
            translation(transform.originX, transform.originY),
            rotation(transform.rotation + extraRotation),
            scale(transform.scaleX, transform.scaleY),
            translation(-transform.originX, -transform.originY),
        ].reduce(multiply, identity());
    }

    private node(id: string): SVGElement | null {
        if(this.nodeById.has(id)) return this.nodeById.get(id)!;
        const node = this.root.querySelector<SVGElement>(`[id="${attributeSelectorValue(id)}"]`);
        this.nodeById.set(id, node);
        return node;
    }
}

function writePaint(node: SVGElement, attribute: "fill" | "stroke", paint: RuntimePaintV1, fallback: string | null): void {
    const opacityAttribute = `${attribute}-opacity`;
    if(!paint) { setAttribute(node, attribute, fallback); setAttribute(node, opacityAttribute, null); }
    else if(paint.kind === "gradient") { setAttribute(node, attribute, `url(#${paint.id})`); setAttribute(node, opacityAttribute, null); }
    else { setAttribute(node, attribute, paint.color); setAttribute(node, opacityAttribute, paint.opacity < 0.9999 ? round(paint.opacity) : null); }
}
function writePathPoint(contours: RuntimeContourV1[], id: string, axis: "x" | "y", value: unknown): boolean {
    const numeric = finite(value); if(numeric == null) return false;
    let found = false;
    forEachPathPoint(contours, (point) => { if(point.id === id) { point[axis] = numeric; found = true; } });
    return found;
}
function forEachPathPoint(contours: RuntimeContourV1[], callback: (point: RuntimePointV1) => void): void {
    contours.forEach((contour) => contour.lines.forEach((line) => {
        line.points.forEach(callback); if(line.controlStart) callback(line.controlStart); if(line.controlEnd) callback(line.controlEnd);
    }));
}
function pathBounds(contours: RuntimeContourV1[]): RuntimeSceneTargetV1["geometry"] {
    const points: RuntimePointV1[] = [];
    forEachPathPoint(contours, (point) => points.push(point));
    if(!points.length) return { x: 0, y: 0, width: 0, height: 0 };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs); const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
function boundsCenter(bounds: RuntimeSceneTargetV1["geometry"], axis: "x" | "y"): number {
    return bounds[axis] + bounds[axis === "x" ? "width" : "height"] / 2;
}
function flattenRuntimePath(contours: RuntimeContourV1[], matrix: Matrix) {
    return contours.flatMap((contour) => contour.lines).flatMap((line) => {
        const start = line.points[0]; const end = line.points[1];
        if(line.type !== "bezier" || !line.controlStart || !line.controlEnd) return [segment(applyMatrix(matrix, start.x, start.y), applyMatrix(matrix, end.x, end.y))];
        const points = Array.from({ length: 33 }, (_, index) => applyMatrix(matrix, ...Object.values(cubic(start, line.controlStart!, line.controlEnd!, end, index / 32)) as [number, number]));
        return points.slice(0, -1).map((point, index) => segment(point, points[index + 1]));
    }).filter((item) => item.length > 0);
}
function cubic(a: RuntimePointV1, b: RuntimePointV1, c: RuntimePointV1, d: RuntimePointV1, t: number) {
    const m = 1 - t; return { x: m*m*m*a.x + 3*m*m*t*b.x + 3*m*t*t*c.x + t*t*t*d.x, y: m*m*m*a.y + 3*m*m*t*b.y + 3*m*t*t*c.y + t*t*t*d.y };
}
function segment(start: {x:number;y:number}, end: {x:number;y:number}) { return { start, end, length: Math.hypot(end.x-start.x, end.y-start.y) }; }
function identity(): Matrix { return { a:1,b:0,c:0,d:1,e:0,f:0 }; }
function tupleMatrix(value: readonly number[]): Matrix { return { a:value[0],b:value[1],c:value[2],d:value[3],e:value[4],f:value[5] }; }
function translation(x:number,y:number): Matrix { return { a:1,b:0,c:0,d:1,e:x,f:y }; }
function scale(x:number,y:number): Matrix { return { a:x,b:0,c:0,d:y,e:0,f:0 }; }
function rotation(degrees:number): Matrix { const r=degrees*Math.PI/180,c=Math.cos(r),s=Math.sin(r); return {a:c,b:s,c:-s,d:c,e:0,f:0}; }
function multiply(left:Matrix,right:Matrix):Matrix { return {a:left.a*right.a+left.c*right.b,b:left.b*right.a+left.d*right.b,c:left.a*right.c+left.c*right.d,d:left.b*right.c+left.d*right.d,e:left.a*right.e+left.c*right.f+left.e,f:left.b*right.e+left.d*right.f+left.f}; }
function invert(matrix:Matrix):Matrix { const d=matrix.a*matrix.d-matrix.b*matrix.c; return Math.abs(d)<1e-6?identity():{a:matrix.d/d,b:-matrix.b/d,c:-matrix.c/d,d:matrix.a/d,e:(matrix.c*matrix.f-matrix.d*matrix.e)/d,f:(matrix.b*matrix.e-matrix.a*matrix.f)/d}; }
function applyMatrix(matrix:Matrix,x:number,y:number){return{x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f};}
function matrixToSvg(matrix:Matrix):string|null{return [matrix.a-1,matrix.b,matrix.c,matrix.d-1,matrix.e,matrix.f].every((v)=>Math.abs(v)<1e-6)?null:`matrix(${[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f].map(round).join(" ")})`;}
function rotateVector(x:number,y:number,degrees:number){const r=degrees*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return{x:x*c-y*s,y:x*s+y*c};}
function setAttribute(node:SVGElement,name:string,value:string|number|null|undefined){if(value==null||value==="")node.removeAttribute(name);else node.setAttribute(name,String(value));}
function assignNumber<T extends object,K extends keyof T>(target:T,key:K,value:number|null):boolean{if(value==null)return false;target[key]=value as T[K];return true;}
function finite(value:unknown):number|null{const n=typeof value==="number"?value:Number(value);return Number.isFinite(n)?n:null;}
function clamp01(value:number){return Math.max(0,Math.min(1,value));}
function round(value:number){return Math.round(value*10000)/10000;}
function clone<T>(value:T):T{return JSON.parse(JSON.stringify(value)) as T;}
function attributeSelectorValue(value:string){return value.replace(/\\/g,"\\\\").replace(/"/g,'\\"');}
function isIdentityTransform(value:readonly number[]){return value.every((item,index)=>Math.abs(item-[1,0,0,1,0,0][index])<1e-6);}
