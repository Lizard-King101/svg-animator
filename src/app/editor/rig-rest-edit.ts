import { Armature, boneMatrices } from './objects/armature';
import { applyMatrix, invertMatrix, multiplyMatrix } from './objects/transform.object';
import { SVG } from './objects/svg.object';
import { Path } from './objects/elements/path.object';
import { findAnimationTarget } from './objects/animation-targets';
import { combinedMotionAdjustedMatrixFor } from './objects/motion-path.object';
import { parentMatrixFor } from './objects/element-bounds';

/** Binding, attaching and drawing read artwork as rest geometry, so neither authored poses nor IK may bend the skeleton. */
export const REST_REQUIRED = 'Bones must be in their rest setup for this. Reset to rest clears the pose and pauses IK until you pose again.';

/** Make the visible pose the editable rest setup, preserving artwork and influence IDs. */
export function editableRestRig(svg: SVG, source: Armature): Armature {
    const rig = restSkeleton(source);

    for(const binding of rig.bindings) {
        const path = findAnimationTarget(svg.elements, binding.pathId) as Path;
        binding.matrix = combinedMotionAdjustedMatrixFor(svg, path);
        for(const point of binding.points) {
            const actual = path.findPointById(point.id)!; point.x = actual.x; point.y = actual.y;
        }
    }
    for(const link of rig.attachments ?? []) {
        const element = findAnimationTarget(svg.elements, link.elementId)!;
        link.parentMatrix = parentMatrixFor(svg.elements, element);
        link.worldMatrix = combinedMotionAdjustedMatrixFor(svg, element);
        link.restTransform = { ...element.transform };
    }
    return rig;
}

/**
 * Moves the joint a length bone shares with its parent (by default onto the parent's tip, reconnecting it).
 * The parent re-aims to the joint, the child's tail stays put, and every other bone keeps its canvas placement.
 */
export function moveBoneJoint(source: Armature, childId: string, world?: { x: number; y: number }): Armature | undefined {
    const rig = restSkeleton(source), child = rig.bones.find(bone => bone.id === childId), parent = rig.bones.find(bone => bone.id === child?.parentId);
    if(!child || !parent || child.kind === 'point' || parent.kind === 'point') return;
    const before = boneMatrices(rig), oldLength = parent.length;
    const tail = applyMatrix(before.get(child.id)!, child.length, 0);
    const joint = world ?? applyMatrix(before.get(parent.id)!, parent.length, 0);
    const outer = parent.parentId ? before.get(parent.parentId) : undefined;
    const local = outer ? applyMatrix(invertMatrix(outer), joint.x, joint.y) : joint;
    const length = Math.hypot(local.x - parent.x, local.y - parent.y);
    if(length < .001) return;
    parent.angle = Math.atan2(local.y - parent.y, local.x - parent.x) * 180 / Math.PI; parent.length = length;
    const reaimed = boneMatrices(rig), tip = applyMatrix(invertMatrix(reaimed.get(parent.id)!), tail.x, tail.y);
    const childLength = Math.hypot(tip.x - length, tip.y), oldChildLength = child.length;
    if(childLength < .001) return;
    Object.assign(child, { x: length, y: 0, angle: Math.atan2(tip.y, tip.x - length) * 180 / Math.PI, length: childLength });
    const after = boneMatrices(rig);
    for(const bone of rig.bones) {
        const owner = bone === child ? undefined : bone.parentId === parent.id ? parent : bone.parentId === child.id ? child : undefined;
        if(!owner) continue;
        const ownerTip = owner === parent ? oldLength : oldChildLength, onTip = Math.abs(bone.x - ownerTip) < .05 && Math.abs(bone.y) < .05;
        const placed = multiplyMatrix(invertMatrix(after.get(owner.id)!), before.get(bone.id)!);
        Object.assign(bone, { x: placed.e, y: placed.f, angle: Math.atan2(placed.b, placed.a) * 180 / Math.PI });
        // Bones attached at a tip stay attached: siblings follow the moved joint, grandchildren keep the fixed tail.
        if(onTip) { bone.x = owner.length; bone.y = 0; }
    }
    return rig;
}

export function restSkeleton(source: Armature): Armature {
    const rig = structuredClone(source);
    for(const bone of rig.bones) {
        bone.x += bone.poseX ?? 0; bone.y += bone.poseY ?? 0; bone.angle += bone.pose;
        bone.pose = 0; delete bone.poseX; delete bone.poseY;
    }
    return rig;
}
