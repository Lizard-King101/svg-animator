import { RigEvaluationPlan } from '../../../packages/runtime/src/rig/evaluation-plan';
import { Armature } from './objects/armature';
import { findAnimationTarget } from './objects/animation-targets';
import { Path } from './objects/elements/path.object';
import { SVG } from './objects/svg.object';

const transformFields = ['translateX', 'translateY', 'scaleX', 'scaleY', 'rotation', 'originX', 'originY'] as const;

/** Owns stable artwork references for one document/setup revision. No global identity cache:
 * undo, topology edits and context changes must replace the owner, even for same-ID objects.
 */
export class DocumentRigEvaluationPlan {
    private readonly rigs = new Map<string, { source: Armature; plan: RigEvaluationPlan; write: () => string[] }>();

    constructor(private readonly svg: SVG) {}

    apply(ids?: ReadonlySet<string>): Set<string> {
        const pending = [];
        for(const source of this.svg.rigs.armatures) {
            if(ids && !ids.has(source.id)) continue;
            let entry = this.rigs.get(source.id);
            if(!entry) {
                const plan = new RigEvaluationPlan(source);
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
                entry = { source, plan, write: () => {
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
            entry.plan.evaluate(source, true);
            pending.push(entry);
        }
        return new Set(pending.flatMap(entry => entry.write()));
    }
}
