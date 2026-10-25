import { NgZone } from '@angular/core';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { HistoryService } from './history.service';
import { RigEditingService } from './rig-editing.service';
import { SVG } from '../editor/objects/svg.object';
import { Path } from '../editor/objects/elements/path.object';
import { Group } from '../editor/objects/elements/group.object';
import { Point } from '../editor/objects/point.object';
import { Line } from '../editor/objects/line.object';
import { effectivePointWeights, validRigs, weightOwner } from '../editor/objects/armature';

describe('atomic shared weight commands', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
    function setup() {
        const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
        const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0, 0) });
        const left = new Path(editor), right = new Path(editor), group = new Group(editor);
        left.lines = [new Line(editor, { type: 'bezier', points: [new Point(100, 100), new Point(140, 100)], controlStart: new Point(110, 90), controlEnd: new Point(130, 90) })];
        right.lines = [new Line(editor, { type: 'line', points: [new Point(100, 100), new Point(100, 150)] })];
        group.elements = [left, right]; svg.elements = [group]; editor.selectedSVG = svg; editor.selectedElement = group; svg.snapshot();
        const playback = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences); playback.mode = 'edit';
        const projects = { upsert: jasmine.createSpy('upsert') };
        const mutations = new DocumentMutationService(editor, playback, new HistoryService(), projects as never); mutations.resetBaseline();
        const rigs = new RigEditingService(editor, playback, mutations);
        cleanups.push(() => { playback.ngOnDestroy(); mutations.ngOnDestroy(); });
        rigs.create(); const root = rigs.bone!; rigs.addBone(false); const other = rigs.bone!;
        rigs.bindGroup(group, [root.id, other.id]);
        const leftRef = { pathId: left.id, pointId: left.lines[0].points[0].id }, rightRef = { pathId: right.id, pointId: right.lines[0].points[0].id };
        const weights = (pathId: string, pointId: string) => { const binding = rigs.active!.bindings.find(item => item.pathId === pathId)!; return effectivePointWeights(rigs.active!, binding, binding.points.find(point => point.id === pointId)!); };
        return { editor, svg, left, right, group, playback, projects, mutations, rigs, root, other, leftRef, rightRef, weights };
    }

    it('deduplicates shared aliases into one undo step and skips semantic no-ops', () => {
        const t = setup(), saves = t.projects.upsert.calls.count(), before = t.svg.save();
        const weights = [{ boneId: t.root.id, weight: .2 }, { boneId: t.other.id, weight: .8 }];
        expect(t.rigs.applyWeightUpdates([{ ...t.leftRef, weights }, { ...t.rightRef, weights: [...weights].reverse() }])).toBeTrue();
        expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        expect(t.weights(t.rightRef.pathId, t.rightRef.pointId)).toEqual(weights);
        t.rigs.applyWeightUpdates([{ ...t.rightRef, weights: [...weights].reverse() }]);
        expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        t.mutations.undo(); expect(t.svg.save()).toEqual(before);
    });

    it('rejects conflicting alias updates and invalid batches without partial writes', () => {
        const t = setup(), before = t.svg.save(), saves = t.projects.upsert.calls.count();
        expect(t.rigs.applyWeightUpdates([
            { ...t.leftRef, weights: [{ boneId: t.root.id, weight: 1 }] },
            { ...t.rightRef, weights: [{ boneId: t.other.id, weight: 1 }] },
        ])).toBeFalse();
        expect(t.rigs.applyWeightUpdates([
            { ...t.leftRef, weights: [{ boneId: t.root.id, weight: 1 }] },
            { pathId: t.right.id, pointId: 'missing', weights: [] },
        ])).toBeFalse();
        expect(t.rigs.applyWeightUpdates([{ ...t.leftRef, weights: [{ boneId: t.root.id, weight: NaN }] }])).toBeFalse();
        expect(t.svg.save()).toEqual(before); expect(t.projects.upsert.calls.count()).toBe(saves);
    });

    it('edits shared memberships without stripping unrelated points on other paths', () => {
        const t = setup(), unrelated = t.right.lines[0].points[1].id, original = structuredClone(t.weights(t.right.id, unrelated));
        expect(t.rigs.setScopeInfluences([t.left.id], [t.root.id])).toBeTrue();
        expect(t.weights(t.right.id, t.rightRef.pointId)).toEqual([{ boneId: t.root.id, weight: 1 }]);
        expect(t.weights(t.right.id, unrelated)).toEqual(original);
        expect(t.rigs.active!.bindings.find(binding => binding.pathId === t.right.id)!.boneIds).toContain(t.other.id);
        expect(t.rigs.setPointWeight(t.rightRef, t.other.id, .5)).toBeFalse();
        expect(t.rigs.setScopeInfluences([t.left.id], [t.root.id, t.other.id])).toBeTrue();
        expect(t.rigs.setPointWeight(t.leftRef, t.other.id, .3)).toBeTrue();
        expect(t.weights(t.right.id, unrelated)).toEqual(original); expect(validRigs(t.svg.rigs)).toBeTrue();
    });

    it('updates posed shared points and independent handles with artwork and weights in one undo step', () => {
        const t = setup(); t.rigs.workspace = 'pose'; t.rigs.setPosePosition(20, 0, t.other.id); t.rigs.workspace = 'weights';
        const handleRef = { pathId: t.left.id, pointId: t.left.lines[0].controlStart!.id };
        t.rigs.setHandleIndependent(handleRef, true);
        const before = t.svg.save(), saves = t.projects.upsert.calls.count();
        t.rigs.applyWeightUpdates([{ ...t.rightRef, weights: [{ boneId: t.other.id, weight: 1 }] }, { ...handleRef, weights: [] }]);
        expect(t.left.lines[0].points[0].x).toBeCloseTo(120); expect(t.right.lines[0].points[0].x).toBeCloseTo(120);
        expect(t.left.lines[0].controlStart!.x).toBeCloseTo(110); expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        t.mutations.undo(); expect(t.svg.save()).toEqual(before);
    });

    it('unbinds a shared owner without altering survivors, the current pose, or geometry IDs', () => {
        const t = setup(); t.rigs.workspace = 'pose'; t.rigs.setPosePosition(20, 0, t.other.id);
        const current = [t.left, t.right].map(path => path.pathPoints().map(point => ({ id: point.id, x: point.x, y: point.y }))), saves = t.projects.upsert.calls.count();
        expect(t.rigs.unbindScope([t.left.id])).toBeTrue();
        expect(weightOwner(t.rigs.active!, t.rightRef.pathId, t.rightRef.pointId)).toEqual(t.rightRef);
        expect([t.left, t.right].map(path => path.pathPoints().map(point => ({ id: point.id, x: point.x, y: point.y })))).toEqual(current);
        expect(t.projects.upsert.calls.count()).toBe(saves + 1); expect(validRigs(t.svg.rigs)).toBeTrue();
        const posedLeft = t.left.pathPoints().map(point => point.x); t.rigs.resetPose();
        expect(t.left.pathPoints().map(point => point.x)).toEqual(posedLeft); expect(t.right.lines[0].points[0].x).toBeCloseTo(100);
    });

    it('rejects a partially bound group and a locked descendant atomically', () => {
        const t = setup(); t.rigs.unbindScope([t.left.id]);
        let before = t.svg.save(), saves = t.projects.upsert.calls.count();
        expect(t.rigs.bindGroup(t.group, [t.root.id])).toBeFalse();
        expect(t.svg.save()).toEqual(before); expect(t.projects.upsert.calls.count()).toBe(saves);
        t.rigs.unbindScope([t.right.id]); t.right.locked = true; t.mutations.commit('metadata');
        before = t.svg.save(); saves = t.projects.upsert.calls.count();
        expect(t.rigs.bindGroup(t.group, [t.root.id])).toBeFalse();
        expect(t.svg.save()).toEqual(before); expect(t.projects.upsert.calls.count()).toBe(saves);
    });
});
