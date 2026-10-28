import type { RuntimeSceneTargetV1 } from '../../../../packages/runtime/src/contracts';
import { rigChannelConflict, rigSceneProblem } from '../../../../packages/runtime/src/rig/runtime-rigs';
import { CompiledPolygonScene } from './compiled-polygon-scene';
import { RigSceneEvaluation, RigSceneSetup } from './rig-scene-evaluation';
import { OutlineScene, OutlineSceneSnapshot } from './outline-scene';

export interface AnimatedPolygonSceneSnapshot extends RigSceneSetup {
    kind: 'rig-scene'; generation: number; targets: RuntimeSceneTargetV1[];
}
export type RendererSceneSnapshot = OutlineSceneSnapshot | AnimatedPolygonSceneSnapshot;

/** Scene ordering is compiled once; animation changes only rig-owned geometry and
 * attachment transforms. Unsupported features fail before a frame is submitted. */
export class AnimatedPolygonScene {
    readonly scene: CompiledPolygonScene;
    private readonly evaluation: RigSceneEvaluation;
    private readonly publish: () => void;
    private pending = false;
    constructor(snapshot: AnimatedPolygonSceneSnapshot) {
        const rigs = { version: 5 as const, armatures: snapshot.rigs };
        const problem = rigSceneProblem(rigs, snapshot.targets);
        if(problem) throw new Error(problem);
        for(const channel of snapshot.channels) {
            const problem = rigChannelConflict(rigs, snapshot.targets, { targetId: channel.rigId, property: channel.property });
            if(problem) throw new Error(problem);
        }
        this.evaluation = new RigSceneEvaluation(snapshot);
        this.scene = new CompiledPolygonScene(snapshot.targets, snapshot.generation);
        this.publish = this.scene.bindRig(this.evaluation);
    }
    get clips() { return this.scene.clips; }
    evaluate(time: number): void {
        this.pending = false; this.evaluation.evaluate(time); this.pending = true;
    }
    packedGeometry() {
        if(this.pending) { this.pending = false; this.publish(); }
        return this.scene.draws;
    }
}
export function createRendererScene(snapshot: RendererSceneSnapshot): OutlineScene | AnimatedPolygonScene {
    return 'kind' in snapshot && snapshot.kind === 'rig-scene' ? new AnimatedPolygonScene(snapshot) : new OutlineScene(snapshot as OutlineSceneSnapshot);
}
