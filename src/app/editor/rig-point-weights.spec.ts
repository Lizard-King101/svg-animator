import { Armature, BoundPoint, deformBinding, effectivePointWeights, validRigs, weightOwner, weightsWithInfluence } from './objects/armature';
import { identityMatrix, translationMatrix } from './objects/transform.object';
import { detachBindingWeights, linkCoincidentWeights, setPointIndependent, unlinkPointWeights, weightMembers } from './rig-point-weights';
import { createDocumentEnvelope, migrateDocument } from './migrations/document-migrations';
import documentV12IK from './migrations/fixtures/document-v12-ik.json';

const anchor = (id: string, x: number, y: number): BoundPoint => ({ id, anchorId: id, x, y, weights: [{ boneId: 'a', weight: 1 }] });
function fixture(): Armature {
    return {
        id: 'rig', name: 'Rig', bones: [
            { id: 'a', name: 'A', parentId: null, x: 0, y: 0, angle: 0, length: 10, pose: 90 },
            { id: 'b', name: 'B', parentId: null, x: 0, y: 0, angle: 0, length: 10, pose: 0, poseX: 20 },
        ], bindings: [
            { pathId: 'left', scopeId: 'group', topology: '', matrix: identityMatrix(), boneIds: ['a', 'b'], points: [anchor('start', 10, 0), { id: 'handle', anchorId: 'start', x: 12, y: 0, weights: [] }, anchor('other', 20, 0)] },
            { pathId: 'right', scopeId: 'group', topology: '', matrix: translationMatrix(5, 0), boneIds: ['a', 'b'], points: [anchor('seam', 5, 0), anchor('near', 5.00000001, 0)] },
        ],
    };
}

