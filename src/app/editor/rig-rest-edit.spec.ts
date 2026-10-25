import { Armature, boneMatrices, isConnectedBoneJoint } from './objects/armature';
import { applyMatrix } from './objects/transform.object';
import { moveBoneJoint } from './rig-rest-edit';

describe('rest joint moves', () => {
    function leg(): Armature {
        return { id: 'rig', name: 'Leg', bindings: [], bones: [
            { id: 'rig', name: 'Leg', kind: 'point', parentId: null, x: 100, y: 100, angle: 0, length: 0, pose: 0 },
            { id: 'upper', name: 'Thigh', parentId: 'rig', x: 0, y: 0, angle: 0, length: 50, pose: 0 },
            { id: 'lower', name: 'Shin', parentId: 'upper', x: 50, y: 0, angle: 0, length: 40, pose: 0 },
            { id: 'toe', name: 'Toe', parentId: 'lower', x: 40, y: 0, angle: 30, length: 10, pose: 0 },
            { id: 'cap', name: 'Kneecap', parentId: 'upper', x: 50, y: 0, angle: 90, length: 5, pose: 0 },
            { id: 'strap', name: 'Strap', parentId: 'upper', x: 20, y: 5, angle: 45, length: 8, pose: 0 },
        ] };
    }
    const world = (rig: Armature, id: string, along = 0) => applyMatrix(boneMatrices(rig).get(id)!, along, 0);
    const length = (rig: Armature, id: string) => rig.bones.find(bone => bone.id === id)!.length;
    const bone = (rig: Armature, id: string) => rig.bones.find(item => item.id === id)!;

    it('moves a knee by re-aiming the thigh while the foot, toes and free children stay put', () => {
        const source = leg(), moved = moveBoneJoint(source, 'lower', { x: 140, y: 130 })!;
        const knee = world(moved, 'lower');
        expect(knee.x).toBeCloseTo(140); expect(knee.y).toBeCloseTo(130);
        const foot = world(moved, 'lower', length(moved, 'lower'));
        expect(foot.x).toBeCloseTo(190); expect(foot.y).toBeCloseTo(100);
        expect(isConnectedBoneJoint(bone(moved, 'upper'), bone(moved, 'lower'))).toBeTrue();
        for(const id of ['toe', 'strap']) {
            const before = boneMatrices(source).get(id)!, after = boneMatrices(moved).get(id)!;
            (Object.keys(before) as (keyof typeof before)[]).forEach(key => expect(after[key]).withContext(id + ' ' + key).toBeCloseTo(before[key]));
        }
        expect(isConnectedBoneJoint(bone(moved, 'lower'), bone(moved, 'toe'))).toBeTrue();
        const cap = world(moved, 'cap', 5);
        expect(world(moved, 'cap').x).toBeCloseTo(140); expect(cap.x).toBeCloseTo(140); expect(cap.y).toBeCloseTo(135);
        expect(source.bones.find(item => item.id === 'upper')!.length).toBe(50);
    });

    it('reconnects a drifted joint onto the parent tip without moving the parent or the foot', () => {
        const source = leg(); Object.assign(bone(source, 'lower'), { x: 53, y: 2 });
        const before = world(source, 'lower', 40), fixed = moveBoneJoint(source, 'lower')!;
        expect(bone(fixed, 'upper').angle).toBeCloseTo(0); expect(bone(fixed, 'upper').length).toBeCloseTo(50);
        expect(isConnectedBoneJoint(bone(fixed, 'upper'), bone(fixed, 'lower'))).toBeTrue();
        const foot = world(fixed, 'lower', length(fixed, 'lower'));
        expect(foot.x).toBeCloseTo(before.x); expect(foot.y).toBeCloseTo(before.y);
    });

    it('rejects joints that collapse a bone and bones without a length parent', () => {
        expect(moveBoneJoint(leg(), 'lower', { x: 100, y: 100 })).toBeUndefined();
        expect(moveBoneJoint(leg(), 'lower', { x: 190, y: 100 })).toBeUndefined();
        expect(moveBoneJoint(leg(), 'upper', { x: 120, y: 100 })).toBeUndefined();
    });
});
