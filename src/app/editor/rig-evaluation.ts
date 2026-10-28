import { RigEvaluationPlan } from '../../../packages/runtime/src/rig/evaluation-plan';
import { Armature } from './objects/armature';
import { findAnimationTarget } from './objects/animation-targets';
import { Path } from './objects/elements/path.object';
import { SVG } from './objects/svg.object';
import { AnimationDocument } from './objects/animation.object';
import { hasPhysics, PhysicsLoop, RigPhysicsPlan } from '../../../packages/runtime/src/rig/physics';
import { rigPhysicsSampler } from './animation/rig-physics-sampler';

const transformFields = ['translateX', 'translateY', 'scaleX', 'scaleY', 'rotation', 'originX', 'originY'] as const;

/** Owns stable artwork references for one document/setup revision. No global identity cache:
 * undo, topology edits and context changes must replace the owner, even for same-ID objects.
 */
export class DocumentRigEvaluationPlan {
    private readonly rigs = new Map<string, { source: Armature; plan: RigEvaluationPlan; physics?: RigPhysicsPlan; write: () => string[] }>();
    private readonly bases: Map<string, Armature>;

    constructor(private readonly svg: SVG, private readonly animation?: AnimationDocument) {
        this.bases = new Map(svg.rigs.armatures.map(rig => [rig.id, structuredClone(rig)]));
    }
    pose(id: string): Armature | undefined { return this.rigs.get(id)?.plan.pose; }
    resetPhysics(): void { this.rigs.forEach(entry => entry.physics?.reset()); }

    apply(ids?: ReadonlySet<string>, time = 0, loop?: PhysicsLoop): Set<string> {
        const pending = [];
        for(const source of this.svg.rigs.armatures) {
            if(ids && !ids.has(source.id)) continue;
            let entry = this.rigs.get(source.id);
            if(!entry) {
                const base = this.bases.get(source.id)!;
                const physics = this.animation && hasPhysics(base) ? new RigPhysicsPlan(base, rigPhysicsSampler(base, this.animation)) : undefined;
                const plan = physics?.output ?? new RigEvaluationPlan(source);
                const paths = [...plan.paths].map(([id, values]) => {
                    const target = findAnimationTarget(this.svg.elements, id);
                    if(!(target instanceof Path)) throw new Error('A bound path was removed.');
                    return { id, points: [...values].map(([pointId, value]) => {
                        const point = target.findPointById(pointId);
                        if(!point) throw new Error('Bound path topology changed.');
                        return { point, value };
                    }) };
                });
                const attachments = (source.attachments ?? []).map(link => {
                    const target = findAnimationTarget(this.svg.elements, link.elementId);
                    if(!target) throw new Error('Attached artwork was removed.');
                    return target;
                });
                entry = { source, plan, physics, write: () => {
                    const changed: string[] = [];
                    for(const path of paths) {
                        let dirty = false;
                        for(const { point, value } of path.points) if(point.x !== value.x || point.y !== value.y) {
                            point.x = value.x; point.y = value.y; dirty = true;
                        }
                        if(dirty) changed.push(path.id);
                    }
                    for(const target of attachments) {
                        const transform = plan.transforms.get(target.id)!;
                        if(transformFields.some(key => target.transform[key] !== transform[key])) {
                            target.transform = { ...transform }; changed.push(target.id);
                        }
                    }
                    return changed;
                } };
                this.rigs.set(source.id, entry);
            }
            // Preflight all rigs, bindings and attachments before touching any artwork.
            if(entry.physics) entry.physics.evaluate(time, loop); else entry.plan.evaluate(source, true);
            pending.push(entry);
        }
        return new Set(pending.flatMap(entry => entry.write()));
    }
}