describe('shared point and independent handle weights', () => {
    it('joins exact transformed rest positions without changing geometry, nearby points, or source data', () => {
        const source = fixture(), before = JSON.stringify(source), linked = linkCoincidentWeights(source, ['left', 'right']);
        expect(weightOwner(linked, 'right', 'seam')).toEqual({ pathId: 'left', pointId: 'start' });
        expect(weightOwner(linked, 'right', 'near')).toEqual({ pathId: 'right', pointId: 'near' });
        expect(linked.bindings[1].points[0].weights).toEqual([]);
        expect(linked.bindings[1].points[0].x).toBe(5);
        expect(linked.bindings[1].points.map(point => point.id)).toEqual(['seam', 'near']);
        expect(JSON.stringify(source)).toBe(before);
        expect(validRigs({ version: 4, armatures: [linked] })).toBeTrue();
    });

    it('one owner edit drives linked anchors and inherited handles in their respective path spaces', () => {
        const rig = linkCoincidentWeights(fixture(), ['left', 'right']);
        rig.bindings[0].points[0].weights = [{ boneId: 'b', weight: 1 }];
        expect(deformBinding(rig, rig.bindings[0]).get('start')).toEqual({ x: 30, y: 0 });
        expect(deformBinding(rig, rig.bindings[0]).get('handle')).toEqual({ x: 32, y: 0 });
        expect(deformBinding(rig, rig.bindings[1]).get('seam')).toEqual({ x: 25, y: 0 });
        expect(weightMembers(rig, { pathId: 'left', pointId: 'start' })).toEqual([
            { pathId: 'left', pointId: 'start' }, { pathId: 'left', pointId: 'handle' }, { pathId: 'right', pointId: 'seam' },
        ]);
    });

    it('independent handles copy the effective weights and may explicitly have no deformation', () => {
        const source = linkCoincidentWeights(fixture(), ['left', 'right']);
        const rig = setPointIndependent(source, 'left', 'handle', true), handle = rig.bindings[0].points[1];
        expect(handle.weights).toEqual([{ boneId: 'a', weight: 1 }]);
        handle.weights = [];
        const deformed = deformBinding(rig, rig.bindings[0]);
        expect(deformed.get('handle')).toEqual({ x: 12, y: 0 });
        expect(deformed.get('start')!.y).toBeCloseTo(10);
        const restored = setPointIndependent(rig, 'left', 'handle', false);
        expect(deformBinding(restored, restored.bindings[0]).get('handle')!.y).toBeCloseTo(12);
        expect(validRigs({ version: 4, armatures: [rig] })).toBeTrue();
    });

    it('splits an owner by rehoming its shared set and preserves all effective weights', () => {
        const source = fixture(); source.bindings[1].points.push(anchor('second-seam', 5, 0));
        const linked = linkCoincidentWeights(source, ['left', 'right']);
        const split = unlinkPointWeights(linked, 'left', 'start');
        expect(weightOwner(split, 'left', 'start')).toEqual({ pathId: 'left', pointId: 'start' });
        expect(weightOwner(split, 'right', 'seam')).toEqual({ pathId: 'right', pointId: 'seam' });
        expect(weightOwner(split, 'right', 'second-seam')).toEqual({ pathId: 'right', pointId: 'seam' });
        expect(effectivePointWeights(split, split.bindings[1], split.bindings[1].points[2])).toEqual([{ boneId: 'a', weight: 1 }]);
        expect(validRigs({ version: 4, armatures: [split] })).toBeTrue();
    });

    it('removes bound paths without leaving dangling links on survivors', () => {
        const rig = detachBindingWeights(linkCoincidentWeights(fixture(), ['left', 'right']), ['left']);
        expect(rig.bindings.length).toBe(1);
        expect(weightOwner(rig, 'right', 'seam')).toEqual({ pathId: 'right', pointId: 'seam' });
        expect(rig.bindings[0].points[0].weights).toEqual([{ boneId: 'a', weight: 1 }]);
        expect(validRigs({ version: 4, armatures: [rig] })).toBeTrue();
    });

    it('restores handle inheritance while retaining weights on points formerly sharing that handle', () => {
        const source = setPointIndependent(fixture(), 'left', 'handle', true);
        source.bindings[1].points[0].x = 7;
        const linked = linkCoincidentWeights(source, ['left', 'right']);
        expect(weightOwner(linked, 'right', 'seam')).toEqual({ pathId: 'left', pointId: 'handle' });
        linked.bindings[0].points[1].weights = [{ boneId: 'b', weight: 1 }];
        const restored = setPointIndependent(linked, 'left', 'handle', false);
        expect(effectivePointWeights(restored, restored.bindings[0], restored.bindings[0].points[1])).toEqual([{ boneId: 'a', weight: 1 }]);
        expect(effectivePointWeights(restored, restored.bindings[1], restored.bindings[1].points[0])).toEqual([{ boneId: 'b', weight: 1 }]);
        expect(validRigs({ version: 4, armatures: [restored] })).toBeTrue();
    });

    it('unions influence membership when explicitly joining points with different allowed bones', () => {
        const source = fixture(); source.bindings[0].boneIds = ['a']; source.bindings[1].boneIds = ['b'];
        source.bindings[1].points.forEach(point => point.weights = [{ boneId: 'b', weight: 1 }]);
        const linked = linkCoincidentWeights(source, ['left', 'right']);
        expect(linked.bindings.map(binding => binding.boneIds)).toEqual([['a', 'b'], ['a', 'b']]);
        expect(validRigs({ version: 4, armatures: [linked] })).toBeTrue();
    });

    it('shares normalized influence editing between numeric controls and brushes without reordering no-ops', () => {
        const weights = [{ boneId: 'b', weight: .25 }, { boneId: 'a', weight: .75 }];
        expect(weightsWithInfluence(weights, 'b', .25)).toEqual(weights);
        expect(weightsWithInfluence(weights, 'b', .5)).toEqual([{ boneId: 'a', weight: .5 }, { boneId: 'b', weight: .5 }]);
        expect(weightsWithInfluence([{ boneId: 'a', weight: 1 }], 'a', 0)).toEqual([]);
        expect(weightsWithInfluence([], 'a', .1)).toEqual([{ boneId: 'a', weight: 1 }]);
        expect(() => weightsWithInfluence(weights, 'a', NaN)).toThrow();
    });

    it('rejects dangling links, cycles, noncanonical links, inherited handle owners and bad weights', () => {
        const invalid = (change: (rig: Armature) => void): void => { const rig = linkCoincidentWeights(fixture(), ['left', 'right']); change(rig); expect(validRigs({ version: 4, armatures: [rig] })).toBeFalse(); };
        invalid(rig => rig.bindings[1].points[0].weightSource!.pointId = 'missing');
        invalid(rig => { rig.bindings[0].points[0].weights = []; rig.bindings[0].points[0].weightSource = { pathId: 'right', pointId: 'seam' }; });
        invalid(rig => rig.bindings[1].points[0].weightSource!.pointId = 'handle');
        invalid(rig => rig.bindings[1].points[0].weights = [{ boneId: 'a', weight: 1 }]);
        invalid(rig => rig.bindings[0].points[1].weights = [{ boneId: 'a', weight: 1 }]);
        invalid(rig => rig.bindings[0].points[0].weights = [{ boneId: 'a', weight: .5 }]);
        invalid(rig => rig.bindings[1].boneIds = ['b']);
    });

    it('persists explicit shared owners and independent empty handles in document v14 / rig v5', () => {
        const rig = setPointIndependent(linkCoincidentWeights(fixture(), ['left', 'right']), 'left', 'handle', true);
        rig.bindings[0].points[1].weights = [];
        const data = { ...documentV12IK.data, rigs: { version: 4, armatures: [rig] } } as any;
        const envelope = createDocumentEnvelope(data), result = migrateDocument(JSON.parse(JSON.stringify(envelope)));
        expect(envelope.version).toBe(14);
        expect(result.status).toBe('ok');
        if(result.status === 'ok') { expect(result.migrated).toBeFalse(); expect(result.value.data.rigs?.armatures).toEqual([rig]); }
    });

    it('migrates legacy anchor inheritance without inventing shared groups or handle overrides', () => {
        const data = { ...documentV12IK.data, rigs: { version: 3, armatures: [fixture()] } } as any;
        const result = migrateDocument({ kind: 'svg-animator/document', version: 12, data });
        expect(result.status).toBe('ok');
        if(result.status !== 'ok') return;
        expect(result.value.data.rigs!.version).toBe(5);
        expect(result.value.data.rigs!.armatures).toEqual(data.rigs.armatures);
        expect(result.value.data.rigs!.armatures[0].bindings[0].points[1].independent).toBeUndefined();
    });
});
