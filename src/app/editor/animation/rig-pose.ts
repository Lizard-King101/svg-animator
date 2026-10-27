import { Armature, Bone } from '../objects/armature';

export const POSE_FIELDS = ['pose', 'poseX', 'poseY'] as const;
export interface RigPoseSnapshot {
    rigId: string;
    structure: string;
    controls: { id: string; pose: number; poseX: number; poseY: number }[];
}

/** Authored controls only: the IK solver owns both bones in each enabled chain. */
export function poseControls(rig: Armature): Bone[] {
    const driven = new Set(rig.constraints?.filter(constraint => constraint.enabled)
        .flatMap(constraint => [constraint.upperBoneId, constraint.lowerBoneId]));
    return rig.bones.filter(bone => !driven.has(bone.id));
}

/** Local pose values are meaningful only against the same rest skeleton and IK routing. */
export function poseStructure(rig: Armature): string {
    return JSON.stringify({
        bones: rig.bones.map(({id, parentId, kind, x, y, angle, length}) => ({id, parentId, kind, x, y, angle, length}))
            .sort((a,b) => a.id.localeCompare(b.id)),
        ik: rig.constraints?.filter(constraint => constraint.enabled).map(({upperBoneId, lowerBoneId, targetBoneId}) =>
            ({upperBoneId, lowerBoneId, targetBoneId})).sort((a,b) => a.upperBoneId.localeCompare(b.upperBoneId)) ?? [],
    });
}

export function captureRigPose(rig: Armature): RigPoseSnapshot {
    return { rigId: rig.id, structure: poseStructure(rig), controls: poseControls(rig).map(bone => ({
        id: bone.id, pose: bone.pose, poseX: bone.poseX ?? 0, poseY: bone.poseY ?? 0,
    })) };
}

export function applyRigPoseSnapshot(rig: Armature, snapshot: RigPoseSnapshot): Armature | undefined {
    if(rig.id !== snapshot.rigId || poseStructure(rig) !== snapshot.structure) return;
    const candidate = structuredClone(rig);
    for(const values of snapshot.controls) {
        const bone = candidate.bones.find(bone => bone.id === values.id);
        if(!bone || !POSE_FIELDS.every(field => Number.isFinite(values[field]))) return;
        for(const field of POSE_FIELDS) bone[field] = values[field];
    }
    return candidate;
}
