import { EditorPreferencesService } from '../_services/editor-preferences.service';
import { EditorService } from '../_services/editor.service';
import { AnimationEvaluationPlan } from './animation/animation-evaluation-plan';
import { AnimationInspectionSnapshot } from './animation/animation-inspection';
import { CURRENT_DOCUMENT_VERSION, createDocumentEnvelope, migrateDocument } from './migrations/document-migrations';
import { AnimationTrack, createDefaultAnimation } from './objects/animation.object';
import { Armature, boneMatrices } from './objects/armature';
import { Group } from './objects/elements/group.object';
import { Path } from './objects/elements/path.object';
import { Shape } from './objects/elements/shape.object';
import { Line } from './objects/line.object';
import { Point } from './objects/point.object';
import { SVG } from './objects/svg.object';
import { applyMatrix, identityMatrix } from './objects/transform.object';
import { createPathBinding } from './rig-binding';
import { evaluateRigConstraints } from './rig-constraints';
import { applyDocumentRigAnimation, parseRigAnimationProperty, readDocumentAnimationProperty, rigAnimationBaseProblem, rigAnimationProperty, writeDocumentAnimationProperty } from './rig-animation';
import { captureRigAnimationPreview, restoreRigAnimationPreview } from './rig-animation-preview';

function fixture(constrained = false) {
    const editor = new EditorService(new EditorPreferencesService());
    const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0, 0) });
    const path = new Path(editor);
    path.lines = [new Line(editor, { type: 'bezier', points: [new Point(40, 0, 'joint'), new Point(80, 0, 'tip')],
        controlStart: new Point(50, 4, 'handle-a'), controlEnd: new Point(70, 4, 'handle-b') })];
    path.transform.originX = path.transform.originY = 0;
    const shape = new Shape(editor, { type: 'rectangle', position: new Point(80, 0), width: 10, height: 10 });
    shape.transform.originX = shape.transform.originY = 0;
    svg.elements = [path, shape];
    const rig: Armature = { id: 'rig', name: 'Leg', bones: [
        { id: 'root', name: 'Root', kind: 'point', parentId: null, x: 0, y: 0, angle: 0, length: 0, pose: 0 },
        { id: 'upper', name: 'Upper', parentId: 'root', x: 0, y: 0, angle: 0, length: 40, pose: 0 },
        { id: 'lower', name: 'Lower', parentId: 'upper', x: 40, y: 0, angle: 0, length: 40, pose: 0 },
        { id: 'foot', name: 'Foot', kind: 'point', parentId: 'root', x: 80, y: 0, angle: 0, length: 0, pose: 0 },
    ], bindings: [createPathBinding(svg, path, 'lower')], attachments: [{ elementId: shape.id, boneId: 'lower',
        parentMatrix: identityMatrix(), worldMatrix: identityMatrix(), restTransform: { ...shape.transform } }],
        ...(constrained ? { constraints: [{ id: 'ik', name: 'Leg IK', type: 'two-bone-ik' as const,
            upperBoneId: 'upper', lowerBoneId: 'lower', targetBoneId: 'foot', enabled: true, bend: 1 as const }] } : {}) };
    svg.rigs.armatures = [rig];
    svg.animation.duration = 4;
    editor.selectedSVG = svg;
    return { editor, svg, path, shape, rig };
}

function track(boneId: string, field: 'pose' | 'poseX' | 'poseY', from: number, to: number): AnimationTrack {
    return { id: `${boneId}-${field}`, targetId: 'rig', property: rigAnimationProperty(boneId, field), valueType: 'number', keyframes: [
        { id: 'a', time: 0, value: from, easing: { type: 'linear' } }, { id: 'b', time: 1, value: to },
    ] };
}

function apply(plan: AnimationEvaluationPlan, svg: SVG, time: number): void {
    plan.evaluate(time).forEach(value => { if(value.applied) writeDocumentAnimationProperty(svg, value.targetId, value.property, value.value); });
    applyDocumentRigAnimation(svg);
}

