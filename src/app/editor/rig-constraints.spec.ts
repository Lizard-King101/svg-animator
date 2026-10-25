import { Armature, boneMatrices, TwoBoneIKConstraint, validRigs } from './objects/armature';
import { applyMatrix } from './objects/transform.object';
import { evaluateRigConstraints, rigConstraintProblem } from './rig-constraints';

describe('persistent rig constraints', () => {
    function rig(): Armature {
        return { id: 'character', name: 'Character', bindings: [], bones: [
            { id: 'root', name: 'Root', kind: 'point', parentId: null, x: 20, y: 30, angle: 0, length: 0, pose: 0 },
            { id: 'body', name: 'Body', kind: 'point', parentId: 'root', x: 0, y: 0, angle: 0, length: 0, pose: 0 },
            { id: 'upper', name: 'Upper leg', parentId: 'body', x: 0, y: 0, angle: 0, length: 40, pose: 0 },
            { id: 'lower', name: 'Lower leg', parentId: 'upper', x: 40, y: 0, angle: 0, length: 30, pose: 0 },
            { id: 'foot', name: 'Foot', kind: 'point', parentId: 'root', x: 40, y: 30, angle: 0, length: 0, pose: 0 },
        ], constraints: [constraint('leg', 'upper', 'lower', 'foot')] };
    }
    function constraint(id: string, upperBoneId: string, lowerBoneId: string, targetBoneId: string): TwoBoneIKConstraint {
        return { id, name: id, type: 'two-bone-ik', enabled: true, upperBoneId, lowerBoneId, targetBoneId, bend: 1 };
    }
    const origin = (value: Armature, boneId: string) => applyMatrix(boneMatrices(value).get(boneId)!, 0, 0);
    const endpoint = (value: Armature, lowerId = 'lower') => applyMatrix(boneMatrices(value).get(lowerId)!, value.bones.find(bone => bone.id === lowerId)!.length, 0);
    const expectPoint = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
        expect(actual.x).toBeCloseTo(expected.x, 8);
        expect(actual.y).toBeCloseTo(expected.y, 8);
    };

    it('keeps root-parented feet planted as the body moves and leaves authored FK untouched', () => {
        const source = rig(), before = structuredClone(source), target = origin(source, 'foot');
        expectPoint(endpoint(evaluateRigConstraints(source)), target);
        expect(source).toEqual(before);
        source.bones.find(bone => bone.id === 'body')!.poseX = -8;
        source.bones.find(bone => bone.id === 'body')!.poseY = 7;
        expectPoint(endpoint(evaluateRigConstraints(source)), target);
        expect(source.bones.find(bone => bone.id === 'lower')!.pose).toBe(0);
    });

    it('moves the whole posed rig with its root, including targets', () => {
        const source = rig();
        source.bones[0].pose = 55; source.bones[0].poseX = 100; source.bones[0].poseY = -30;
        expectPoint(endpoint(evaluateRigConstraints(source)), origin(source, 'foot'));
    });

    it('follows target translations, persists bend choice and deterministically reevaluates', () => {
        const source = rig(); source.bones[4].poseX = -10; source.bones[4].poseY = 15;
        const first = evaluateRigConstraints(source);
        expectPoint(endpoint(first), origin(source, 'foot'));
        source.constraints![0].bend = -1;
        const flipped = evaluateRigConstraints(JSON.parse(JSON.stringify(source)));
        expectPoint(endpoint(flipped), endpoint(first));
        expect(flipped.bones[3].pose).toBeLessThan(0);
        expect(first.bones[3].pose).toBeGreaterThan(0);
        expect(evaluateRigConstraints(source)).toEqual(flipped);
    });

    it('disables constraints without losing authored FK or changing the source', () => {
        const source = rig(); source.bones[2].pose = 17; source.constraints![0].enabled = false;
        const evaluated = evaluateRigConstraints(source);
        expect(evaluated).toEqual(source); expect(evaluated).not.toBe(source);
    });

    it('permits disconnected Edit setup but rejects solving until the joint is connected', () => {
        const source = rig(); source.constraintsActive = false; source.bones[3].x = 20;
        expect(validRigs({ version: 3, armatures: [source] })).toBeTrue();
        expect(evaluateRigConstraints(source)).toEqual(source);
        source.constraintsActive = true;
        expect(validRigs({ version: 3, armatures: [source] })).toBeFalse();
        expect(() => evaluateRigConstraints(source)).toThrowError(/must start at .* tip\. Use Reconnect joint/);
        source.constraints![0].enabled = false;
        expect(validRigs({ version: 3, armatures: [source] })).toBeTrue();
    });

    it('clamps out-of-reach feet without moving targets or stretching bones', () => {
        const source = rig(); source.bones[4].x = 1000; source.bones[4].y = 0;
        const solved = evaluateRigConstraints(source), hip = origin(solved, 'upper'), tip = endpoint(solved);
        expect(Math.hypot(tip.x - hip.x, tip.y - hip.y)).toBeCloseTo(70);
        expect(solved.bones.map(bone => bone.length)).toEqual(source.bones.map(bone => bone.length));
        expectPoint(origin(solved, 'foot'), origin(source, 'foot'));
    });

    it('rejects malformed records, missing references, invalid chains and descendant targets', () => {
        const source = rig();
        for(const change of [
            { targetBoneId: 'missing' }, { targetBoneId: 'upper' }, { targetBoneId: 'lower' },
            { upperBoneId: 'root' }, { lowerBoneId: 'body' }, { bend: 0 }, { type: 'physics' }, { enabled: 'yes' },
        ]) {
            const candidate = structuredClone(source); Object.assign(candidate.constraints![0], change);
            expect(validRigs({ version: 3, armatures: [candidate] })).withContext(JSON.stringify(change)).toBeFalse();
            expect(() => evaluateRigConstraints(candidate)).toThrow();
        }
        source.bones[4].parentId = 'lower';
        expect(rigConstraintProblem(source)).toContain('outside');
    });

    it('rejects duplicate IDs and overlapping enabled writers even when rest solving is inactive', () => {
        const source = rig(); source.constraintsActive = false;
        source.constraints!.push({ ...source.constraints![0] });
        expect(rigConstraintProblem(source)).toContain('unique ID');
        source.constraints![1].id = 'other';
        expect(rigConstraintProblem(source)).toContain('another enabled');
        source.constraints![1].enabled = false;
        expect(rigConstraintProblem(source)).toBeUndefined();
    });

    function dependentRig(): Armature {
        const source = rig();
        source.bones.push(
            { id: 'upper2', name: 'Upper arm', parentId: 'root', x: 0, y: 40, angle: 0, length: 40, pose: 0 },
            { id: 'lower2', name: 'Lower arm', parentId: 'upper2', x: 40, y: 0, angle: 0, length: 30, pose: 0 },
            { id: 'target2', name: 'Hand control', kind: 'point', parentId: 'lower', x: 20, y: 0, angle: 0, length: 0, pose: 0 },
        );
        source.constraints!.unshift(constraint('arm', 'upper2', 'lower2', 'target2'));
        return source;
    }

    it('solves target dependencies before consumers regardless of record order', () => {
        const source = dependentRig(), solved = evaluateRigConstraints(source);
        expectPoint(endpoint(solved, 'lower2'), origin(solved, 'target2'));
        source.constraints!.reverse();
        expect(evaluateRigConstraints(source).bones).toEqual(solved.bones);
    });

    it('rejects mutual target dependency cycles and permits disabling one participant', () => {
        const source = dependentRig(); source.bones[4].parentId = 'lower2';
        expect(rigConstraintProblem(source)).toContain('cycle');
        source.constraints![0].enabled = false;
        expect(rigConstraintProblem(source)).toBeUndefined();
    });
});
