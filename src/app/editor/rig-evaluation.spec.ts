import { RigEvaluationPlan } from '../../../packages/runtime/src/rig/evaluation-plan';
import { EditorService } from '../_services/editor.service';
import { EditorPreferencesService } from '../_services/editor-preferences.service';
import { createRigPerformanceFixture } from './animation/rig-performance-fixture';
import { AnimationEvaluationPlan } from './animation/animation-evaluation-plan';
import { evaluateRigConstraints } from './rig-constraints';
import { deformBinding } from './objects/armature';
import { attachmentTransforms } from './rig-attachments';
import { DocumentRigEvaluationPlan } from './rig-evaluation';
import { SVG } from './objects/svg.object';

describe('compiled rig evaluation', () => {
    const fixture = () => createRigPerformanceFixture(new EditorService(new EditorPreferencesService()));
    it('matches the reference solver/deformer at forward, backward, direct and loop-boundary times', () => {
        const svg = fixture(), source = svg.rigs.armatures[0], plan = new RigEvaluationPlan(source);
        const animation = new AnimationEvaluationPlan(svg.animation, svg.elements, svg.rigs);
        const times = [...Array.from({ length: 181 }, (_, i) => i / 60), 2.999999, 0, 1.37, .01, 3, 1.37];
        for(const time of times) {
            animation.evaluateEach(time, (track, value) => {
                if(track.rigChannel) track.rigChannel.bone[track.rigChannel.field] = Number(value);
            });
            const before = structuredClone(source), reference = evaluateRigConstraints(source), result = plan.evaluate(source);
            expect(source).toEqual(before);
            result.pose.bones.forEach((bone, i) => expect(bone.pose).withContext(`${time} ${bone.id}`).toBeCloseTo(reference.bones[i].pose, 10));
            for(const binding of source.bindings) for(const [id, point] of deformBinding(reference, binding)) {
                const actual = result.paths.get(binding.pathId)!.get(id)!;
                expect(actual.x).toBeCloseTo(point.x, 8); expect(actual.y).toBeCloseTo(point.y, 8);
            }
            expect(result.transforms).toEqual(attachmentTransforms(reference));
        }
    });
    it('does not clone setup during steady evaluation, and reuses output point objects', () => {
        const source = fixture().rigs.armatures[0], plan = new RigEvaluationPlan(source);
        const first = plan.evaluate(source).paths.values().next().value!.values().next().value;
        const clone = spyOn(globalThis, 'structuredClone').and.callThrough();
        source.bones[0].poseX = 42; plan.evaluate(source);
        expect(plan.paths.values().next().value!.values().next().value).toBe(first);
        expect(clone).not.toHaveBeenCalled();
    });
    it('does not contaminate direct seeks after unreachable targets or suspended constraints', () => {
        const source = fixture().rigs.armatures[0], plan = new RigEvaluationPlan(source);
        const original = structuredClone(plan.evaluate(source).paths);
        source.bones[6].poseX = 10000; plan.evaluate(source);
        source.constraintsActive = false; plan.evaluate(source);
        source.constraintsActive = true; source.bones[6].poseX = 0;
        expect(plan.evaluate(source).paths).toEqual(original);
    });
    it('restores omitted attachment origins even when all numeric transforms match', () => {
        const svg = fixture(), rig = svg.rigs.armatures[0];
        rig.constraints = [];
        delete rig.attachments![0].restTransform.originX; delete rig.attachments![0].restTransform.originY;
        const animation = new AnimationEvaluationPlan(svg.animation, svg.elements, svg.rigs);
        const attachment = animation.targetMap.get(rig.attachments![0].elementId)!;
        const plan = new DocumentRigEvaluationPlan(svg);
        rig.bones[0].pose = 360; plan.apply();
        expect(attachment.transform.originX).toBe(0);
        rig.bones[0].pose = 0;
        expect(plan.apply().has(attachment.id)).toBeTrue();
        expect(attachment.transform.originX).toBeUndefined();
        expect(attachment.transform.originY).toBeUndefined();
    });
    it('preflights all rigs before materializing any and reports only changed artwork', () => {
        const editor = new EditorService(new EditorPreferencesService()), svg = createRigPerformanceFixture(editor, { rigs: 3 });
        const before = svg.save(); svg.rigs.armatures[0].bones[0].poseX = 50;
        svg.rigs.armatures[2].bones[2].poseY = 20;
        expect(() => new DocumentRigEvaluationPlan(svg).apply()).toThrowError(/valid pose/);
        expect(svg.save().elements).toEqual(before.elements);
        svg.rigs.armatures[2].bones[2].poseY = 0;
        const plan = new DocumentRigEvaluationPlan(svg);
        expect(plan.apply().size).toBe(3); expect(plan.apply().size).toBe(0);
        const restored = SVG.fromSave(before, editor);
        const restoredPlan = new DocumentRigEvaluationPlan(restored);
        restoredPlan.apply(); expect(restoredPlan.apply().size).toBe(0);
    });
});
