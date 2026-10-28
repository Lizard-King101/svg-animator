import { normalizeWeights } from '../../packages/runtime/src/rig/armature';
import '@angular/compiler';
import { createRigPerformanceFixture } from '../../src/app/editor/animation/rig-performance-fixture';
import { AnimationEvaluationPlan } from '../../src/app/editor/animation/animation-evaluation-plan';
import { compileRuntimeAnimation } from '../../src/app/editor/animation/runtime-animation-compiler';
import { DocumentRigEvaluationPlan } from '../../src/app/editor/rig-evaluation';
import { createPathBinding } from '../../src/app/editor/rig-binding';
import { Group } from '../../src/app/editor/objects/elements/group.object';
import { Path } from '../../src/app/editor/objects/elements/path.object';
import { Shape } from '../../src/app/editor/objects/elements/shape.object';
import { Point } from '../../src/app/editor/objects/point.object';
import { Line } from '../../src/app/editor/objects/line.object';
import { Color } from '../../src/app/editor/objects/color.object';
import { buildSVGMarkup } from '../../src/app/editor/svg-markup';
import { AnimatedPolygonScene, AnimatedPolygonSceneSnapshot } from '../../src/app/editor/rendering/animated-polygon-scene';

let generation = 100000;
export interface RigSceneOptions { rigs?: number; moving?: number; pathsPerRig?: number; subdivisions?: number; staticLayers?: number; }
/** Independent editor-model reference and framework-free worker snapshot, using a
 * shareable polygon character with dependent IK, weighted paint and a moving clip. */
