import '@angular/compiler';
import { compileRuntimeAnimation } from '../../src/app/editor/animation/runtime-animation-compiler';
import type { OutlineSceneSnapshot } from '../../src/app/editor/rendering/outline-scene';
import { createRigPerformanceFixture } from '../../src/app/editor/animation/rig-performance-fixture';
import { AnimationEvaluationPlan } from '../../src/app/editor/animation/animation-evaluation-plan';
import { DocumentRigEvaluationPlan } from '../../src/app/editor/rig-evaluation';
import { Group } from '../../src/app/editor/objects/elements/group.object';
import { Path } from '../../src/app/editor/objects/elements/path.object';
import { AnyElement } from '../../src/app/editor/objects/svg.object';
import { pathOutlineContours } from '../../src/app/editor/path-outline';
import { projectOutlineGeometry, projectOutlineSections, visitOutlinePolygons } from '../../packages/runtime/src/outline';
import { PolygonDraw, PolygonFanBuffer } from '../../src/app/editor/rendering/polygon-scene';

let sceneGeneration = 0;
export class OutlineLabScene {
    readonly clips: PolygonDraw[] = [];
    private generation = ++sceneGeneration;
    private packed: { path: Path; contours: ReturnType<typeof pathOutlineContours>; buffer: PolygonFanBuffer; draw: Extract<PolygonDraw, { vertices: Float32Array }> }[] = [];
    private draws: PolygonDraw[] = [];
    private sequence = 0;
    private revision = 0;
    private svg;
    private animation;
    private rig;
    private paths: Path[] = [];
    constructor(rigs: number, segments: number) {
        const owner = this;
        this.svg = createRigPerformanceFixture({ get ID() { return `lab-${++owner.sequence}`; } } as never, { rigs, segments });
        this.animation = new AnimationEvaluationPlan(this.svg.animation, this.svg.elements, this.svg.rigs);
        this.rig = new DocumentRigEvaluationPlan(this.svg);
        const visit = (elements: AnyElement[]) => elements.forEach(element => {
            if(element instanceof Group) visit(element.elements);
            if(element instanceof Path && element.outlineSections !== undefined) this.paths.push(element);
        });
        visit(this.svg.elements);
        this.packed = this.paths.map(path => ({ path, contours: pathOutlineContours(path), buffer: new PolygonFanBuffer(),
            draw: { id: `${this.generation}:${path.id}`, revision: -1, color: [.15, .48, .9, 1], vertices: new Float32Array(0) } }));
        this.draws = this.packed.map(entry => entry.draw);
    }
    snapshot(): OutlineSceneSnapshot {
        const compiled = compileRuntimeAnimation(this.svg.save(), { bakeRoundedCorners: false });
        if(compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => item.message).join(' '));
        const animation = compiled.bundle.animation;
        return structuredClone({ generation: this.generation, rigs: this.svg.rigs.armatures,
            channels: animation.tracks.map(track => ({ rigId: animation.targets[track.target], property: animation.properties[track.property], track })),
            paths: this.paths.map(path => ({ id: path.id, contours: pathOutlineContours(path), sections: path.outlineSections!,
                style: { width: path.settings.stroke_width }, color: [.15, .48, .9, 1] as const })),
        });
    }
    evaluate(time: number, _backend?: 'svg' | 'webgpu' | 'both'): void {
        this.animation.evaluateEach(time, (track, value) => { if(track.rigChannel) track.rigChannel.write(Number(value)); });
        this.rig.apply(); this.revision++;
    }
    geometry(): PolygonDraw[] {
        return this.paths.map(path => ({ id: path.id, revision: this.revision, color: [.15, .48, .9, 1],
            polygons: projectOutlineGeometry(pathOutlineContours(path), path.outlineSections!, { width: path.settings.stroke_width }).polygons }));
    }
    /** Borrowed until the next evaluation. Renderer uploads before this storage is reused. */
    packedGeometry(): PolygonDraw[] {
        for(const entry of this.packed) {
            if(entry.draw.revision === this.revision) continue;
            entry.buffer.reset();
            const result = visitOutlinePolygons(entry.contours, entry.path.outlineSections!, { width: entry.path.settings.stroke_width }, points => entry.buffer.append(points));
            if(result.problem) throw new Error(result.problem);
            entry.draw.vertices = entry.buffer.data; entry.draw.revision = this.revision;
        }
        for(let index = 0; index < this.packed.length; index++) this.draws[index] = this.packed[index].draw;
        return this.draws;
    }
    svgData(): string[] {
        return this.paths.map(path => projectOutlineSections(pathOutlineContours(path), path.outlineSections!, { width: path.settings.stroke_width }).strokeData);
    }
}
