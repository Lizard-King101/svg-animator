import { Armature } from '../objects/armature';
import { AnimationDocument } from '../objects/animation.object';
import { AnimationEvaluationPlan } from './animation-evaluation-plan';

/** Compiles detached authored channels once; physics output can never feed its input. */
export function rigPhysicsSampler(rig: Armature, animation: AnimationDocument): (time: number) => Armature {
    const source = structuredClone(rig), bases = source.bones.map(bone => ({ pose: bone.pose, poseX: bone.poseX, poseY: bone.poseY }));
    const wind={windX:source.windX,windY:source.windY};
    const plan = new AnimationEvaluationPlan(animation, [], {version:6,armatures:[source]});
    return time => {
        Object.assign(source,wind);
        source.bones.forEach((bone, index) => Object.assign(bone, bases[index]));
        plan.evaluateEach(time, (track, value, applied) => {
            if(applied && track.rigChannel && typeof value === 'number' && Number.isFinite(value)) track.rigChannel.write(value);
        });
        return source;
    };
}
