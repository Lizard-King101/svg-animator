import type { CompiledRuntimeTrackV1, RuntimeContourV1 } from '../../../../packages/runtime/src/contracts';
import { evaluateRuntimeTrack } from '../../../../packages/runtime/src/evaluator';
import { RigEvaluationPlan } from '../../../../packages/runtime/src/rig/evaluation-plan';
import type { Armature } from '../../../../packages/runtime/src/rig/armature';
import { resolveRigAnimationChannel } from '../../../../packages/runtime/src/rig/channels';
import type { TransformState } from '../../../../packages/runtime/src/rig/transform';

export interface RigSceneSetup {
    rigs: Armature[];
    channels: { rigId: string; property: string; track: CompiledRuntimeTrackV1 }[];
}
/** Shared transient rig/channel owner for both renderer workloads. Solvers and track
 * interpolation remain in the runtime kernel; destinations resolve once per setup. */
export class RigSceneEvaluation {
    readonly paths = new Map<string, Map<string, { x: number; y: number }>>();
    readonly transforms = new Map<string, TransformState>();
    private readonly rigs;
    private readonly writers;
    constructor(setup: RigSceneSetup) {
        const sources = structuredClone(setup.rigs), ids = new Set<string>();
        this.rigs = sources.map(source => {
            if(ids.has(source.id)) throw new Error('Duplicate rig ID.'); ids.add(source.id);
            const plan = new RigEvaluationPlan(source);
            for(const [id, values] of plan.paths) {
                if(this.paths.has(id)) throw new Error('Multiple rigs own a path.'); this.paths.set(id, values);
            }
            for(const link of source.attachments ?? []) {
                if(this.transforms.has(link.elementId) || this.paths.has(link.elementId)) throw new Error('Multiple rig outputs own an element.');
                this.transforms.set(link.elementId, { ...link.restTransform });
            }
            return { source, plan };
        });
        for(const id of this.paths.keys()) if(this.transforms.has(id)) throw new Error('Multiple rig outputs own an element.');
        const channels = new Set<string>();
        this.writers = structuredClone(setup.channels).map(({ rigId, property, track }) => {
            const channel=resolveRigAnimationChannel(this.rigs.find(rig=>rig.source.id===rigId)?.source,property),key=JSON.stringify([rigId,property]);
            if(!channel || track.kind!=='number' || channels.has(key)) throw new Error('Unsupported or duplicate scene channel.');
            channels.add(key); return {channel,base:channel.read(),track};
        });
    }
    bindPath(id: string, contours: RuntimeContourV1[]) {
        const values = this.paths.get(id), found = new Set<string>();
        const writers: { point: { x: number; y: number }; value: { x: number; y: number } }[] = [];
        if(!values) return writers;
        for(const contour of contours) for(const line of contour.lines) for(const point of [...line.points, line.controlStart, line.controlEnd]) if(point) {
            const value = values.get(point.id);
            if(!value) throw new Error('Bound path topology changed.');
            found.add(point.id); writers.push({ point, value });
        }
        if(found.size !== values.size) throw new Error('Bound path topology changed.');
        return writers;
    }
    evaluate(time: number): void {
        if(!Number.isFinite(time)) throw new Error('Invalid scene time.');
        for(const writer of this.writers) {
            const value = evaluateRuntimeTrack(writer.track, time);
            if(value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid evaluated rig channel.');
            writer.channel.write(value === undefined ? writer.base : value as number);
        }
        for(const rig of this.rigs) rig.plan.evaluate(rig.source, true);
        // Consumers may publish point outputs only after all solves succeed.
        for(const rig of this.rigs) for(const [id, value] of rig.plan.transforms) Object.assign(this.transforms.get(id)!, value);
    }
}
