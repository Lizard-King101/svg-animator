import { NgZone } from '@angular/core';
import { ElementFactory } from './element-factory.service';
import { LayerCommandService } from './layer-command.service';
import { LayerOperationsService } from './layer-operations.service';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { HistoryService } from './history.service';
import { SVG } from '../editor/objects/svg.object';
import { Path } from '../editor/objects/elements/path.object';
import { Group } from '../editor/objects/elements/group.object';
import { Shape } from '../editor/objects/elements/shape.object';
import { Point } from '../editor/objects/point.object';
import { Line } from '../editor/objects/line.object';
import { Armature, effectivePointWeights, validRigs, weightOwner } from '../editor/objects/armature';
import { createPathBinding, bindingProblem, applyRigPose } from '../editor/rig-binding';
import { createDefaultAnimation } from '../editor/objects/animation.object';
import { createDefaultGradient, GradientPaint } from '../editor/objects/paint.object';
import { pathPointAnimationProperty } from '../editor/objects/animation-targets';
import { ownMatrix, parentMatrixFor, combinedMatrixFor, pinTransformOrigin } from '../editor/objects/element-bounds';
import { attachmentProblem, applyAttachments } from '../editor/rig-attachments';
import { EditorPage } from '../editor/editor.page';

describe('rig-aware artwork duplication', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
    function setup() {
        const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
        const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0, 0) });
        editor.selectedSVG = svg;
        const factory = new ElementFactory(editor), operations = new LayerOperationsService(editor, factory);
        const playback = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences);
        playback.mode = 'edit';
        const projects = { upsert: jasmine.createSpy('upsert') };
        const mutations = new DocumentMutationService(editor, playback, new HistoryService(), projects as never);
        const commands = new LayerCommandService(editor, operations, mutations, null, playback);
        cleanups.push(() => { playback.ngOnDestroy(); mutations.ngOnDestroy(); });
        const path = () => {
            const result = new Path(editor);
            result.lines = [new Line(editor, { type: 'bezier', points: [new Point(0, 0), new Point(100, 0)],
                controlStart: new Point(20, -10), controlEnd: new Point(70, 10) })];
            svg.elements.push(result); return result;
        };
        const rig = (): Armature => {
            const result: Armature = { id: 'rig', name: 'Character', bindings: [], bones: [
                { id: 'upper', name: 'Upper', parentId: null, x: 0, y: 0, angle: 0, length: 50, pose: 0 },
                { id: 'lower', name: 'Lower', parentId: 'upper', x: 50, y: 0, angle: 0, length: 50, pose: 0 },
            ] };
            svg.rigs.armatures = [result]; return result;
        };
        return { editor, svg, factory, operations, playback, projects, mutations, commands, path, rig };
    }

    it('copies complete appearance and remaps clipped groups, motion dependencies, and closing-edge sections', () => {
        const t = setup(), source = t.path(), motion = t.path();
        source.closed = true; source.drawProgress = .45;
        source.settings.stroke_dasharray = [5, 3]; source.motion.pathId = motion.id;
        source.outlineSections = [{ id: 'section', contourId: source.contours[0].id,
            start: { segmentId: source.lines[0].id, t: .25 }, end: { segmentId: `${source.contours[0].id}:close`, t: .7 },
            startTaper: { length: .2, tipWidth: 0 }, endTaper: { length: .1, tipWidth: .4 } }];
        const group = new Group(t.editor); group.elements = [source, motion]; group.clipElementId = source.id;
        t.svg.elements = [group];
        const copy = t.operations.duplicate(group) as Group, path = copy.elements[0] as Path;
        expect(copy.clipElementId).toBe(path.id); expect(path.motion.pathId).toBe(copy.elements[1].id);
        expect(path.drawProgress).toBe(.45); expect(path.raw).toBe(source.raw);
        expect(path.outlineSections![0]).toEqual({ ...source.outlineSections[0], id: path.outlineSections![0].id,
            contourId: path.contours[0].id, start: { segmentId: path.lines[0].id, t: .25 },
            end: { segmentId: `${path.contours[0].id}:close`, t: .7 } });
        expect(path.outlineSections![0].id).not.toBe('section');
        path.outlineSections![0].startTaper!.length = .4; path.settings.stroke_dasharray[0] = 99;
        expect(source.outlineSections[0].startTaper!.length).toBe(.2); expect(source.settings.stroke_dasharray).toEqual([5, 3]);
        source.outlineSections = []; expect((t.factory.clone(source) as Path).outlineSections).toEqual([]);
    });

    it('keeps internal shared owners and independent handles within a copied reflected group and follows the same rig', () => {
        const t = setup(), first = t.path(), second = t.path(), rig = t.rig();
        const group = new Group(t.editor); group.elements = [first, second]; group.transform.scaleX = -1; group.transform.rotation = 20;
        t.svg.elements = [group];
        // Bone assignment pins this chain so later deformation cannot move its transform pivots.
        [group, first, second].forEach(pinTransformOrigin);
        rig.bindings = [first, second].map(path => ({ ...createPathBinding(t.svg, path, 'upper'), scopeId: group.id, boneIds: ['upper', 'lower'] }));
        const owner = rig.bindings[0].points[0]; owner.weights = [{ boneId: 'upper', weight: .6 }, { boneId: 'lower', weight: .4 }]; owner.lockedBoneIds = ['lower'];
        const member = rig.bindings[1].points[0]; member.weights = []; member.weightSource = { pathId: first.id, pointId: owner.id };
        const handle = rig.bindings[0].points.find(point => point.id !== point.anchorId)!;
        handle.independent = true; handle.weights = [{ boneId: 'lower', weight: 1 }]; handle.lockedBoneIds = ['lower'];
        expect(bindingProblem(t.svg, rig)).toBeUndefined();
        const copy = t.operations.duplicateMany([second, group])[0] as Group;
        expect(bindingProblem(t.svg, rig)).toBeUndefined();
        const copiedFirst = copy.elements[0] as Path, copiedSecond = copy.elements[1] as Path;
        const firstBinding = rig.bindings.find(binding => binding.pathId === copiedFirst.id)!, secondBinding = rig.bindings.find(binding => binding.pathId === copiedSecond.id)!;
        expect(t.svg.elements).toEqual([group, copy]); expect(rig.bindings.length).toBe(4);
        expect(firstBinding.scopeId).toBe(copy.id); expect(secondBinding.scopeId).toBe(copy.id);
        expect(weightOwner(rig, copiedSecond.id, secondBinding.points[0].id)).toEqual({ pathId: copiedFirst.id, pointId: firstBinding.points[0].id });
        expect(firstBinding.points[0].lockedBoneIds).toEqual(['lower']);
        const copiedHandle = firstBinding.points.find(point => point.independent)!;
        expect(copiedHandle.weights).toEqual(handle.weights); expect(copiedHandle.weights).not.toBe(handle.weights);
        firstBinding.points[0].weights[0].weight = .5; firstBinding.points[0].weights[1].weight = .5;
        expect(owner.weights[0].weight).toBe(.6);
        rig.bones[1].pose = 35; applyRigPose(t.svg, rig);
        expect(bindingProblem(t.svg, rig)).toBeUndefined(); expect(validRigs(t.svg.rigs)).toBeTrue();
    });

    it('materializes external owners once within copied shared groups, retaining locks and anchor inheritance', () => {
        const t = setup(), outside = t.path(), first = t.path(), second = t.path(), rig = t.rig();
        rig.bindings = [outside, first, second].map(path => ({ ...createPathBinding(t.svg, path, 'upper'), boneIds: ['upper', 'lower'] }));
        const original = rig.bindings[0].points[0]; original.lockedBoneIds = ['upper'];
        for(const binding of rig.bindings.slice(1)) { binding.points[0].weights = []; binding.points[0].weightSource = { pathId: outside.id, pointId: original.id }; }
        const copies = t.operations.duplicateMany([second, first]) as Path[];
        const bindings = copies.map(path => rig.bindings.find(binding => binding.pathId === path.id)!);
        const owner = weightOwner(rig, copies[0].id, bindings[0].points[0].id);
        expect(weightOwner(rig, copies[1].id, bindings[1].points[0].id)).toEqual(owner);
        expect(owner.pathId).toBe(copies[0].id); expect(bindings[0].points[0].lockedBoneIds).toEqual(['upper']);
        bindings[0].points[0].lockedBoneIds!.push('lower');
        expect(original.lockedBoneIds).toEqual(['upper']);
        expect(effectivePointWeights(rig, bindings[1], bindings[1].points.find(point => point.id !== point.anchorId)!)).toEqual(original.weights);
        expect(validRigs(t.svg.rigs)).toBeTrue();
    });

    it('copies rigid attachments without duplicating bones and preserves their pose', () => {
        const t = setup(), rig = t.rig();
        const shape = new Shape(t.editor, { type: 'ellipse', position: new Point(40, 10) }); t.svg.elements.push(shape);
        rig.attachments = [{ elementId: shape.id, boneId: 'lower', parentMatrix: parentMatrixFor(t.svg.elements, shape),
            worldMatrix: combinedMatrixFor(t.svg.elements, shape), restTransform: { ...shape.transform } }];
        const copy = t.operations.duplicate(shape)!;
        expect(rig.attachments.length).toBe(2); expect(rig.attachments[1].boneId).toBe('lower');
        expect(rig.attachments[1].restTransform).not.toBe(rig.attachments[0].restTransform);
        rig.bones[1].pose = 60; applyAttachments(t.svg, rig);
        expect(ownMatrix(copy)).toEqual(ownMatrix(shape)); expect(attachmentProblem(t.svg, rig)).toBeUndefined();
        expect(rig.bones.length).toBe(2); expect(t.svg.rigs.armatures.length).toBe(1);
    });

    it('extends existing action scopes and remaps channels without copying sources or placements', () => {
        const t = setup(), path = t.path(), rig = t.rig();
        path.settings.stroke = createDefaultGradient('stroke');
        const point = path.pathPoints()[0], animation = createDefaultAnimation();
        animation.tracks = [{ id: 'point-track', targetId: path.id, property: pathPointAnimationProperty(point.id, 'x'), valueType: 'number',
            keyframes: [{ id: 'point-key', time: 1, value: 20, temporal: { linked: false, in: { speed: 3, influence: .25 } } }] },
            { id: 'bone-track', targetId: rig.id, property: 'bones.upper.pose', valueType: 'number', keyframes: [{ id: 'bone-key', time: 1, value: 10 }] }];
        t.svg.animation.tracks = [{ id: 'stop-track', targetId: path.id, property: 'settings.stroke.gradient.stops.stroke-stop-1.offset', valueType: 'number', keyframes: [{ id: 'stop-key', time: 1, value: .4 }] }];
        const action = { id: 'action', name: 'Wave', targetIds: [path.id, rig.id], animation };
        const placement = { id: 'placement', actionId: action.id, start: 1 };
        t.svg.animation.composition = { version: 1, actions: [action], placements: [placement] };
        const copy = t.operations.duplicate(path) as Path;
        expect(action.targetIds).toEqual([path.id, rig.id, copy.id]);
        expect(action.animation.tracks.length).toBe(3);
        const track = action.animation.tracks[2];
        expect(track.targetId).toBe(copy.id); expect(track.property).toBe(pathPointAnimationProperty(copy.pathPoints()[0].id, 'x'));
        expect(track.id).not.toBe('point-track'); expect(track.keyframes[0].id).not.toBe('point-key');
        expect(track.keyframes[0].temporal).toEqual(animation.tracks[0].keyframes[0].temporal);
        expect(t.svg.animation.tracks[1].property).toBe(`settings.stroke.gradient.stops.${(copy.settings.stroke as GradientPaint).stops[0].id}.offset`);
        expect(t.svg.animation.composition.actions).toEqual([action]); expect(t.svg.animation.composition.placements).toEqual([placement]);
    });

    it('duplicates a reversed multi-selection beside originals, selects copies, and undoes the whole operation once', () => {
        const t = setup(), first = t.path(), second = t.path(), rig = t.rig();
        rig.bindings = [createPathBinding(t.svg, first, 'upper')];
        t.editor.selectedElements = [second, first]; t.svg.snapshot(); t.mutations.resetBaseline();
        t.commands.duplicateSelectedLayers();
        const copies = t.editor.selectedElements;
        expect(copies.length).toBe(2); expect(t.svg.elements).toEqual([first, copies[0], second, copies[1]]);
        expect(t.projects.upsert).toHaveBeenCalledTimes(1); expect(t.svg.rigs.armatures[0].bindings.length).toBe(2);
        const save = t.svg.save(), restored = SVG.fromSave(save, t.editor);
        expect(restored.rigs).toEqual(t.svg.rigs); expect(restored.elements.map(element => element.save())).toEqual(save.elements);
        t.mutations.undo(); expect(t.svg.elements.length).toBe(2); expect(t.svg.rigs.armatures[0].bindings.length).toBe(1);
        t.mutations.redo(); expect(t.svg.elements.length).toBe(4); expect(t.svg.rigs.armatures[0].bindings.length).toBe(2);
    });

    it('duplicates authored geometry while an animation preview is active', () => {
        const t = setup(), path = t.path();
        t.svg.animation.tracks = [{ id: 'move', targetId: path.id, property: pathPointAnimationProperty(path.pathPoints()[0].id, 'x'), valueType: 'number',
            keyframes: [{ id: 'start', time: 0, value: 0 }, { id: 'end', time: 1, value: 80 }] }];
        t.svg.snapshot(); t.mutations.resetBaseline(); t.editor.selectedElements = [path];
        t.playback.mode = 'animate'; t.playback.currentTime = 1; t.playback.previewAt(1);
        expect(path.pathPoints()[0].x).toBe(80);
        t.commands.duplicateSelectedLayers();
        const copy = t.editor.selectedElement as Path;
        t.playback.restorePreview();
        expect(path.pathPoints()[0].x).toBe(0); expect(copy.pathPoints()[0].x).toBe(0);
        expect(t.svg.animation.tracks.length).toBe(2);
    });

    it('refuses destructive stroke conversion and path combination with outline or rig metadata', () => {
        const t = setup(), first = t.path(), second = t.path(), rig = t.rig();
        first.outlineSections = [];
        const before = JSON.stringify(t.svg.save());
        expect(t.operations.convertStroke(first, 'precise')).toBeUndefined();
        expect(t.operations.operationError).toContain('Restore full outline');
        expect(t.operations.combine([first, second], second)).toBeFalse();
        expect(JSON.stringify(t.svg.save())).toBe(before);
        delete first.outlineSections; rig.bindings = [createPathBinding(t.svg, first, 'upper')];
        expect(t.operations.combine([first, second], second)).toBeFalse();
        expect(t.operations.operationError).toContain('bound to bones');
        t.editor.selectedElements = [first];
        t.commands.openLayerContextMenu(new MouseEvent('contextmenu'), first);
        expect(t.editor.contextMenu!.items.find(item => item.label === 'Convert stroke to path')?.disabled).toBeTrue();
        expect(t.editor.contextMenu!.infoLines?.[0]).toContain('Use Edit outline');
    });

    it('routes Ctrl and Cmd D to the complete selection and leaves editable fields alone', () => {
        const t = setup(), first = t.path(), second = t.path();
        t.editor.selectedElements = [first, second]; t.svg.snapshot(); t.mutations.resetBaseline();
        const page = { ui: {}, outline: { active: false }, editor: t.editor, layers: t.commands, animation: t.playback, mutations: t.mutations,
            selectionCommands: { handleKey: () => false } } as unknown as EditorPage;
        const key = (metaKey: boolean) => new KeyboardEvent('keydown', { key: 'd', ctrlKey: !metaKey, metaKey, cancelable: true });
        const ctrl = key(false); EditorPage.prototype.handleKeyDown.call(page, ctrl);
        expect(ctrl.defaultPrevented).toBeTrue(); expect(t.svg.elements.length).toBe(4);
        const cmd = key(true); EditorPage.prototype.handleKeyDown.call(page, cmd);
        expect(cmd.defaultPrevented).toBeTrue(); expect(t.svg.elements.length).toBe(6);
        const input = document.createElement('input'), editing = key(false); Object.defineProperty(editing, 'target', { value: input });
        EditorPage.prototype.handleKeyDown.call(page, editing); expect(editing.defaultPrevented).toBeFalse(); expect(t.svg.elements.length).toBe(6);
    });
});
