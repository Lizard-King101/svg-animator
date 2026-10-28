import type { Armature, RigDocument } from './armature';

export type RigAnimationField = 'pose' | 'poseX' | 'poseY';
export type RigWindField = 'windX' | 'windY';
export type RigAnimationProperty = { boneId: string; field: RigAnimationField } | { boneId?: never; field: RigWindField };
export interface RigChannelWriter { read(): number; write(value: number): void; }

/** Bone channels address authored pose offsets; solved IK angles are never keys. */
export function rigAnimationProperty(boneId: string, field: RigAnimationField): string { return `bones.${boneId}.${field}`; }
export function rigWindProperty(field: RigWindField): string { return `physics.${field}`; }
export function parseRigAnimationProperty(property: string): RigAnimationProperty | undefined {
    if(property==='physics.windX' || property==='physics.windY') return {field:property.slice(8) as RigWindField};
    const match = /^bones\.(.+)\.(pose|poseX|poseY)$/.exec(property);
    return match ? { boneId: match[1], field: match[2] as RigAnimationField } : undefined;
}

/** Resolve once per plan, so bone and armature channels share the same write path. */
export function resolveRigAnimationChannel(rig: Armature | undefined, property: string): RigChannelWriter | undefined {
    const parsed=parseRigAnimationProperty(property); if(!rig || !parsed) return;
    if(parsed.boneId!==undefined) {
        const bone=rig.bones.find(bone=>bone.id===parsed.boneId); if(!bone) return;
        const field=parsed.field;
        return {read:()=>bone[field]??0,write:value=>{bone[field]=value;}};
    }
    const field=parsed.field;
    return {read:()=>rig[field]??0,write:value=>{rig[field]=value;}};
}
export function readRigAnimationProperty(rigs: RigDocument | undefined, targetId: string, property: string): number | undefined {
    return resolveRigAnimationChannel(rigs?.armatures.find(rig=>rig.id===targetId),property)?.read();
}
export function hasRigWindData(rig: Armature): boolean {
    return rig.windX!==undefined || rig.windY!==undefined || !!rig.springs?.some(spring=>spring.windInfluence!==undefined || Object.values(spring.boneSettings??{}).some(settings=>settings.windInfluence!==undefined));
}
