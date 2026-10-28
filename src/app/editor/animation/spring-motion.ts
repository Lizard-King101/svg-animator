import { springChain, SpringConstraint, SpringSettings } from '../../../../packages/runtime/src/rig/spring-chain';
import { RigPhysicsPlan } from '../../../../packages/runtime/src/rig/physics';
import { Armature } from '../objects/armature';
import { AnimationDocument, AnimationTrack, makeAnimationId } from '../objects/animation.object';
import { rigAnimationProperty } from '../rig-animation';
import { rigPhysicsSampler } from './rig-physics-sampler';

/** Optional conversion of the shared live evaluator to ordinary editable keys.
 * The bound applies to key generation only; live physics has no duration limit. */
export async function generateSpringMotion(
    rig: Armature, animation: AnimationDocument, firstId: string, settings: SpringSettings & Pick<SpringConstraint, 'endBoneId' | 'boneSettings'>,
    yieldWork: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0)),
): Promise<AnimationTrack[]> {
    if(!Number.isFinite(animation.duration) || animation.duration <= 0 || animation.duration > 60) {
        throw new Error('Baking supports animations up to 60 seconds. Use a shorter action or keep live physics.');
    }
    const ids=springChain(rig,firstId,settings.endBoneId), source=structuredClone(rig);
    source.springs=[...(source.springs??[]).filter(spring=>spring.rootBoneId!==firstId),
        {...settings,id:'bake-spring',name:'Bake spring',rootBoneId:firstId,enabled:true}];
    const sampler=rigPhysicsSampler(source,animation), physics=new RigPhysicsPlan(source,sampler);
    const tracks: AnimationTrack[]=ids.map(id=>({id:makeAnimationId('track'),targetId:rig.id,property:rigAnimationProperty(id,'pose'),valueType:'number',enabled:true,keyframes:[]}));
    const changed=new Set<string>(), steps=Math.ceil(animation.duration*60);
    for(let step=0;step<=steps;step++) {
        if(step%60===0) await yieldWork();
        const time=Math.min(step/60,animation.duration), pose=physics.evaluate(time).pose;
        const authored=sampler(time);
        tracks.forEach((track,index)=>{
            const id=ids[index], value=pose.bones.find(bone=>bone.id===id)!.pose;
            if(Math.abs(value-authored.bones.find(bone=>bone.id===id)!.pose)>1e-7) changed.add(id);
            track.keyframes.push({id:makeAnimationId('key'),time,value,easing:{type:'linear'}});
        });
    }
    return tracks.filter((track,index)=>changed.has(ids[index]));
}
