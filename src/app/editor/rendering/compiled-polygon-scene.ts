import { RigSceneEvaluation } from './rig-scene-evaluation';
import type { RuntimeContourV1, RuntimePaintV1, RuntimeSceneTargetV1, RuntimeTransformV1 } from '../../../../packages/runtime/src/contracts';
import { fullOutlineSections, projectOutlineGeometry } from '../../../../packages/runtime/src/outline';
import { identityMatrix, Matrix, multiplyMatrix, transformMatrix } from '../../../../packages/runtime/src/rig/transform';
import { PolygonDraw, PolygonContours, validatePolygonScene } from './polygon-scene';

export interface SceneEligibilityProblem { targetId: string; reason: string; }
export type PolygonSceneCompilation = { eligible: true; scene: CompiledPolygonScene } | { eligible: false; problems: SceneEligibilityProblem[] };
interface Node { target: RuntimeSceneTargetV1; parent?: Node; world: Matrix; }

/** Static scene subset. Input order is sibling paint order; group hierarchy determines
 * contiguous drawing scopes. Unsupported visible features reject the entire scene.
 * RuntimeSceneTargetV1 is an internal adapter input here, not a new saved format.
 */
export function compilePolygonScene(targets: readonly RuntimeSceneTargetV1[], generation: number): PolygonSceneCompilation {
    try { return { eligible: true, scene: new CompiledPolygonScene(targets, generation) }; }
    catch(error) { return { eligible: false, problems: [{ targetId: error instanceof SceneProblem ? error.targetId : '', reason: error instanceof Error ? error.message : String(error) }] }; }
}
class SceneProblem extends Error { constructor(readonly targetId: string, reason: string) { super(reason); } }

