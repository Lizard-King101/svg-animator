import { RuntimeScene } from '../../../../packages/runtime/src/scene';
import { createPlayer, RuntimePlayerError, validateRuntimeBundle } from '../../../../packages/runtime/src';
import { evaluateRuntimeTrack } from '../../../../packages/runtime/src/evaluator';
import { rigChannelConflict } from '../../../../packages/runtime/src/rig/runtime-rigs';
import { EditorService } from '../../_services/editor.service';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { Armature, deformBinding } from '../objects/armature';
import { SVG } from '../objects/svg.object';
import { Path } from '../objects/elements/path.object';
import { Group } from '../objects/elements/group.object';
import { Point } from '../objects/point.object';
import { Line } from '../objects/line.object';
import { identityMatrix, transformMatrix } from '../objects/transform.object';
import { applyRigPose, createPathBinding } from '../rig-binding';
import { evaluateRigConstraints } from '../rig-constraints';
import { applyAttachments, attachmentTransforms } from '../rig-attachments';
import { buildSVGMarkup } from '../svg-markup';
import { compileRuntimeAnimation } from './runtime-animation-compiler';
import { parseFixtureSvg } from './runtime-dom-parity.spec-support';
import { AnimationTrack } from '../objects/animation.object';
import { documentRigChannelProblem } from '../rig-animation-conflicts';
import { fullOutlineSections } from '../../../../packages/runtime/src/outline';
import { pathOutlineContours, projectPathOutline } from '../path-outline';
import { ImperativeSvgRenderer } from './imperative-svg-renderer';

