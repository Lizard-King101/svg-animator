import { Armature } from '../objects/armature';
import { AnimationDocument } from '../objects/animation.object';

export function springFixture(): Armature {
    return { id: 'rig', name: 'Hair', bones: [
        { id: 'root', name: 'Head', kind: 'point', parentId: null, x: 0, y: 0, angle: 0, length: 0, pose: 0 },
        { id: 'hair', name: 'Hair', parentId: 'root', x: 0, y: 0, angle: 90, length: 40, pose: 0 },
        { id: 'tip', name: 'Tip', parentId: 'hair', x: 40, y: 0, angle: 0, length: 30, pose: 0 },
    ], bindings: [] };
}
export function springAnimation(): AnimationDocument {
    return { version: 2, duration: 2.013, markers: [], tracks: [{ id: 'move', targetId: 'rig', property: 'bones.root.poseX', valueType: 'number', keyframes: [
        { id: 'a', time: 0, value: 0 }, { id: 'b', time: .3, value: 80 }, { id: 'c', time: .6, value: 0 }, { id: 'd', time: 2.013, value: 0 },
    ] }] };
}