export class CompiledPolygonScene {
    readonly draws: PolygonDraw[] = [];
    readonly clips: PolygonDraw[] = [];
    private readonly geometryEntries = new Map<string, { role: 'fill' | 'stroke'; draw: PolygonDraw }[]>();
    private readonly nodes = new Map<string, Node>();
    constructor(targets: readonly RuntimeSceneTargetV1[], generation: number) {
        if(!Number.isSafeInteger(generation) || generation < 1) throw new Error('Invalid scene generation.');
        const children = new Map<string | null, Node[]>();
        for(const target of structuredClone(targets)) {
            if(this.nodes.has(target.id)) throw new SceneProblem(target.id, 'Duplicate layer ID.');
            const node = { target, world: identityMatrix() };
            this.nodes.set(target.id, node);
            const siblings = children.get(target.parentId) ?? []; siblings.push(node); children.set(target.parentId, siblings);
        }
        for(const node of this.nodes.values()) if(node.target.parentId !== null) {
            node.parent = this.nodes.get(node.target.parentId);
            if(!node.parent || node.parent.target.type !== 'group') throw new SceneProblem(node.target.id, 'Missing or non-group parent.');
        }
        this.updateWorlds(); // Includes disconnected cycle detection before drawing.
        const id = (target: RuntimeSceneTargetV1, role: string) => JSON.stringify([generation, target.id, role]);
        const checked = new Set<string>();
        const check = (target: RuntimeSceneTargetV1) => {
            if(checked.has(target.id)) return; checked.add(target.id);
            if(!Number.isFinite(target.opacity) || target.opacity < 0 || target.opacity > 1) throw new SceneProblem(target.id, 'Invalid opacity.');
            if(target.motion.pathId) throw new SceneProblem(target.id, 'Motion-path transforms require evaluation before scene compilation.');
            if(target.type === 'group') {
                if(target.opacity !== 1) throw new SceneProblem(target.id, 'Group opacity requires isolated compositing.');
            } else if(target.type !== 'path' && target.type !== 'rectangle') throw new SceneProblem(target.id, 'This shape type is not supported by the polygon scene yet.');
        };
        const emit = (node: Node, role: 'fill' | 'stroke', clipId?: string) => {
            const target = node.target;
            if(!target.visible) return;
            check(target);
            const color = solidColor(target.paints[role], target.id);
            if(!color || color[3] === 0 || target.opacity === 0) return;
            if(target.opacity !== 1 && target.paints.fill && target.paints.stroke) throw new SceneProblem(target.id, 'Combined fill/stroke opacity requires isolated compositing.');
            const polygons = targetPolygons(target, role);
            this.draws.push({ id: id(target, role), revision: 1, polygons, color: [color[0], color[1], color[2], color[3] * target.opacity],
                transform: node.world, clipId, fillRule: role === 'fill' ? target.path?.fillRule : 'nonzero' });
            this.rememberGeometry(target.id, role, this.draws.at(-1)!);
        };
        const visit = (node: Node, inheritedClip?: string) => {
            const target = node.target;
            if(!target.visible) return;
            check(target);
            if(target.type !== 'group') { emit(node, 'fill', inheritedClip); emit(node, 'stroke', inheritedClip); return; }
            let clipId = inheritedClip, source: Node | undefined;
            if(target.clipping) {
                source = this.nodes.get(target.clipping.clipElementId);
                if(!source || source.parent !== node || source.target.type === 'group') throw new SceneProblem(target.id, 'Clip source must be a direct child shape.');
                // Hidden source still clips; paint visibility is handled separately.
                check(source.target);
                const polygons = targetPolygons(source.target, 'fill');
                clipId = id(target, 'clip');
                this.clips.push({ id: clipId, revision: 1, polygons, color: [1, 1, 1, 1], transform: source.world,
                    clipId: inheritedClip, fillRule: source.target.path?.fillRule });
                this.rememberGeometry(source.target.id, 'fill', this.clips.at(-1)!);
                if(target.clipping.sourceVisibility) emit(source, 'fill', inheritedClip);
            }
            for(const child of children.get(target.id) ?? []) if(child !== source) visit(child, clipId);
            if(source && target.clipping?.sourceVisibility) emit(source, 'stroke', inheritedClip);
        };
        for(const root of children.get(null) ?? []) visit(root);
        validatePolygonScene(this.draws, { width: 1, height: 1 }, this.clips);
    }
    /** Transient transform update: descendants and clip sources share resolved matrices.
     * Local vertices, IDs and revisions remain unchanged; structural edits recompile. */
    updateTransform(id: string, transform: RuntimeTransformV1): void {
        if(!this.nodes.has(id)) throw new SceneProblem(id, 'Unknown transform target.');
        this.updateWorlds(new Map([[id, transform]]));
    }
    private rememberGeometry(id: string, role: 'fill' | 'stroke', draw: PolygonDraw): void {
        const entries = this.geometryEntries.get(id) ?? []; entries.push({ role, draw }); this.geometryEntries.set(id, entries);
    }
    /** Bind once. Each publication stages changed geometry and matrices before committing
     * revisions, so a failed pose never exposes half-updated fills or clip masks. */
    bindRig(evaluation: RigSceneEvaluation): () => void {
        const paths = [...evaluation.paths.keys()].map(id => {
            const target = this.nodes.get(id)?.target;
            if(!target?.path) throw new SceneProblem(id, 'Bound path is missing from the scene.');
            return { id, writers: evaluation.bindPath(id, target.path.contours) };
        });
        const attached = [...evaluation.transforms].map(([id, value]) => {
            const node = this.nodes.get(id); if(!node) throw new SceneProblem(id, 'Attached artwork is missing.');
            return { node, value };
        });
        for(const { target } of this.nodes.values()) if(target.transform.autoOrigin && (target.transform.rotation !== 0 || target.transform.scaleX !== 1 || target.transform.scaleY !== 1)) {
            throw new SceneProblem(target.id, 'Animated scene transforms require explicit origins.');
        }
        return () => {
            const dirty = new Set<string>(), changed: { point: { x: number; y: number }; x: number; y: number }[] = [];
            const transforms = new Map<string, RuntimeTransformV1>();
            for(const { node, value } of attached) {
                const next = { ...value, originX: value.originX ?? 0, originY: value.originY ?? 0, autoOrigin: false };
                if((Object.keys(next) as (keyof RuntimeTransformV1)[]).some(key => next[key] !== node.target.transform[key])) transforms.set(node.target.id, next);
            }
            try {
                for(const path of paths) for(const { point, value } of path.writers) if(point.x !== value.x || point.y !== value.y) {
                    changed.push({ point, x: point.x, y: point.y }); point.x = value.x; point.y = value.y; dirty.add(path.id);
                }
                if(!dirty.size && !transforms.size) return;
                const staged: { draw: PolygonDraw; polygons: PolygonContours }[] = [];
                for(const id of dirty) {
                    const projected = new Map<string, PolygonContours>();
                    for(const entry of this.geometryEntries.get(id) ?? []) {
                        let polygons = projected.get(entry.role);
                        if(!polygons) { polygons = targetPolygons(this.nodes.get(id)!.target, entry.role); projected.set(entry.role, polygons); }
                        staged.push({ draw: entry.draw, polygons });
                    }
                }
                const matrices = transforms.size ? this.updateWorlds(transforms, false) : undefined;
                for(const { draw, polygons } of staged) { draw.polygons = polygons; draw.revision++; }
                if(matrices) for(const [node, world] of matrices) Object.assign(node.world, world);
                for(const [id, transform] of transforms) this.nodes.get(id)!.target.transform = transform;
            } catch(error) { for(const { point, x, y } of changed.reverse()) { point.x = x; point.y = y; } throw error; }
        };
    }
    private updateWorlds(changes?: ReadonlyMap<string, RuntimeTransformV1>, publish = true): Map<Node, Matrix> {
        const resolved = new Map<Node, Matrix>(), visiting = new Set<Node>();
        const resolve = (node: Node): Matrix => {
            const cached = resolved.get(node); if(cached) return cached;
            if(visiting.has(node)) throw new SceneProblem(node.target.id, 'Cyclic scene hierarchy.');
            visiting.add(node);
            const t = changes?.get(node.target.id) ?? node.target.transform;
            if(![t.translateX, t.translateY, t.scaleX, t.scaleY, t.rotation, t.originX, t.originY].every(Number.isFinite)) throw new SceneProblem(node.target.id, 'Invalid transform.');
            const world = multiplyMatrix(node.parent ? resolve(node.parent) : identityMatrix(), transformMatrix(t, { x: t.originX, y: t.originY }));
            if(!Object.values(world).every(value => Number.isFinite(value) && Math.abs(value) <= 1e12)) throw new SceneProblem(node.target.id, 'Transform exceeds supported coordinates.');
            visiting.delete(node); resolved.set(node, world); return world;
        };
        for(const node of this.nodes.values()) resolve(node);
        if(publish) {
            for(const [node, world] of resolved) Object.assign(node.world, world);
            for(const [id, transform] of changes ?? []) this.nodes.get(id)!.target.transform = { ...transform };
        }
        return resolved;
    }
}

