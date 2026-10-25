import { Armature, BoundPoint, deformBinding, effectivePointWeights, validRigs, weightOwnerLocks } from './objects/armature';
import { identityMatrix, translationMatrix } from './objects/transform.object';
import { automaticWeightUpdates, bindingWeightMode, editWeightInfluence, pointWeightState } from './rig-weight-editing';
import { assignWeightUpdates, changeScopeInfluences } from './rig-weight-commands';
import { detachBindingWeights, linkCoincidentWeights, setPointIndependent, unlinkPointWeights } from './rig-point-weights';
import { createDocumentEnvelope, migrateDocument } from './migrations/document-migrations';
import documentV13Shared from './migrations/fixtures/document-v13-shared-weights.json';

const anchor = (id: string, x: number, y: number, weights = [{ boneId: 'a', weight: 1 }]): BoundPoint => ({ id, anchorId: id, x, y, weights });
function fixture(): Armature {
    return { id: 'rig', name: 'Rig', bones: [
        { id: 'a', name: 'Upper', parentId: null, x: 0, y: 0, angle: 0, length: 10, pose: 0 },
        { id: 'b', name: 'Lower', parentId: 'a', x: 10, y: 0, angle: 0, length: 10, pose: 90 },
        { id: 'c', name: 'Point', kind: 'point', parentId: null, x: 30, y: 0, angle: 0, length: 0, pose: 0 },
    ], bindings: [{ pathId: 'path', matrix: identityMatrix(), topology: '', boneIds: ['a', 'b', 'c'], points: [
        anchor('start', 2, 0), anchor('joint', 10, 0), anchor('end', 18, 0), anchor('off', 5, 5),
        { id: 'handle', anchorId: 'start', x: 18, y: 0, weights: [] },
    ] }] };
}
const ref = (pointId: string) => ({ pathId: 'path', pointId });
const refs = (rig: Armature) => rig.bindings.flatMap(binding => binding.points.map(point => ({ pathId: binding.pathId, pointId: point.id })));
const value = (weights: { boneId: string; weight: number }[], id: string) => weights.find(weight => weight.boneId === id)?.weight ?? 0;

