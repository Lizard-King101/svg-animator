import { Armature, Bone, boneMatrices, isConnectedBoneJoint } from './armature';
import { applyMatrix, invertMatrix } from './transform';

export function twoBoneChain(rig: Armature, endId: string): { upper: Bone; lower: Bone } | undefined {
    const lower = rig.bones.find(bone => bone.id === endId), upper = rig.bones.find(bone => bone.id === lower?.parentId);
    if(!lower || !upper || lower.kind === 'point' || upper.kind === 'point' || lower.length <= 0 || upper.length <= 0) return;
    if(!isConnectedBoneJoint(upper, lower)) return;
    return { upper, lower };
}

export function chainBend(rig: Armature, endId: string): 1 | -1 {
    const bone = rig.bones.find(bone => bone.id === endId);
    return bone && Math.sin((bone.angle + bone.pose) * Math.PI / 180) < -1e-6 ? -1 : 1;
}

/** Analytic two-link solve in the upper bone's parent space; unreachable targets never stretch. */
export function solveTwoBoneIK(rig: Armature, endId: string, target: { x:number; y:number }, bend: 1 | -1): Armature | undefined {
    const chain = twoBoneChain(rig,endId); if(!chain || ![target.x,target.y].every(Number.isFinite)) return;
    const { upper,lower } = chain, matrices = boneMatrices(rig);
    const parent = upper.parentId ? matrices.get(upper.parentId) : undefined;
    const local = parent ? applyMatrix(invertMatrix(parent),target.x,target.y) : target;
    const x = local.x-upper.x-(upper.poseX ?? 0), y = local.y-upper.y-(upper.poseY ?? 0);
    // Use the actual joint offset (including tiny drawing-rounding differences).
    const jointX = lower.x+(lower.poseX ?? 0), jointY = lower.y+(lower.poseY ?? 0);
    const a = Math.hypot(jointX,jointY), b = lower.length, offset = Math.atan2(jointY,jointX);
    if(a < 1e-8) return;
    const distance = Math.max(Math.abs(a-b),Math.min(a+b,Math.hypot(x,y)));
    const elbow = bend*Math.acos(Math.max(-1,Math.min(1,(distance*distance-a*a-b*b)/(2*a*b))));
    const heading = Math.hypot(x,y) > 1e-8 ? Math.atan2(y,x) : (upper.angle+upper.pose)*Math.PI/180+offset;
    const shoulder = distance < 1e-8 ? heading : heading-Math.atan2(b*Math.sin(elbow),a+b*Math.cos(elbow));
    const solved = structuredClone(rig);
    const nearest = (angle:number,reference:number) => reference + ((angle-reference+180)%360+360)%360-180;
    solved.bones.find(bone=>bone.id===upper.id)!.pose = nearest((shoulder-offset)*180/Math.PI-upper.angle,upper.pose);
    solved.bones.find(bone=>bone.id===lower.id)!.pose = nearest((elbow+offset)*180/Math.PI-lower.angle,lower.pose);
    return solved;
}