export class AnimatedRigLabScene {
    private readonly svg;
    private readonly animation;
    private readonly rig;
    private readonly source: AnimatedPolygonSceneSnapshot;
    private readonly gpuScene: AnimatedPolygonScene;
    readonly workloadDetails;
    constructor(options: number | RigSceneOptions = 1) {
        const config = typeof options === 'number' ? { rigs: options } : options;
        const rigs = config.rigs ?? 1, moving = config.moving ?? rigs, pathsPerRig = config.pathsPerRig ?? 2;
        const subdivisions = config.subdivisions ?? 1, staticLayers = config.staticLayers ?? 0;
        for(const [value, min, max] of [[rigs, 1, 10], [moving, 0, rigs], [pathsPerRig, 2, 24], [subdivisions, 1, 8], [staticLayers, 0, 2000]]) {
            if(!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid rig-scene workload size.');
        }
        let sequence = 0; const editor = { get ID() { return `rig-scene-${++sequence}`; } } as never;
        this.svg = createRigPerformanceFixture(editor, { rigs, moving });
        this.svg.elements.forEach((element, index) => {
            const group = element as Group, nested = group.elements[1] as Group;
            const paths = nested.elements.filter(element => element instanceof Path) as Path[];
            while(paths.length < pathsPerRig) {
                const path = new Path(editor); path.id = `rig-${index}-detail-${paths.length}`;
                paths.push(path); nested.elements.splice(nested.elements.length - 1, 0, path);
            }
            const root = this.svg.rigs.armatures[index].bones[0], x = root.x, y = root.y;
            const polygon = (path: Path, coordinates: number[][], density = 1) => {
                const vertices = coordinates.flatMap(([ax, ay], i) => {
                    const [bx, by] = coordinates[(i + 1) % coordinates.length], length = Math.hypot(bx - ax, by - ay);
                    return Array.from({ length: density }, (_, step) => {
                        const t = step / density, bend = Math.sin(t * Math.PI) * Math.min(1.5, length / 20);
                        return [ax + (bx - ax) * t - (by - ay) / length * bend, ay + (by - ay) * t + (bx - ax) / length * bend];
                    });
                });
                const points = vertices.map(([dx, dy], i) => new Point(x + dx, y + dy, `${path.id}:p${i}`));
                path.lines = points.map((point, i) => new Line(editor, { type: 'line', points: [point, points[(i + 1) % points.length]] }));
                path.closed = true; path.settings.fill_enabled = true; path.outlineSections = undefined;
                path.transform.originX = path.transform.originY = 0;
                path.settings.stroke_alignment = 'center'; path.settings.stroke_width = 2;
                path.settings.line_join = 'miter';
            };
            paths.forEach((path, i) => {
                const coordinates = i % 2 ? [[12, -8], [70, -10], [130, -8], [130, -2], [70, 1], [12, -2]]
                    : [[0, -12], [75, -14], [150, -6], [150, 6], [75, 14], [0, 12]];
                // Additional layers have distinct geometry, rather than exact overdraw copies.
                const layer = Math.floor(i / 2), offset = layer * 1.6;
                polygon(path, coordinates.map(([dx, dy]) => [dx * (1 - layer * .015), dy + offset]), subdivisions);
                path.settings.fill = new Color(i % 2 ? '#ffb347' : '#348bd1');
                path.settings.stroke = new Color(i % 2 ? '#8b4c18' : '#14354f');
            });
            const clip = new Path(editor); clip.id = `rig-${index}-moving-clip`; polygon(clip, [[-20, -35], [175, -35], [175, 45], [-20, 45]]);
            clip.visible = false; clip.settings.fill = null; clip.settings.stroke = null;
            nested.elements.unshift(clip); nested.clipElementId = clip.id;
            group.elements[0].visible = false;
            const attachment = nested.elements.find(element => element instanceof Shape) as Shape;
            attachment.settings.fill = new Color('#e95470'); attachment.settings.stroke = null;
            const source = this.svg.rigs.armatures[index];
            source.bindings = [...paths.map((path, i) => {
                const flex = i % 2 !== 0;
                const binding = createPathBinding(this.svg, path, flex ? 'flex-upper' : 'upper');
                for(const point of binding.points) {
                    const weight = Math.max(0, Math.min(1, (point.x - x - (flex ? 12 : 0)) / (flex ? 118 : 150)));
                    point.weights = normalizeWeights([{ boneId: flex ? 'flex-upper' : 'upper', weight: 1 - weight }, { boneId: flex ? 'flex-lower' : 'lower', weight }]);
                }
                return binding;
            }), createPathBinding(this.svg, clip, 'root')];
        });
        const background = Array.from({ length: staticLayers }, (_, i) => {
            const shape = new Shape(editor, { type: 'rectangle', position: new Point(i % 50 * 20, Math.floor(i / 50) * 20), width: 14, height: 12 });
            shape.id = `static-layer-${i}`; shape.transform.originX = shape.transform.originY = 0;
            shape.settings.fill = new Color(i % 2 ? '#d0dce8' : '#c3d1df'); shape.settings.stroke = null;
            return shape;
        });
        this.svg.elements.unshift(...background);
        this.rig = new DocumentRigEvaluationPlan(this.svg); this.rig.apply();
        this.animation = new AnimationEvaluationPlan(this.svg.animation, this.svg.elements, this.svg.rigs);
        const result = compileRuntimeAnimation(this.svg.save(), { bakeRoundedCorners: false });
        if(result.diagnostics.length) throw new Error(result.diagnostics.map(item => item.message).join(' '));
        const bundle = result.bundle;
        this.source = { kind: 'rig-scene', generation: ++generation, rigs: this.svg.rigs.armatures,
            channels: bundle.animation.tracks.map(track => ({ rigId: bundle.animation.targets[track.target], property: bundle.animation.properties[track.property], track })),
            targets: bundle.artwork.targets };
        this.source = structuredClone(this.source);
        this.gpuScene = new AnimatedPolygonScene(this.source);
        this.workloadDetails = { rigs, movingRigs: moving, pathsPerRig, verticesPerPath: 6 * subdivisions, staticLayers,
            sceneTargets: this.source.targets.length, paintDraws: this.gpuScene.scene.draws.length, clipMasks: this.gpuScene.clips.length,
            boundPoints: this.source.rigs.reduce((sum, rig) => sum + rig.bindings.reduce((n, binding) => n + binding.points.length, 0), 0) };
    }
    snapshot(): AnimatedPolygonSceneSnapshot { return structuredClone(this.source); }
    evaluate(time: number, backend: 'svg' | 'webgpu' | 'both' = 'both'): void {
        if(backend !== 'webgpu') {
            this.animation.evaluateEach(time, (track, value) => { if(track.rigChannel) track.rigChannel.write(Number(value)); });
            this.rig.apply();
        }
        if(backend !== 'svg') this.gpuScene.evaluate(time);
    }
    referenceTargets() { return compileRuntimeAnimation(this.svg.save(), { bakeRoundedCorners: false }).bundle.artwork.targets; }
    svgData(): string { return buildSVGMarkup(this.svg); }
    packedGeometry() { return this.gpuScene.packedGeometry(); }
    get clips() { return this.gpuScene.clips; }
}