describe('weight assignment and shared normalization', () => {
    it('reduces a 100% influence and distributes the unused budget to eligible zero influences', () => {
        const result = editWeightInfluence([{ boneId: 'a', weight: 1 }], 'a', .6, ['a', 'b', 'c']);
        expect(result).toEqual([{ boneId: 'a', weight: .6 }, { boneId: 'b', weight: .2 }, { boneId: 'c', weight: .2 }]);
        expect(editWeightInfluence(result, 'a', .6, ['a', 'b', 'c'])).toEqual(result);
    });

    it('preserves locked values exactly and redistributes remaining proportions within their budget', () => {
        const weights = [{ boneId: 'a', weight: .3 }, { boneId: 'b', weight: .2 }, { boneId: 'c', weight: .5 }];
        const edited = editWeightInfluence(weights, 'b', .9, ['a', 'b', 'c'], ['a']);
        expect(value(edited, 'a')).toBe(.3); expect(value(edited, 'b')).toBe(.7); expect(value(edited, 'c')).toBe(0);
        expect(editWeightInfluence(weights, 'a', .4, ['a', 'b', 'c'], ['a'])).toEqual(weights);
        expect(() => editWeightInfluence(weights, 'missing', .4, ['a', 'b', 'c'])).toThrow();
    });

    it('uses distance to segments with joint ties and inverse-square blending in rest space', () => {
        const rig = fixture(), updates = automaticWeightUpdates(rig, refs(rig));
        expect(updates.length).toBe(4); // The inherited handle shares start's owner.
        expect(updates.find(update => update.pointId === 'start')!.weights).toEqual([{ boneId: 'a', weight: 1 }]);
        expect(updates.find(update => update.pointId === 'joint')!.weights).toEqual([{ boneId: 'a', weight: .5 }, { boneId: 'b', weight: .5 }]);
        expect(updates.find(update => update.pointId === 'end')!.weights).toEqual([{ boneId: 'b', weight: 1 }]);
        const off = updates.find(update => update.pointId === 'off')!.weights;
        expect(value(off, 'a')).toBeCloseTo(2 / 3); expect(value(off, 'b')).toBeCloseTo(1 / 3);
        rig.bones[0].pose = 90; rig.bones[0].poseX = 500;
        expect(automaticWeightUpdates(rig, refs(rig))).toEqual(updates);
    });

    it('uses stable bone ID ties and supports point bones', () => {
        const rig = fixture(); rig.bones.forEach(bone => { bone.parentId = null; bone.x = 0; bone.y = 0; bone.kind = 'point'; bone.length = 0; });
        rig.bindings[0].points = [anchor('tie', 0, 0)]; rig.bones.reverse();
        expect(automaticWeightUpdates(rig, [ref('tie')])[0].weights).toEqual([{ boneId: 'a', weight: .5 }, { boneId: 'b', weight: .5 }]);
        rig.bones.find(bone => bone.id === 'c')!.x = 30; rig.bindings[0].points[0].x = 30;
        expect(automaticWeightUpdates(rig, [ref('tie')])[0].weights).toEqual([{ boneId: 'c', weight: 1 }]);
    });

    it('evaluates reflected path transforms and independent handles in document space', () => {
        let rig = fixture(); rig.bindings[0].matrix = { a: -1, b: 0, c: 0, d: 1, e: 20, f: 0 };
        rig = setPointIndependent(rig, 'path', 'handle', true);
        const updates = automaticWeightUpdates(rig, [ref('start'), ref('handle')]);
        expect(updates[0].weights).toEqual([{ boneId: 'b', weight: 1 }]);
        expect(updates[1].weights).toEqual([{ boneId: 'a', weight: 1 }]);
    });

    it('resolves shared points once and restricts automatic candidates to every member membership', () => {
        let rig = fixture(); rig.bindings.push({ pathId: 'other', matrix: translationMatrix(2, 0), topology: '', boneIds: ['a', 'b', 'c'], points: [anchor('seam', 0, 0)] });
        rig = linkCoincidentWeights(rig, ['path', 'other']); rig.bindings[1].boneIds = ['a', 'c'];
        expect(pointWeightState(rig, { pathId: 'other', pointId: 'seam' }).boneIds).toEqual(['a', 'c']);
        expect(automaticWeightUpdates(rig, [ref('start'), { pathId: 'other', pointId: 'seam' }]).length).toBe(1);
        expect(() => assignWeightUpdates(rig, [{ ...ref('start'), weights: [{ boneId: 'b', weight: 1 }] }])).toThrow();
    });

    it('auto weights preserves positive and zero locks without inventing extra owners', () => {
        const rig = fixture(), point = rig.bindings[0].points[0];
        point.weights = [{ boneId: 'a', weight: .3 }, { boneId: 'b', weight: .7 }]; point.lockedBoneIds = ['a', 'c'];
        const result = automaticWeightUpdates(rig, [ref('start')])[0].weights;
        expect(value(result, 'a')).toBe(.3); expect(value(result, 'b')).toBe(.7); expect(value(result, 'c')).toBe(0);
        const assigned = assignWeightUpdates(rig, [{ ...ref('start'), weights: result }]);
        expect(value(assigned.bindings[0].points[0].weights, 'a')).toBe(.3);
    });

    it('leaves fully locked and intentionally empty locked owners unchanged', () => {
        const rig = fixture(), point = rig.bindings[0].points[0];
        point.lockedBoneIds = ['a', 'b', 'c'];
        expect(automaticWeightUpdates(rig, [ref('start')])[0].weights).toEqual(point.weights);
        point.weights = [];
        expect(automaticWeightUpdates(rig, [ref('start')])[0].weights).toEqual([]);
        expect(assignWeightUpdates(rig, automaticWeightUpdates(rig, [ref('start')]))).toEqual(rig);
        expect(editWeightInfluence([], 'b', .5, ['a', 'b', 'c'], ['a', 'c'])).toEqual([{ boneId: 'b', weight: 1 }]);
    });

    it('rejects changes to a locked value including clear and treats semantic no-ops as unchanged', () => {
        const rig = fixture(); rig.bindings[0].points[0].lockedBoneIds = ['a'];
        expect(() => assignWeightUpdates(rig, [{ ...ref('start'), weights: [] }])).toThrow();
        expect(() => assignWeightUpdates(rig, [{ ...ref('start'), weights: [{ boneId: 'b', weight: 1 }] }])).toThrow();
        expect(assignWeightUpdates(rig, [{ ...ref('start'), weights: [{ boneId: 'a', weight: 1 }] }])).toEqual(rig);
        expect(assignWeightUpdates(rig, [{ ...ref('end'), weights: [] }]).bindings[0].points[2].weights).toEqual([]);
    });

    it('infers rigid from assigned membership, keeps zero influences weighted, and labels legacy empties custom', () => {
        const rig = fixture(), binding = rig.bindings[0];
        expect(bindingWeightMode(rig, [binding])).toBe('weighted');
        binding.boneIds = ['a']; expect(bindingWeightMode(rig, [binding])).toBe('rigid');
        binding.points[2].weights = []; expect(bindingWeightMode(rig, [binding])).toBe('custom');
        delete binding.boneIds; expect(bindingWeightMode(rig, [binding])).toBe('custom');
        expect(bindingWeightMode(rig, [])).toBe('unbound');
    });

    it('adds influences at zero, makes one-bone assignments rigid and blocks conflicting locks', () => {
        const rig = fixture(); rig.bindings[0].boneIds = ['a', 'b'];
        const added = changeScopeInfluences(rig, ['path'], ['a', 'b', 'c']);
        expect(added.bindings[0].points).toEqual(rig.bindings[0].points);
        const rigid = changeScopeInfluences(rig, ['path'], ['b']);
        expect(bindingWeightMode(rigid, rigid.bindings)).toBe('rigid');
        expect(rigid.bindings[0].points[0].weights).toEqual([{ boneId: 'b', weight: 1 }]);
        rig.bindings[0].points[0].lockedBoneIds = ['a'];
        expect(() => changeScopeInfluences(rig, ['path'], ['b'])).toThrow();
        rig.bindings[0].points[0].lockedBoneIds = ['b'];
        expect(() => changeScopeInfluences(rig, ['path'], ['b'])).toThrow();
    });

    it('extends shared member membership without changing unrelated points or dropping their locks', () => {
        let rig = fixture(); rig.bindings[0].boneIds = ['a', 'b'];
        rig.bindings.push({ pathId: 'other', matrix: identityMatrix(), topology: '', boneIds: ['a', 'b'], points: [
            anchor('seam', 2, 0), { ...anchor('unrelated', 50, 0, [{ boneId: 'b', weight: 1 }]), lockedBoneIds: ['b'] },
        ] });
        rig = linkCoincidentWeights(rig, ['path', 'other']);
        const changed = changeScopeInfluences(rig, ['path'], ['a', 'c']);
        expect(changed.bindings[1].boneIds).toEqual(['a', 'b', 'c']);
        expect(changed.bindings[1].points[1]).toEqual(rig.bindings[1].points[1]);
        expect(pointWeightState(changed, ref('start')).boneIds).toEqual(['a', 'c']);
        expect(validRigs({ version: 5, armatures: [changed] })).toBeTrue();
        expect(() => assignWeightUpdates(changed, [
            { ...ref('start'), weights: [{ boneId: 'a', weight: 1 }] },
            { pathId: 'other', pointId: 'seam', weights: [{ boneId: 'c', weight: 1 }] },
        ])).toThrowError('Shared points must receive one consistent weight value.');
    });
});