describe('portable rig animation', () => {
    function fixture() {
        const editor = new EditorService(new EditorPreferencesService()), svg = new SVG(editor, { width: 400, height: 300, pos: new Point(0, 0) });
        const group = new Group(editor), path = new Path(editor), seam = new Path(editor), attachment = new Group(editor);
        group.transform = { translateX: 110, translateY: 20, rotation: 20, scaleX: -1.3, scaleY: 1.3, originX: 0, originY: 0 };
        path.transform.originX = path.transform.originY = 0;
        seam.transform.originX = seam.transform.originY = 0;
        path.lines = [new Line(editor, { type: 'bezier', points: [new Point(0, 0), new Point(100, 0)], controlStart: new Point(20, 30), controlEnd: new Point(80, -20) })];
        seam.lines = [new Line(editor, { type: 'line', points: [new Point(100, 0), new Point(150, 10)] })];
        group.elements = [path, seam]; svg.elements = [group, attachment];
        const rig: Armature = { id: 'rig', name: 'Character', bones: [
            { id: 'root', name: 'Root', kind: 'point', parentId: null, x: 0, y: 0, angle: 0, length: 0, pose: 0 },
            { id: 'upper', name: 'Upper', parentId: 'root', x: 0, y: 0, angle: 0, length: 100, pose: 0 },
            { id: 'lower', name: 'Lower', parentId: 'upper', x: 100, y: 0, angle: 0, length: 80, pose: 0 },
            { id: 'target', name: 'Foot', kind: 'point', parentId: 'root', x: 150, y: 0, angle: 0, length: 0, pose: 0 },
        ], bindings: [createPathBinding(svg, path, 'upper'), createPathBinding(svg, seam, 'upper')], constraints: [
            { id: 'ik', name: 'Leg', type: 'two-bone-ik', enabled: true, upperBoneId: 'upper', lowerBoneId: 'lower', targetBoneId: 'target', bend: 1 },
        ], attachments: [{ elementId: attachment.id, boneId: 'lower', parentMatrix: identityMatrix(), worldMatrix: identityMatrix(), restTransform: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, originX: 0, originY: 0 } }] };
        const binding = rig.bindings[0], shared = binding.points.find(point => point.id === path.lines[0].points[1].id)!;
        shared.weights = [{ boneId: 'upper', weight: .25 }, { boneId: 'lower', weight: .75 }];
        const handle = binding.points.find(point => point.id === path.lines[0].controlStart!.id)!;
        handle.independent = true; handle.weights = [{ boneId: 'lower', weight: 1 }];
        const seamPoint = rig.bindings[1].points.find(point => point.id === seam.lines[0].points[0].id)!;
        seamPoint.weights = []; seamPoint.weightSource = { pathId: path.id, pointId: shared.id };
        svg.rigs = { version: 5, armatures: [rig] };
        svg.animation.duration = 3;
        svg.animation.tracks = [channel('target', 'poseY', 0, 70), channel('root', 'poseX', 0, 30)];
        materializeBase(svg, rig);
        return { svg, path, seam, rig, attachment, group };
    }
    function materializeBase(svg: SVG, rig: Armature): void {
        const posed = evaluateRigConstraints(rig);
        applyRigPose(svg, posed); applyAttachments(svg, posed);
    }
    function channel(bone: string, field: string, from: number, to: number): AnimationTrack {
        return { id: `${bone}-${field}`, targetId: 'rig', property: `bones.${bone}.${field}`, valueType: 'number', keyframes: [{ id: 'a', time: 0, value: from }, { id: 'b', time: 1, value: to }] };
    }
    function mounted(svg: SVG) {
        const result = compileRuntimeAnimation(svg.save());
        expect(result.diagnostics).toEqual([]);
        validateRuntimeBundle(result.bundle);
        const root = parseFixtureSvg(buildSVGMarkup(svg, { runtime: { signature: result.bundle.artwork.signature } }));
        return { root, bundle: result.bundle, scene: new RuntimeScene(root, result.bundle.artwork.targets, result.bundle.rigs) };
    }
    function seek(scene: RuntimeScene, bundle: ReturnType<typeof compileRuntimeAnimation>['bundle'], time: number): Armature {
        const authored = structuredClone(bundle.rigs!.armatures[0]);
        for(const track of bundle.animation.tracks) {
            const value = evaluateRuntimeTrack(track, time), property = bundle.animation.properties[track.property];
            scene.write(bundle.animation.targets[track.target], property, value);
            const match = /^bones\.(.+)\.(pose|poseX|poseY)$/.exec(property);
            if(match && bundle.animation.targets[track.target] === authored.id) authored.bones.find(bone => bone.id === match[1])![match[2] as 'pose' | 'poseX' | 'poseY'] = Number(value);
        }
        scene.render(); return evaluateRigConstraints(authored);
    }

    it('compiles numeric rig channels with an explicit portable capability and unchanged keys', () => {
        const { svg } = fixture(), source = svg.save(), first = compileRuntimeAnimation(source), second = compileRuntimeAnimation(source);
        expect(first).toEqual(second);
        expect(first.bundle.requiredCapabilities).toContain('rig.pose-v1');
        expect(first.bundle.animation.targets).toEqual(['rig']);
        expect(first.bundle.animation.tracks.every(track => track.times.length === 2)).toBeTrue();
        expect(svg.save()).toEqual(source);
    });

    it('matches shared seams, independent handles and reflected parent spaces on random seeks without accumulation', () => {
        const { svg } = fixture(), { scene, bundle } = mounted(svg), before = structuredClone(bundle);
        for(const time of [.8, 0, 1, .15, .65, .15]) {
            const posed = seek(scene, bundle, time);
            for(const binding of posed.bindings) {
                const expected = deformBinding(posed, binding), target = scene.targets.find(target => target.id === binding.pathId)!;
                for(const line of target.path!.contours.flatMap(contour => contour.lines)) for(const point of [...line.points, line.controlStart, line.controlEnd]) if(point) {
                    expect(point.x).toBeCloseTo(expected.get(point.id)!.x, 7);
                    expect(point.y).toBeCloseTo(expected.get(point.id)!.y, 7);
                }
            }
            for(const [id, expected] of attachmentTransforms(posed)) {
                const actual = scene.targets.find(target => target.id === id)!.transform;
                expect(transformMatrix(actual, { x: actual.originX, y: actual.originY })).toEqual(transformMatrix(expected, { x: expected.originX ?? 0, y: expected.originY ?? 0 }));
            }
        }
        expect(bundle).toEqual(before);
    });

    it('projects outlined limbs after IK and shared/independent weight deformation in reflected groups', () => {
        const { svg, path, seam } = fixture();
        path.outlineSections = fullOutlineSections(pathOutlineContours(path));
        path.outlineSections[0].start.t = .15; path.outlineSections[0].end.t = .9;
        path.outlineSections[0].startTaper = { length: .2, tipWidth: 0 };
        path.outlineSections[0].endTaper = { length: .3, tipWidth: .25 };
        seam.outlineSections = fullOutlineSections(pathOutlineContours(seam));
        const { scene, bundle, root } = mounted(svg), editorRoot = parseFixtureSvg(buildSVGMarkup(svg, { runtime: { signature: bundle.artwork.signature } }));
        const renderer = new ImperativeSvgRenderer(svg, editorRoot);
        for(const time of [0, .2, .8, .4, 1]) {
            const posed = seek(scene, bundle, time); applyRigPose(svg, posed); applyAttachments(svg, posed);
            renderer.markDirty(path); renderer.markDirty(seam); renderer.flush();
            for(const artwork of [path, seam]) {
                const expected = projectPathOutline(artwork).strokeData;
                expect(root.querySelector(`[id="${artwork.id}"] [data-render-role~="outline"]`)!.getAttribute('d')).toBe(expected);
                expect(editorRoot.querySelector(`[id="${artwork.id}"] [data-render-role~="outline"]`)!.getAttribute('d')).toBe(expected);
            }
        }
    });

    it('evaluates source actions with trims, rates and repeats, restoring scene values outside each block', () => {
        const { svg } = fixture(), sourceTrack = channel('target', 'poseY', 0, 80);
        svg.animation.tracks = [];
        svg.animation.composition = { version: 1, actions: [{ id: 'walk', name: 'Step', targetIds: ['rig'], animation: { version: 2, duration: 1, loop: false, tracks: [sourceTrack], markers: [], variables: [] } }], placements: [{ id: 'walk-1', actionId: 'walk', start: .5, sourceStart: .25, sourceEnd: .75, rate: 2, repeat: 2 }] };
        const { scene, bundle } = mounted(svg);
        expect(bundle.requiredCapabilities).toContain('composition.action-timing-v1');
        const expected = new Map([[.25, 0], [.5, 20], [.625, 40], [.75, 20], [.875, 40], [1, 0]]);
        for(const [time, value] of expected) {
            expect(evaluateRuntimeTrack(bundle.animation.tracks[0], time)).toBeCloseTo(value, 8);
            seek(scene, bundle, time);
        }
    });

    it('renders player output and keeps separate instances isolated', () => {
        const { svg, path } = fixture(), first = mounted(svg), second = mounted(svg);
        const a = createPlayer(first.root, first.bundle), b = createPlayer(second.root, second.bundle);
        const original = second.root.querySelector(`[id="${path.id}"]`)!.getAttribute('d');
        a.seek(.75);
        expect(first.root.querySelector(`[id="${path.id}"]`)!.getAttribute('d')).not.toBe(original);
        expect(second.root.querySelector(`[id="${path.id}"]`)!.getAttribute('d')).toBe(original);
        b.seek(.75);
        expect(first.root.querySelector(`[id="${path.id}"]`)!.getAttribute('d')).toBe(second.root.querySelector(`[id="${path.id}"]`)!.getAttribute('d'));
        a.destroy(); b.destroy();
    });

    it('evaluates FK and a separate armature without baking or sharing authored pose state', () => {
        const { svg, rig } = fixture(); rig.constraints = []; materializeBase(svg, rig);
        const other: Armature = { id: 'prop', name: 'Prop', bones: [{ id: 'pivot', name: 'Pivot', kind: 'point', parentId: null, x: 0, y: 0, angle: 0, length: 0, pose: 0 }], bindings: [] };
        svg.rigs.armatures.push(other);
        svg.animation.tracks = [channel('upper', 'pose', 0, 100), { ...channel('pivot', 'pose', 0, -40), targetId: other.id }];
        const { scene, bundle } = mounted(svg);
        expect(bundle.rigs!.armatures.length).toBe(2);
        const posed = seek(scene, bundle, .5);
        expect(posed.bones.find(bone => bone.id === 'upper')!.pose).toBe(50);
        expect(svg.rigs.armatures[0].bones[1].pose).toBe(0);
        expect(svg.rigs.armatures[1].bones[0].pose).toBe(0);
    });

    it('resumes enabled IK during animation even when Bone setup suspended the static solve', () => {
        const { svg, rig } = fixture(); rig.constraintsActive = false; materializeBase(svg, rig);
        const { scene, bundle } = mounted(svg);
        const original = structuredClone(bundle.rigs);
        seek(scene, bundle, .5);
        const target = scene.targets.find(target => target.id === rig.bindings[0].pathId)!;
        const posed = evaluateRigConstraints({ ...rig, constraintsActive: true, bones: rig.bones.map(bone => ({ ...bone, ...(bone.id === 'root' ? { poseX: 15 } : bone.id === 'target' ? { poseY: 35 } : {}) })) });
        const expected = deformBinding(posed, posed.bindings[0]);
        expect(target.path!.contours[0].lines[0].points[1].y).toBeCloseTo(expected.get(target.path!.contours[0].lines[0].points[1].id)!.y, 7);
        expect(bundle.rigs).toEqual(original);
    });

    it('rejects absent capabilities, missing bone/point/attachment references and nonnumeric rig channels', () => {
        const { svg } = fixture(), { bundle } = mounted(svg);
        const cases: ((copy: typeof bundle) => void)[] = [
            copy => { copy.requiredCapabilities = copy.requiredCapabilities.filter(capability => capability !== 'rig.pose-v1'); },
            copy => { copy.rigs = undefined; },
            copy => { copy.animation.properties[0] = 'bones.missing.pose'; },
            copy => { copy.rigs!.armatures[0].bindings[0].points[0].id = 'missing'; },
            copy => { copy.rigs!.armatures[0].attachments![0].elementId = 'missing'; },
            copy => { copy.animation.tracks[0] = { ...copy.animation.tracks[0], kind: 'string', values: ['a', 'b'] }; },
        ];
        for(const mutate of cases) { const copy = structuredClone(bundle); mutate(copy); expect(() => validateRuntimeBundle(copy)).toThrowError(RuntimePlayerError); }
    });

    it('reports direct geometry conflicts without silently overwriting them and allows style channels', () => {
        const { svg, path, group } = fixture();
        svg.animation.tracks.push({ ...channel('root', 'pose', 0, 1), targetId: path.id, property: `path.points.${path.lines[0].points[0].id}.x` });
        const compiled = compileRuntimeAnimation(svg.save());
        expect(compiled.diagnostics.some(diagnostic => diagnostic.message.includes('controls this artwork'))).toBeTrue();
        expect(compiled.bundle.animation.tracks.length).toBe(2);
        const scene = compiled.bundle.artwork.targets;
        expect(rigChannelConflict(svg.rigs, scene, { targetId: group.id, property: 'transform.rotation' })).toBeDefined();
        expect(rigChannelConflict(svg.rigs, scene, { targetId: path.id, property: 'settings.fill' })).toBeUndefined();
    });

    it('does not add rig metadata or a capability to static posed exports', () => {
        const { svg } = fixture(); svg.animation.tracks = [];
        const { bundle } = compileRuntimeAnimation(svg.save());
        expect(bundle.rigs).toBeUndefined();
        expect(bundle.requiredCapabilities).not.toContain('rig.pose-v1');
    });

    it('diagnoses edited bound geometry and captured transforms before compiling playable output', () => {
        const { svg, path, group } = fixture();
        path.lines[0].points[0].x += 5;
        expect(compileRuntimeAnimation(svg.save()).diagnostics.some(diagnostic => diagnostic.message.includes('Bound points'))).toBeTrue();
        path.lines[0].points[0].x -= 5; group.transform.rotation += 10;
        expect(compileRuntimeAnimation(svg.save()).diagnostics.some(diagnostic => diagnostic.message.includes('transform of bound path'))).toBeTrue();
    });

    it('guards prospective rig and artwork keys across reusable action sources', () => {
        const { svg, path } = fixture();
        expect(documentRigChannelProblem(svg, path.id, 'transform.rotation')).toContain('controls this artwork');
        expect(documentRigChannelProblem(svg, path.id, 'opacity')).toBeUndefined();
        expect(documentRigChannelProblem(svg, 'rig', 'bones.lower.pose')).toContain('IK target');
        svg.animation.tracks = [];
        svg.animation.composition = { version: 1, actions: [{ id: 'shape-action', name: 'Deform', targetIds: [path.id], animation: { version: 2, duration: 1, loop: false, tracks: [{ ...channel('root', 'pose', 0, 10), targetId: path.id, property: 'geometry.x' }], variables: [], markers: [] } }], placements: [] };
        expect(documentRigChannelProblem(svg, 'rig', 'bones.root.poseX')).toContain('action source');
    });
});