function solidColor(paint: RuntimePaintV1 | undefined, id: string): [number, number, number, number] | undefined {
    if(!paint) return undefined;
    if(paint.kind !== 'solid') throw new SceneProblem(id, 'Gradient paint is not supported yet.');
    // Compiler-produced canonical colors only. Never reinterpret arbitrary CSS colors.
    if(!/^#[0-9a-f]{6}$/i.test(paint.color) || !Number.isFinite(paint.opacity) || paint.opacity < 0 || paint.opacity > 1) throw new SceneProblem(id, 'Unsupported or invalid solid paint.');
    const value = Number.parseInt(paint.color.slice(1), 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, paint.opacity];
}
function sourceContours(target: RuntimeSceneTargetV1): RuntimeContourV1[] {
    if(target.type === 'path' && target.path) return target.path.contours;
    if(target.type !== 'rectangle') throw new SceneProblem(target.id, 'Unsupported clip or fill geometry.');
    const { x, y, width, height } = target.geometry;
    if(![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) throw new SceneProblem(target.id, 'Invalid rectangle geometry.');
    const points = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(([x, y], i) => ({ id: `${target.id}:${i}`, x, y }));
    return [{ id: target.id, closed: true, lines: points.map((point, i) => ({ id: `${target.id}:edge:${i}`, type: 'line', points: [point, points[(i + 1) % 4]] })) }];
}
function fillPolygons(target: RuntimeSceneTargetV1): PolygonContours {
    if(target.path && (target.path.drawProgress !== 1 || target.path.outlineSections !== undefined)) throw new SceneProblem(target.id, 'Revealed or derived-outline fill/clip geometry is not supported yet.');
    return sourceContours(target).map(contour => {
        const points = [];
        for(const [index, line] of contour.lines.entries()) {
            if(line.type !== 'line' || (target.path?.rounded && line.points.some(point => (point.cornerRadius ?? 0) > 0))) throw new SceneProblem(target.id, 'Curved or rounded fill/clip geometry is not supported yet.');
            const previous = contour.lines[index - 1]?.points[1];
            if(previous && (previous.x !== line.points[0].x || previous.y !== line.points[0].y)) throw new SceneProblem(target.id, 'Disconnected fill contour.');
            points.push({ x: line.points[0].x, y: line.points[0].y });
        }
        const last = contour.lines.at(-1)?.points[1]; if(last) points.push({ x: last.x, y: last.y });
        return points;
    });
}
function enforceWindingBudget(id: string, polygons: PolygonContours): void {
    // Conservative sufficient bound: every signed fan triangle contributes at most one.
    if(polygons.reduce((sum, points) => sum + Math.max(0, points.length - 2), 0) >= 256) throw new SceneProblem(id, 'Geometry exceeds the conservative stencil winding budget.');
    for(const polygon of polygons) for(const point of polygon) if(![point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e6)) throw new SceneProblem(id, 'Geometry exceeds the prototype coordinate range.');
}

function targetPolygons(target: RuntimeSceneTargetV1, role: 'fill' | 'stroke'): PolygonContours {
    let polygons: PolygonContours;
    if(role === 'fill') polygons = fillPolygons(target);
    else {
        if(!target.stroke || target.stroke.alignment !== 'center') throw new SceneProblem(target.id, 'Only centered stroke geometry is supported.');
        const contours = sourceContours(target), sections = target.path?.outlineSections ?? fullOutlineSections(contours);
        const result = projectOutlineGeometry(contours, sections, { ...target.stroke, drawProgress: target.path?.drawProgress, rounded: target.path?.rounded });
        if(result.problem) throw new SceneProblem(target.id, result.problem);
        polygons = result.polygons;
    }
    enforceWindingBudget(target.id, polygons); return polygons;
}