describe('weight locks and document compatibility', () => {
    it('preserves locks through shared-owner split, unbind, independent handles and restoration', () => {
        let rig = fixture(); rig.bindings[0].points[0].lockedBoneIds = ['a', 'c'];
        rig.bindings.push({ pathId: 'other', matrix: identityMatrix(), topology: '', boneIds: ['a', 'b', 'c'], points: [anchor('seam', 2, 0)] });
        rig = linkCoincidentWeights(rig, ['path', 'other']);
        const split = unlinkPointWeights(rig, 'path', 'start');
        expect(weightOwnerLocks(split, ref('start'))).toEqual(['a', 'c']);
        expect(weightOwnerLocks(split, { pathId: 'other', pointId: 'seam' })).toEqual(['a', 'c']);
        const detached = detachBindingWeights(rig, ['path']);
        expect(weightOwnerLocks(detached, { pathId: 'other', pointId: 'seam' })).toEqual(['a', 'c']);
        const independent = setPointIndependent(rig, 'path', 'handle', true);
        expect(independent.bindings[0].points[4].lockedBoneIds).toEqual(['a', 'c']);
        const restored = setPointIndependent(independent, 'path', 'handle', false);
        expect(restored.bindings[0].points[4].lockedBoneIds).toBeUndefined();
        expect(weightOwnerLocks(restored, ref('handle'))).toEqual(['a', 'c']);
        expect(validRigs({ version: 5, armatures: [restored] })).toBeTrue();
    });

    it('refuses a shared join or handle inheritance that would overwrite a lock', () => {
        let rig = fixture(); rig.bindings.push({ pathId: 'other', matrix: identityMatrix(), topology: '', boneIds: ['a', 'b', 'c'], points: [anchor('seam', 2, 0, [{ boneId: 'b', weight: 1 }])] });
        rig.bindings[1].points[0].lockedBoneIds = ['b'];
        expect(() => linkCoincidentWeights(rig, ['path', 'other'])).toThrow();
        rig = setPointIndependent(rig, 'path', 'handle', true);
        rig.bindings[0].points[4].weights = [{ boneId: 'b', weight: 1 }]; rig.bindings[0].points[4].lockedBoneIds = ['b'];
        expect(() => setPointIndependent(rig, 'path', 'handle', false)).toThrow();
    });

    it('validates lock ownership, IDs, duplicate locks and member eligibility', () => {
        const invalid = (change: (rig: Armature) => void) => { const rig = fixture(); change(rig); expect(validRigs({ version: 5, armatures: [rig] })).toBeFalse(); };
        invalid(rig => rig.bindings[0].points[0].lockedBoneIds = ['missing']);
        invalid(rig => rig.bindings[0].points[0].lockedBoneIds = ['a', 'a']);
        invalid(rig => rig.bindings[0].points[4].lockedBoneIds = ['a']);
        invalid(rig => { rig.bindings[0].boneIds = ['a']; rig.bindings[0].points[0].lockedBoneIds = ['b']; });
        const rig = fixture(); rig.bindings[0].points[0].lockedBoneIds = ['a'];
        expect(validRigs({ version: 4, armatures: [rig] })).toBeFalse();
        expect(validRigs({ version: 5, armatures: [rig] })).toBeTrue();
    });

    it('migrates document v13 without rewriting weights, inheritance, shared owners or posed geometry', () => {
        const source = structuredClone(documentV13Shared), original = JSON.stringify(source), result = migrateDocument(source);
        expect(result.status).toBe('ok'); if(result.status !== 'ok') return;
        expect(result.value.version).toBe(14); expect(result.value.data.rigs!.version).toBe(5);
        expect(result.value.data.rigs!.armatures).toEqual(source.data.rigs.armatures as any);
        const rig = result.value.data.rigs!.armatures[0];
        expect(bindingWeightMode(rig, rig.bindings)).toBe('custom');
        expect(deformBinding(rig, rig.bindings[0]).get('h')).toEqual({ x: 5, y: 0 });
        expect(JSON.stringify(source)).toBe(original);
        expect(migrateDocument(result.value)).toEqual({ status: 'ok', value: result.value, migrated: false, warnings: [] });
    });

    it('round-trips canonical locks in v14 and retains shared effective weights', () => {
        const rig = fixture(); rig.bindings[0].points[0].lockedBoneIds = ['a', 'c'];
        const envelope = createDocumentEnvelope({ ...documentV13Shared.data, rigs: { version: 5, armatures: [rig] } } as any);
        const result = migrateDocument(JSON.parse(JSON.stringify(envelope)));
        expect(result.status).toBe('ok'); if(result.status !== 'ok') return;
        expect(result.migrated).toBeFalse(); expect(result.value.data.rigs!.armatures).toEqual([rig]);
        expect(effectivePointWeights(rig, rig.bindings[0], rig.bindings[0].points[4])).toEqual([{ boneId: 'a', weight: 1 }]);
    });
});