describe('bone animation model and evaluation', () => {
    it('addresses only supported authored pose fields and retains artwork adapters', () => {
        const { svg, rig, path } = fixture();
        expect(parseRigAnimationProperty('bones.my.bone.poseY')).toEqual({ boneId: 'my.bone', field: 'poseY' });
        expect(parseRigAnimationProperty('bones.upper.length')).toBeUndefined();
        expect(readDocumentAnimationProperty(svg, rig.id, 'bones.upper.poseX')).toBe(0);
        expect(writeDocumentAnimationProperty(svg, rig.id, 'bones.upper.poseX', 15)).toBeTrue();
        expect(writeDocumentAnimationProperty(svg, rig.id, 'bones.upper.pose', NaN)).toBeFalse();
        expect(writeDocumentAnimationProperty(svg, rig.id, 'bones.missing.pose', 15)).toBeFalse();
        expect(writeDocumentAnimationProperty(svg, rig.id, 'bones.upper.length', 15)).toBeFalse();
        expect(rig.bones[1].length).toBe(40);
        expect(writeDocumentAnimationProperty(svg, path.id, 'opacity', .5)).toBeTrue();
        expect(readDocumentAnimationProperty(svg, path.id, 'opacity')).toBe(.5);
    });

    it('evaluates FK before weighted paths and rigid attachments without accumulating poses', () => {
        const { svg, rig, path, shape } = fixture();
        svg.animation.tracks = [track('upper', 'pose', 0, 90), track('root', 'poseX', 0, 20)];
        const plan = new AnimationEvaluationPlan(svg.animation, svg.elements, svg.rigs);
        expect(plan.targetMap.has(rig.id)).toBeFalse();
        expect(plan.evaluate(.5).every(value => value.applied)).toBeTrue();
        for(const time of [1, .25, 0, 1]) {
            apply(plan, svg, time);
            const expected = applyMatrix(boneMatrices(rig).get('lower')!, 40, 0);
            expect(path.findPointById('tip')!.x).toBeCloseTo(expected.x);
            expect(path.findPointById('tip')!.y).toBeCloseTo(expected.y);
        }
        expect(path.findPointById('tip')!.x).toBeCloseTo(20);
        expect(path.findPointById('tip')!.y).toBeCloseTo(80);
        expect(shape.transform.rotation).toBeCloseTo(90);
        expect(rig.bones[1].pose).toBe(90);
    });

    it('interpolates both target coordinates before solving IK while retaining authored FK', () => {
        const { svg, rig, path } = fixture(true);
        svg.animation.tracks = [track('foot', 'poseX', 0, -40), track('foot', 'poseY', 0, 40)];
        const plan = new AnimationEvaluationPlan(svg.animation, svg.elements, svg.rigs);
        for(const time of [1, .5, 0, .8]) {
            apply(plan, svg, time);
            expect(path.findPointById('tip')!.x).toBeCloseTo(80 - 40 * time, 5);
            expect(path.findPointById('tip')!.y).toBeCloseTo(40 * time, 5);
            expect(rig.bones[1].pose).toBe(0);
            expect(rig.bones[2].pose).toBe(0);
        }
        expect(evaluateRigConstraints(rig).bones[1].pose).not.toBe(0);
    });

    it('resumes enabled IK for animation without changing suspended authored setup', () => {
        const { svg, rig, path } = fixture(true);
        rig.constraintsActive = false;
        writeDocumentAnimationProperty(svg, rig.id, 'bones.foot.poseX', -40);
        writeDocumentAnimationProperty(svg, rig.id, 'bones.foot.poseY', 40);
        applyDocumentRigAnimation(svg);
        expect(path.findPointById('tip')!.x).toBeCloseTo(40);
        expect(path.findPointById('tip')!.y).toBeCloseTo(40);
        expect(rig.constraintsActive).toBeFalse();
    });

    it('uses source-time mappings for reusable rig actions and restores the base at window edges', () => {
        const { svg, rig, path } = fixture();
        rig.bones[0].poseY = 5;
        applyDocumentRigAnimation(svg);
        const action = createDefaultAnimation(); action.duration = 1; action.tracks = [track('root', 'poseY', 10, 30)];
        svg.animation.composition = { version: 1, actions: [{ id: 'step', name: 'Step', targetIds: [rig.id], animation: action }],
            placements: [{ id: 'first', actionId: 'step', start: 1, rate: 2, repeat: 2 }] };
        const plan = new AnimationEvaluationPlan(svg.animation, svg.elements, svg.rigs);
        const samples = [[.5, 5], [1, 10], [1.25, 20], [1.5, 10], [1.75, 20], [2, 5], [.5, 5]];
        samples.forEach(([time, expected]) => {
            apply(plan, svg, time);
            expect(rig.bones[0].poseY).withContext(`time ${time}`).toBeCloseTo(expected);
            expect(path.findPointById('tip')!.y).toBeCloseTo(expected);
        });
    });

    it('marks missing bones and nonnumeric channels as unapplied', () => {
        const { svg } = fixture();
        svg.animation.tracks = [track('missing', 'pose', 0, 90), { ...track('upper', 'pose', 0, 90), valueType: 'string' }];
        const plan = new AnimationEvaluationPlan(svg.animation, svg.elements, svg.rigs);
        expect(plan.evaluate(.5).map(value => value.applied)).toEqual([false, false]);
    });

    it('retains reflected group coordinates and inherited/independent weights while evaluating', () => {
        const { svg, editor, path, rig } = fixture();
        const group = new Group(editor); group.elements = [path]; group.transform.scaleX = -2;
        group.transform.scaleY = .5; group.transform.originX = group.transform.originY = 0;
        svg.elements = [group]; rig.attachments = [];
        rig.bindings = [createPathBinding(svg, path, 'root')];
        const handle = rig.bindings[0].points.find(point => point.id === 'handle-a')!;
        handle.independent = true; handle.weights = [];
        svg.animation.tracks = [track('root', 'poseX', 0, 20)];
        apply(new AnimationEvaluationPlan(svg.animation, svg.elements, svg.rigs), svg, 1);
        expect(path.findPointById('tip')!.x).toBeCloseTo(70);
        expect(path.findPointById('handle-a')!.x).toBeCloseTo(50);
        expect(path.findPointById('handle-b')!.x).toBeCloseTo(60);
    });

    it('samples detached rig onion skins without drift and includes controlled artwork', () => {
        const { svg, editor, path, rig } = fixture(true);
        svg.animation.tracks = [track('foot', 'poseX', 0, -40), track('foot', 'poseY', 0, 40)];
        const original = JSON.stringify(svg.save());
        const detached = SVG.fromSave(svg.save(), editor), inspection = new AnimationInspectionSnapshot(detached);
        const first = inspection.origins(.75, [path.id]);
        inspection.origins(.1, [path.id]);
        expect(inspection.origins(.75, [path.id])).toEqual(first);
        const skins = inspection.skins(.5, .1, [rig.id]);
        const source = decodeURIComponent(skins[0].image.split(',')[1]);
        expect(source).toContain(`id="${path.id}"`);
        expect(JSON.stringify(svg.save())).toBe(original);
        expect(detached.rigs.armatures[0].bones[1].pose).toBe(0);
    });

    it('restores base poses, bound geometry and attachments by ID on live and detached previews', () => {
        const { svg, editor, rig } = fixture(true);
        rig.constraintsActive = false;
        const base = svg.save(), snapshot = captureRigAnimationPreview(svg);
        writeDocumentAnimationProperty(svg, rig.id, 'bones.foot.poseX', -40);
        writeDocumentAnimationProperty(svg, rig.id, 'bones.foot.poseY', 40);
        applyDocumentRigAnimation(svg);
        expect(svg.save()).not.toEqual(base);
        const detached = SVG.fromSave(svg.save(), editor);
        restoreRigAnimationPreview(detached, snapshot);
        expect(detached.save()).toEqual(base);
        restoreRigAnimationPreview(svg, snapshot);
        expect(svg.save()).toEqual(base);
        expect(rig.bones[3].poseX).toBeUndefined();
        expect(rig.bones[3].poseY).toBeUndefined();
        const other = SVG.fromSave(base, editor); other.id = 'other-document';
        other.rigs.armatures[0].bones[3].poseX = 100;
        restoreRigAnimationPreview(other, snapshot);
        expect(other.rigs.armatures[0].bones[3].poseX).toBe(100);
    });

    it('refuses edited bound points and topology before animation can overwrite the base', () => {
        const { svg, rig, path } = fixture(), ids = new Set([rig.id]);
        path.findPointById('tip')!.x = 999;
        const edited = JSON.stringify(svg.save());
        expect(rigAnimationBaseProblem(svg, ids)).toContain('Bound points were edited');
        expect(JSON.stringify(svg.save())).toBe(edited);
        path.findPointById('tip')!.x = 80;
        path.lines[0].controlEnd = undefined;
        const changedTopology = JSON.stringify(svg.save());
        expect(rigAnimationBaseProblem(svg, ids)).toContain('topology changed');
        expect(JSON.stringify(svg.save())).toBe(changedTopology);
    });

    it('ignores animated visibility and editor locks while retaining attachment/transform checks', () => {
        const { svg, rig, path, shape } = fixture(), ids = new Set([rig.id]);
        path.visible = false; path.locked = true; shape.visible = false; shape.locked = true;
        expect(rigAnimationBaseProblem(svg, ids)).toBeUndefined();
        shape.transform.translateX = 5;
        expect(rigAnimationBaseProblem(svg, ids)).toContain('attached transform changed');
        shape.transform.translateX = 0;
        path.transform.translateY = 5;
        expect(rigAnimationBaseProblem(svg, ids)).toContain('bound path transform changed');
    });

    it('round-trips pose channels and actions through v15 without rewriting legacy rig appearance', () => {
        const { svg, editor } = fixture(true);
        svg.animation.tracks = [track('foot', 'poseY', 0, 40)];
        const action = createDefaultAnimation(); action.tracks = [track('upper', 'pose', 0, 30)];
        svg.animation.composition = { version: 1, actions: [{ id: 'bend', name: 'Bend', targetIds: ['rig'], animation: action }], placements: [] };
        const envelope = createDocumentEnvelope(svg.save());
        expect(envelope.version).toBe(CURRENT_DOCUMENT_VERSION);
        const migrated = migrateDocument(JSON.parse(JSON.stringify(envelope)));
        expect(migrated.status).toBe('ok');
        if(migrated.status !== 'ok') return;
        expect(migrated.migrated).toBeFalse();
        expect(SVG.fromSave(migrated.value.data, editor).save()).toEqual(svg.save());
        const legacy = { ...envelope, version: 14 };
        const upgrade = migrateDocument(legacy);
        expect(upgrade.status).toBe('ok');
        if(upgrade.status === 'ok') {
            expect(upgrade.migrated).toBeTrue();
            expect(upgrade.value.data).toEqual(legacy.data);
        }
        expect(migrateDocument({ ...envelope, version: CURRENT_DOCUMENT_VERSION + 1 }).status).toBe('unsupported');
    });
});
