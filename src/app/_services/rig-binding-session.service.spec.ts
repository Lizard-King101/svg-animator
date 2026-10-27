import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RigBindingControlsComponent } from '../_components/rig-editor/rig-binding-controls.component';
import { RigWeightsPanelComponent } from '../_components/rig-editor/rig-weights-panel.component';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { HistoryService } from './history.service';
import { RigEditingService } from './rig-editing.service';
import { RigBindingSessionService } from './rig-binding-session.service';
import { SVG } from '../editor/objects/svg.object';
import { Path } from '../editor/objects/elements/path.object';
import { Group } from '../editor/objects/elements/group.object';
import { Point } from '../editor/objects/point.object';
import { Line } from '../editor/objects/line.object';
import { boneWeightColor } from '../editor/rig-weight-colors';
import { effectivePointWeights, validRigs } from '../editor/objects/armature';
import { Shape } from '../editor/objects/elements/shape.object';

describe('artwork-pinned binding and weights workspace', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
    function setup(bound = true) {
        const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
        const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0, 0) });
        const path = new Path(editor); path.name = 'Leg artwork';
        path.lines = [new Line(editor, { type: 'bezier', points: [new Point(100, 100), new Point(140, 100)], controlStart: new Point(110, 90), controlEnd: new Point(130, 90) })];
        const other = new Path(editor); other.name = 'Other artwork';
        other.lines = [new Line(editor, { type: 'line', points: [new Point(30, 20), new Point(50, 30)] })];
        svg.elements = [path, other]; editor.selectedSVG = svg; editor.selectedElement = path; svg.snapshot();
        const playback = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences); playback.mode = 'edit';
        const projects = { upsert: jasmine.createSpy('upsert') };
        const mutations = new DocumentMutationService(editor, playback, new HistoryService(), projects as never); mutations.resetBaseline();
        const rigs = new RigEditingService(editor, playback, mutations);
        cleanups.push(() => { playback.ngOnDestroy(); mutations.ngOnDestroy(); });
        rigs.create(); const root = rigs.bone!; rigs.addBone(true); const child = rigs.bone!;
        if(bound) rigs.bind(path, [root.id], true);
        const session = new RigBindingSessionService(rigs, mutations);
        return { editor, svg, path, other, playback, mutations, rigs, session, projects, root, child };
    }

    it('keeps artwork while selecting bones and follows new artwork immediately', () => {
        const t = setup(); t.session.openWeights(); const before = t.svg.save();
        t.session.toggle(t.rigs.activeId!, t.child.id); t.editor.selectedElement = t.other; t.session.validate();
        expect(t.session.path).toBe(t.other); expect(t.session.binding).toBeUndefined(); expect(t.session.canUseSelected).toBeFalse();
        expect(t.svg.save()).toEqual(before);
        t.session.useSelected(); expect(t.session.path).toBe(t.other); expect(t.session.binding).toBeUndefined();
        expect(t.svg.save()).toEqual(before);
    });

    it('previews numeric weights on posed artwork live, restores on cancel and leaves rest artwork unchanged', () => {
        const t = setup(false); t.rigs.bind(t.path, [t.root.id, t.child.id], true); t.rigs.setPose(40, t.child.id); t.session.openWeights();
        const endpoint = t.path.lines[0].points[1]; t.session.selectPoint({ pathId: t.path.id, pointId: endpoint.id });
        const posed = t.svg.save(), saves = t.projects.upsert.calls.count(), value = t.session.weightValue(t.child.id)! > 50 ? 0 : 1;
        t.session.previewWeight(t.child.id, value);
        expect(t.svg.save().elements).not.toEqual(posed.elements); expect(t.svg.save().rigs).toEqual(posed.rigs);
        expect(t.projects.upsert.calls.count()).toBe(saves); expect(t.rigs.problem).toBeUndefined();
        const preview = t.svg.save().elements; t.session.cancelPreview(); expect(t.svg.save()).toEqual(posed);
        t.session.previewWeight(t.child.id, value); expect(t.session.applyPreview()).toBeTrue();
        expect(t.projects.upsert.calls.count()).toBe(saves + 1); expect(t.svg.save().elements).toEqual(preview); expect(t.rigs.problem).toBeUndefined();
        t.rigs.resetPose(); t.session.selectPoint({ pathId: t.path.id, pointId: endpoint.id }); const rest = t.svg.save();
        t.session.previewWeight(t.child.id, 1 - value); expect(t.session.previewKind).toBe('numeric'); expect(t.svg.save()).toEqual(rest); t.session.cancelPreview();
    });

    it('shows binding controls for artwork, or for a bone only in Weights', () => {
        const t = setup(false); t.editor.selectedElement = undefined; t.rigs.workspace = 'pose';
        expect(t.session.showsBindingControls).toBeFalse();
        t.rigs.workspace = 'weights'; expect(t.session.showsBindingControls).toBeTrue();
        t.rigs.workspace = 'rest'; t.editor.selectedElement = t.path; expect(t.session.showsBindingControls).toBeTrue();
    });

    it('owns brush tools, limits and shortcut steps and keeps the tool across artwork changes', () => {
        const t = setup(); t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]); t.session.openWeights();
        expect(t.session.setPaintMode('smooth')).toBeTrue(); t.session.openWeights(); expect(t.session.paintMode).toBe('smooth');
        t.session.setBrush('brushRadius', 900); expect(t.session.brushRadius).toBe(300);
        t.session.stepBrushSize(1); expect(t.session.brushRadius).toBe(300); t.session.stepBrushSize(-1); expect(t.session.brushRadius).toBe(250);
        t.session.setBrush('brushRadius', 4); t.session.stepBrushSize(1); expect(t.session.brushRadius).toBe(5); t.session.stepBrushSize(-1); expect(t.session.brushRadius).toBe(4);
        t.session.setBrush('brushStrength', .35); t.session.stepBrushStrength(1); expect(t.session.brushStrength).toBe(.4);
        t.session.setBrush('brushStrength', .98); t.session.stepBrushStrength(1); expect(t.session.brushStrength).toBe(1);
        t.session.setBrush('brushStrength', NaN); expect(t.session.brushStrength).toBe(1);
        t.session.openBoneWeights(); expect(t.session.paintMode).toBe('smooth');
    });

    it('refuses paint tools for rigid artwork and falls back to Select', () => {
        const t = setup(); t.session.openWeights(); t.session.validate();
        expect(t.session.canEditWeights).toBeFalse(); expect(t.session.setPaintMode('add')).toBeFalse(); expect(t.session.paintMode).toBe('select');
    });

    it('switches from bone-first to artwork-first when other artwork is chosen in Layers', () => {
        const t = setup(); t.session.openBoneWeights(); t.session.validate(); expect(t.session.scopeMode).toBe('bone');
        t.editor.selectedElement = t.other; t.session.validate();
        expect(t.session.scopeMode).toBe('artwork'); expect(t.session.target).toBe(t.other);
    });

    it('renders the tool bar, brush rows and weight display switch from session state', () => {
        const t = setup(); t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]); t.session.openWeights();
        TestBed.configureTestingModule({ imports: [RigWeightsPanelComponent], providers: [{ provide: RigBindingSessionService, useValue: t.session }] });
        const fixture = TestBed.createComponent(RigWeightsPanelComponent); fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement, tool = (label: string) => host.querySelector(`[aria-label="${label} tool"]`) as HTMLButtonElement;
        tool('Add').click(); fixture.detectChanges();
        expect(t.session.paintMode).toBe('add'); expect(tool('Add').getAttribute('aria-pressed')).toBe('true'); expect(host.querySelector('[aria-label="Weight brush value"]')).toBeNull();
        tool('Set').click(); fixture.detectChanges(); expect(host.querySelector('[aria-label="Weight brush value"]')).not.toBeNull();
        const slider = host.querySelector('[aria-label="Weight brush radius slider"]') as HTMLInputElement;
        slider.value = '80'; slider.dispatchEvent(new Event('input')); expect(t.session.brushRadius).toBe(80);
        Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Heat')!.click(); fixture.detectChanges();
        expect(t.session.weightDisplay).toBe('heat'); expect(host.querySelector('.heat-legend')).not.toBeNull();
        fixture.destroy();
    });

    it('closes unchanged bone picking without rewriting artwork or history', () => {
        const t = setup(false), saves = t.projects.upsert.calls.count(), before = t.svg.save();
        t.session.begin(); expect(t.session.assignmentChanged).toBeFalse();
        t.session.confirm(); expect(t.session.pending).toBeUndefined(); expect(t.projects.upsert.calls.count()).toBe(saves); expect(t.svg.save()).toEqual(before);
        t.session.begin(); t.session.toggle(t.rigs.activeId!, t.child.id); expect(t.session.assignmentChanged).toBeTrue();
        t.session.toggle(t.rigs.activeId!, t.child.id); expect(t.session.assignmentChanged).toBeFalse();
        t.session.toggle(t.rigs.activeId!, t.child.id); t.session.confirm(); expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        const bound = t.svg.save(); t.session.begin(); expect(t.session.pending?.bones).toEqual([t.child.id]); t.session.confirm();
        expect(t.session.pending).toBeUndefined(); expect(t.projects.upsert.calls.count()).toBe(saves + 1); expect(t.svg.save()).toEqual(bound);
    });

    it('edits multiple influence membership without rebinding, preserving manual weights and committing once', () => {
        const t = setup(); t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]); t.rigs.addBone(true); const third = t.rigs.bone!; t.session.openWeights(); const binding = t.session.binding!;
        const before = t.svg.save(), saves = t.projects.upsert.calls.count();
        t.session.begin(); expect(t.session.pending?.bones).toEqual([t.root.id, t.child.id]);
        t.session.toggle(t.rigs.activeId!, third.id); expect(t.svg.save()).toEqual(before);
        t.session.confirm(); expect(t.session.pending).toBeUndefined();
        expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        expect(t.session.binding?.matrix).toEqual(binding.matrix); expect(t.session.binding?.topology).toBe(binding.topology);
        expect(t.session.binding?.points).toEqual(binding.points);
        expect(t.session.binding?.boneIds).toEqual([t.root.id, t.child.id, third.id]);
        expect(t.session.binding?.points[0].weights).toEqual([{ boneId: t.root.id, weight: 1 }]);
        expect(validRigs(t.svg.rigs)).toBeTrue();
        t.rigs.setWeight(binding.points[0].id, t.child.id, .25, t.path.id);
        t.session.removeInfluence(third.id);
        t.session.removeInfluence(t.root.id);
        expect(t.session.binding?.points[0].weights).toEqual([{ boneId: t.child.id, weight: 1 }]);
        expect(t.session.binding?.boneIds).toEqual([t.child.id]);
        expect(t.svg.elements.map(element => element.id)).toEqual(before.elements.map(element => element.id));
        t.mutations.undo(); t.session.validate();
        expect(t.session.binding?.points[0].weights.find(weight => weight.boneId === t.child.id)?.weight).toBe(.25);
        expect(t.session.binding?.boneIds).toEqual([t.root.id, t.child.id]);
    });

    it('keeps picking temporary through selection changes and cancels on revision changes', () => {
        const t = setup(); t.session.openWeights(); const before = t.svg.save();
        t.session.begin('weighted'); t.session.toggle(t.rigs.activeId!, t.child.id);
        t.editor.selectedElement = t.other; t.session.validate(); expect(t.session.pending).toBeDefined();
        t.session.cancel(); expect(t.svg.save()).toEqual(before); expect(t.session.path).toBe(t.path);
        t.session.begin('weighted'); t.rigs.rename('Changed'); t.session.validate();
        expect(t.session.pending).toBeUndefined(); expect(t.session.path).toBe(t.other);
        t.editor.selectedSVG = new SVG(t.editor, { width: 200, height: 200, pos: new Point(0, 0) }); t.editor.selectedElement = undefined; t.session.validate();
        expect(t.session.isPinned).toBeFalse(); expect(t.session.binding).toBeUndefined();
    });

    it('keeps weights scoped to the original armature and resolves handle selection to its anchor', () => {
        const t = setup(); const originalRig = t.rigs.active!; t.rigs.create(); const otherRig = t.rigs.active!;
        t.session.openWeights(); expect(t.rigs.activeId).toBe(originalRig.id);
        t.session.toggle(otherRig.id, otherRig.bones[0].id); expect(t.rigs.activeId).toBe(originalRig.id);
        t.session.selectAnchor(t.path.lines[0].controlStart!.id);
        expect(t.rigs.anchorId).toBe(t.path.lines[0].points[0].id);
        t.session.begin('weighted'); t.session.toggle(originalRig.id, t.root.id);
        expect(t.session.pending?.bones).toEqual([]);
        t.session.toggle(otherRig.id, otherRig.bones[0].id); expect(t.session.pending?.rigId).toBe(originalRig.id);
        t.session.confirm(); expect(t.session.pending).toBeUndefined(); expect(t.session.binding).toBeUndefined();
    });

    it('does not remove the final influence and offers group binding', () => {
        const t = setup(); t.session.openWeights(); const before = t.svg.save(); t.session.removeInfluence(t.root.id);
        expect(t.svg.save()).toEqual(before);
        t.rigs.workspace = 'rest'; t.session.validate();
        const group = new Group(t.editor); group.elements = [t.other]; t.svg.elements = [t.path, group]; t.editor.selectedElement = group;
        t.session.begin('weighted'); expect(t.session.pending).toBeDefined(); expect(t.session.paths).toEqual([t.other]);
    });

    it('edits selected points through numeric controls and cancels Escape and empty input', () => {
        const t = setup(); t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]); t.session.openWeights(); t.session.selectPoint(t.path.id, t.path.lines[0].points[0].id);
        TestBed.configureTestingModule({ imports: [RigWeightsPanelComponent], providers: [{ provide: RigBindingSessionService, useValue: t.session }] });
        const fixture = TestBed.createComponent(RigWeightsPanelComponent); fixture.detectChanges();
        const input = fixture.nativeElement.querySelector('[aria-label="' + t.child.name + ' weight"]') as HTMLInputElement;
        input.value = '35'; input.dispatchEvent(new Event('blur')); fixture.detectChanges();
        expect(t.session.binding?.points[0].weights.find(weight => weight.boneId === t.child.id)?.weight).toBe(.35);
        const saves = t.projects.upsert.calls.count(); input.value = '85';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); input.dispatchEvent(new Event('blur'));
        expect(input.value).toBe('35'); expect(t.projects.upsert.calls.count()).toBe(saves);
        input.value = ''; input.dispatchEvent(new Event('blur')); expect(input.value).toBe('35');
        fixture.destroy();
    });

    it('renders unified assignment, inferred modes, and cancels pick mode with Escape', () => {
        const t = setup(false);
        TestBed.configureTestingModule({ imports: [RigBindingControlsComponent], providers: [{ provide: RigBindingSessionService, useValue: t.session }] });
        const fixture = TestBed.createComponent(RigBindingControlsComponent); fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Assign bones');
        t.session.begin(); t.session.toggle(t.rigs.activeId!, t.root.id); fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Rigid');
        expect(fixture.nativeElement.querySelector('.swatch')).not.toBeNull();
        t.session.confirm(); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Edit bones'); expect(fixture.nativeElement.textContent).toContain('Leg artwork');
        const before = t.svg.save(); t.session.begin();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); fixture.detectChanges();
        expect(t.session.pending).toBeUndefined(); expect(t.svg.save()).toEqual(before); fixture.destroy();
    });

    it('keeps influence colors stable across order and selection', () => {
        const t = setup(), color = boneWeightColor(t.root.id, t.rigs.active!.bones.map(bone => bone.id));
        expect(color).toMatch(/^hsl\(\d+ 72% 62%\)$/);
        t.rigs.active!.bones.reverse(); t.rigs.boneId = t.child.id;
        expect(t.session.color(t.root.id)).toBe(color);
        t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]);
        expect(t.session.color(t.root.id)).toBe(color);
        t.rigs.setBindingInfluences(t.path.id, [t.child.id]);
        expect(t.session.color(t.root.id)).toBe(color);
    });

    it('binds a nested group in one commit and keeps artwork order, clipping, and its pinned scope', () => {
        const t = setup(false), nested = new Group(t.editor), group = new Group(t.editor);
        nested.elements = [t.other]; group.elements = [t.path, nested]; group.clipElementId = t.path.id;
        t.svg.elements = [group]; t.editor.selectedElement = group; t.mutations.commit('artwork');
        const beforePoints = [t.path, t.other].map(path => path.pathPoints().map(point => ({ id: point.id, x: point.x, y: point.y }))), saves = t.projects.upsert.calls.count();
        t.session.begin('weighted'); t.session.toggle(t.rigs.activeId!, t.root.id); t.session.toggle(t.rigs.activeId!, t.child.id); t.session.confirm();
        expect(t.session.pending).toBeUndefined(); expect(t.session.bindings.map(binding => binding.pathId)).toEqual([t.path.id, t.other.id]);
        expect(t.session.bindings.every(binding => binding.scopeId === group.id)).toBeTrue();
        expect(t.projects.upsert.calls.count()).toBe(saves + 1); expect(t.svg.elements).toEqual([group]); expect(group.elements).toEqual([t.path, nested]); expect(nested.elements).toEqual([t.other]); expect(group.clipElementId).toBe(t.path.id);
        expect([t.path, t.other].map(path => path.pathPoints().map(point => ({ id: point.id, x: point.x, y: point.y })))).toEqual(beforePoints);
        expect(t.session.pointEntries.length).toBe(t.path.pathPoints().length + t.other.pathPoints().length);
        t.session.validate(); expect(t.session.target?.id).toBe(group.id);
        t.session.selectPoint(t.other.id, t.other.lines[0].points[0].id); expect(t.session.selectedPoint?.pathName).toBe(t.other.name);
        const boundSaves = t.projects.upsert.calls.count(); t.session.unlink();
        expect(t.rigs.active!.bindings).toEqual([]); expect(t.projects.upsert.calls.count()).toBe(boundSaves + 1);
        t.mutations.undo(); t.session.validate(); expect(t.session.bindings.length).toBe(2);
    });

    it('preflights the whole group and keeps unsupported artwork unbound without a partial save', () => {
        const t = setup(false), group = new Group(t.editor), shape = new Shape(t.editor, { type: 'rectangle', position: new Point(10, 10), width: 20, height: 20 });
        group.elements = [t.path, shape]; t.svg.elements = [group, t.other]; t.editor.selectedElement = group; t.mutations.commit('artwork');
        const before = t.svg.save(), saves = t.projects.upsert.calls.count();
        t.session.begin(); t.session.toggle(t.rigs.activeId!, t.root.id); t.session.toggle(t.rigs.activeId!, t.child.id); t.session.confirm();
        expect(t.session.pending).toBeDefined(); expect(t.rigs.message).toContain('native path');
        expect(t.svg.save()).toEqual(before); expect(t.projects.upsert.calls.count()).toBe(saves);
    });

    it('projects bone-first weights across artwork and exposes zero-weight points only when requested', () => {
        const t = setup(); t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]); t.rigs.bind(t.other, [t.child.id], true);
        t.session.openWeights(); t.rigs.selectBone(t.rigs.activeId!, t.child.id); t.session.openBoneWeights();
        const before = t.svg.save();
        expect(t.session.scopeMode).toBe('bone'); expect(t.session.bindings.length).toBe(2);
        expect(new Set(t.session.pointEntries.map(point => point.pathId))).toEqual(new Set([t.other.id]));
        t.session.controlledOnly = false; expect(new Set(t.session.pointEntries.map(point => point.pathId))).toEqual(new Set([t.path.id, t.other.id]));
        t.session.selectPoint(t.path.id, t.path.lines[0].controlStart!.id);
        expect(t.session.selectedIsHandle).toBeTrue(); expect(t.session.pointRef).toEqual({ pathId: t.path.id, pointId: t.path.lines[0].controlStart!.id });
        const key = t.session.scopeKey; t.session.toggle(t.rigs.activeId!, t.root.id); expect(t.session.scopeKey).not.toBe(key);
        expect(t.session.bindings.map(binding => binding.pathId)).toEqual([t.path.id]); expect(t.svg.save()).toEqual(before);
        t.session.setScopeMode('artwork'); expect(t.session.target?.id).toBe(t.path.id);
        t.session.openBoneWeights(); t.editor.selectedSVG = undefined; t.editor.selectedElement = undefined; t.session.validate();
        expect(t.session.scopeMode).toBe('artwork'); expect(t.session.pointRef).toBeUndefined();
    });

    it('edits independent handles from the sidebar and can restore anchor inheritance', () => {
        const t = setup(); t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]); t.session.openWeights();
        t.session.selectPoint(t.path.id, t.path.lines[0].controlStart!.id);
        TestBed.configureTestingModule({ imports: [RigWeightsPanelComponent], providers: [{ provide: RigBindingSessionService, useValue: t.session }] });
        const fixture = TestBed.createComponent(RigWeightsPanelComponent); fixture.detectChanges();
        const checkbox = fixture.nativeElement.querySelector('.point-state input[type=checkbox]') as HTMLInputElement;
        checkbox.click(); fixture.detectChanges(); expect(t.session.selectedIsIndependent).toBeTrue();
        const amount = fixture.nativeElement.querySelector('[aria-label="' + t.child.name + ' weight"]') as HTMLInputElement;
        amount.value = '80'; amount.dispatchEvent(new Event('blur')); fixture.detectChanges();
        expect(t.session.selectedWeights.find(weight => weight.boneId === t.child.id)?.weight).toBe(.8);
        expect(t.session.binding!.points.find(point => point.id === t.path.lines[0].points[0].id)!.weights).toEqual([{ boneId: t.root.id, weight: 1 }]);
        checkbox.click(); fixture.detectChanges(); expect(t.session.selectedIsIndependent).toBeFalse();
        expect(t.session.selectedWeights).toEqual([{ boneId: t.root.id, weight: 1 }]);
        t.mutations.undo(); fixture.detectChanges(); expect(t.session.selectedIsIndependent).toBeTrue();
        expect(t.session.selectedWeights.find(weight => weight.boneId === t.child.id)?.weight).toBe(.8); fixture.destroy();
    });

    it('shares exact overlapping point weights while preserving point identities, then separates them', () => {
        const t = setup(false), group = new Group(t.editor);
        t.other.lines[0].points[0].x = 100; t.other.lines[0].points[0].y = 100;
        group.elements = [t.path, t.other]; t.svg.elements = [group]; t.editor.selectedElement = group; t.mutations.commit('artwork');
        t.session.begin('weighted'); t.session.toggle(t.rigs.activeId!, t.root.id); t.session.toggle(t.rigs.activeId!, t.child.id); t.session.confirm();
        t.session.selectPoint(t.other.id, t.other.lines[0].points[0].id);
        expect(t.session.selectedSharedCount).toBe(2);
        const ref = t.session.selectedPoint!, originalIds = t.session.pointEntries.map(point => point.pointId);
        t.rigs.setPointWeight(ref, t.child.id, .8);
        expect(effectivePointWeights(t.rigs.active!, t.session.bindings[0], t.session.bindings[0].points[0]).find(weight => weight.boneId === t.child.id)?.weight).toBe(.8);
        t.session.unlinkSelectedWeights(); expect(t.session.selectedSharedCount).toBe(1);
        t.rigs.setPointWeight(t.session.selectedPoint!, t.child.id, .2);
        expect(effectivePointWeights(t.rigs.active!, t.session.bindings[0], t.session.bindings[0].points[0]).find(weight => weight.boneId === t.child.id)?.weight).toBe(.8);
        expect(t.session.pointEntries.map(point => point.pointId)).toEqual(originalIds);
        t.session.linkOverlapping(); expect(t.session.selectedSharedCount).toBe(2); expect(validRigs(t.svg.rigs)).toBeTrue();
    });

    it('keeps brush settings session-only and clamps invalid numeric input', () => {
        const t = setup(); t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]); t.session.openWeights(); const before = t.svg.save();
        TestBed.configureTestingModule({ imports: [RigWeightsPanelComponent], providers: [{ provide: RigBindingSessionService, useValue: t.session }] });
        const fixture = TestBed.createComponent(RigWeightsPanelComponent); t.session.paintMode = 'set'; fixture.detectChanges();
        const radius = fixture.nativeElement.querySelector('[aria-label="Weight brush radius"]') as HTMLInputElement;
        radius.value = '900'; radius.dispatchEvent(new Event('change')); expect(t.session.brushRadius).toBe(300);
        radius.value = ''; radius.dispatchEvent(new Event('change')); expect(radius.value).toBe('300');
        const strength = fixture.nativeElement.querySelector('[aria-label="Weight brush strength"]') as HTMLInputElement;
        strength.value = '15'; strength.dispatchEvent(new Event('change')); expect(t.session.brushStrength).toBe(.15);
        expect(t.svg.save()).toEqual(before); fixture.destroy();
    });

    it('keeps the group influence union while disabling weights not allowed on the selected path', () => {
        const t = setup(); t.rigs.bind(t.other, [t.child.id], true);
        const group = new Group(t.editor); group.elements = [t.path, t.other]; t.svg.elements = [group]; t.editor.selectedElement = group; t.mutations.commit('artwork'); t.session.openWeights();
        t.session.selectPoint(t.path.id, t.path.lines[0].points[0].id);
        TestBed.configureTestingModule({ imports: [RigWeightsPanelComponent], providers: [{ provide: RigBindingSessionService, useValue: t.session }] });
        const fixture = TestBed.createComponent(RigWeightsPanelComponent); fixture.detectChanges();
        expect(t.session.influences.map(bone => bone.id)).toEqual([t.root.id, t.child.id]);
        expect((fixture.nativeElement.querySelector('[aria-label="' + t.child.name + ' weight"]') as HTMLInputElement).disabled).toBeTrue();
        t.session.selectPoint(t.other.id, t.other.lines[0].points[0].id); fixture.detectChanges();
        expect((fixture.nativeElement.querySelector('[aria-label="' + t.child.name + ' weight"]') as HTMLInputElement).disabled).toBeTrue();
        t.session.begin('weighted'); expect(t.session.pending?.bones).toEqual([t.root.id, t.child.id]); fixture.destroy();
    });

    it('follows incoming bone-first armature selections without stealing the pinned artwork scope', () => {
        const t = setup(); const firstRig = t.rigs.active!;
        t.rigs.create(); const secondRig = t.rigs.active!; t.rigs.bind(t.other, [secondRig.bones[0].id], true);
        t.session.openWeights(); t.session.openBoneWeights(); t.session.toggle(secondRig.id, secondRig.bones[0].id); t.session.selectPoint(t.other.id, t.other.lines[0].points[0].id);
        const before = t.svg.save(); t.session.toggle(firstRig.id, t.root.id);
        expect(t.session.weightRig?.id).toBe(firstRig.id); expect(t.session.pointRef).toBeUndefined();
        expect(t.session.pointEntries.every(point => point.pathId === t.path.id)).toBeTrue();
        t.session.toggle(secondRig.id, secondRig.bones[0].id);
        expect(t.session.weightRig?.id).toBe(secondRig.id); expect(t.session.pointEntries.every(point => point.pathId === t.other.id)).toBeTrue();
        t.session.setScopeMode('artwork'); expect(t.session.target?.id).toBe(t.path.id); expect(t.rigs.activeId).toBe(firstRig.id);
        expect(t.svg.save()).toEqual(before);
    });

    it('deduplicates inherited handles and shared point groups in additive selection', () => {
        const t = setup(); t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]); t.session.openWeights();
        const first = { pathId: t.path.id, pointId: t.path.lines[0].points[0].id }, handle = { pathId: t.path.id, pointId: t.path.lines[0].controlStart!.id };
        t.session.selectPoints([first, handle]); expect(t.session.selectedCount).toBe(1); expect(t.session.isSelected(first)).toBeTrue(); expect(t.session.isSelected(handle)).toBeTrue();
        t.session.selectPoint(handle, true); expect(t.session.selectedCount).toBe(0);
        t.session.selectAll(); expect(t.session.selectedCount).toBe(2);
        t.session.clearSelection(); expect(t.session.selectedCount).toBe(0); expect(t.session.pointRef).toBeUndefined();
    });

    it('previews sliders without writes, commits once, and restores values on Escape', () => {
        const t = setup(); t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]); t.session.openWeights(); t.session.selectAll();
        TestBed.configureTestingModule({ imports: [RigWeightsPanelComponent], providers: [{ provide: RigBindingSessionService, useValue: t.session }] });
        const fixture = TestBed.createComponent(RigWeightsPanelComponent); fixture.detectChanges();
        const slider = fixture.nativeElement.querySelector('[aria-label="' + t.child.name + ' weight slider"]') as HTMLInputElement;
        const before = t.svg.save(), saves = t.projects.upsert.calls.count(); slider.value = '25'; slider.dispatchEvent(new Event('input')); fixture.detectChanges();
        expect(t.session.weightValue(t.child.id)).toBe(25); expect(t.svg.save()).toEqual(before); expect(t.session.previewUpdates.length).toBe(2);
        slider.value = '60'; slider.dispatchEvent(new Event('input')); slider.dispatchEvent(new Event('change')); fixture.detectChanges();
        expect(t.projects.upsert.calls.count()).toBe(saves + 1); expect(t.session.weightValue(t.child.id)).toBe(60); expect(t.session.previewKind).toBeUndefined();
        const committed = t.svg.save(); slider.value = '10'; slider.dispatchEvent(new Event('input'));
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); slider.dispatchEvent(new Event('change')); fixture.detectChanges();
        expect(t.svg.save()).toEqual(committed); expect(t.session.weightValue(t.child.id)).toBe(60); expect(t.projects.upsert.calls.count()).toBe(saves + 1); fixture.destroy();
    });

    it('shows mixed values, edits unlocked owners, and preserves locked values', () => {
        const t = setup(); t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]); t.session.openWeights();
        const first = { pathId: t.path.id, pointId: t.path.lines[0].points[0].id }, second = { pathId: t.path.id, pointId: t.path.lines[0].points[1].id };
        t.rigs.setPointWeight(first, t.child.id, .2); t.rigs.setPointWeight(second, t.child.id, .8); t.rigs.setWeightLocks([first], t.child.id, true);
        t.session.selectAll(); expect(t.session.weightValue(t.child.id)).toBeUndefined(); expect(t.session.lockState(t.child.id)).toBe('mixed');
        t.session.setSelectedWeight(t.child.id, .6);
        expect(t.session.pointWeights(first).find(weight => weight.boneId === t.child.id)?.weight).toBe(.2);
        expect(t.session.pointWeights(second).find(weight => weight.boneId === t.child.id)?.weight).toBe(.6);
        const before = t.svg.save(); t.session.clearWeights(); expect(t.svg.save()).toEqual(before); expect(t.rigs.message).toContain('Unlock');
        t.session.setLock(t.child.id); expect(t.session.lockState(t.child.id)).toBe('locked'); t.session.setLock(t.child.id); expect(t.session.lockState(t.child.id)).toBe('unlocked');
        t.session.clearWeights(); expect(t.session.selectedRefs.every(ref => t.session.pointWeights(ref).length === 0)).toBeTrue();
    });

    it('previews auto weights for selection or whole scope without implicit writes', () => {
        const t = setup(); t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]); t.session.openWeights(); const before = t.svg.save();
        t.session.previewAutoWeights(); expect(t.session.previewKind).toBe('auto'); expect(t.session.previewUpdates.length).toBe(2); expect(t.svg.save()).toEqual(before);
        t.session.cancelPreview(); expect(t.svg.save()).toEqual(before);
        t.session.selectPoint(t.path.id, t.path.lines[0].points[0].id); t.session.previewAutoWeights(); expect(t.session.previewUpdates.length).toBe(1);
        t.session.applyPreview(); expect(t.session.previewKind).toBeUndefined(); expect(validRigs(t.svg.rigs)).toBeTrue();
    });

    it('cancels drafts on selection, revision and artwork changes and blocks stale field blur', () => {
        const t = setup(); t.rigs.setBindingInfluences(t.path.id, [t.root.id, t.child.id]); t.session.openWeights(); t.session.selectAll();
        t.session.previewWeight(t.child.id, .4); t.session.selectPoint(t.path.id, t.path.lines[0].points[0].id); expect(t.session.previewKind).toBeUndefined();
        t.session.previewWeight(t.child.id, .4); t.rigs.rename('Renamed'); t.session.validate(); expect(t.session.previewKind).toBeUndefined();
        TestBed.configureTestingModule({ imports: [RigWeightsPanelComponent], providers: [{ provide: RigBindingSessionService, useValue: t.session }] });
        const fixture = TestBed.createComponent(RigWeightsPanelComponent); fixture.detectChanges();
        const input = fixture.nativeElement.querySelector('[aria-label="' + t.child.name + ' weight"]') as HTMLInputElement;
        input.dispatchEvent(new Event('focus')); input.value = '70'; input.dispatchEvent(new Event('input'));
        const before = t.svg.save(); t.editor.selectedElement = t.other; t.session.validate(); input.dispatchEvent(new Event('blur'));
        expect(t.session.target).toBe(t.other); expect(t.session.selectedCount).toBe(0); expect(t.session.previewKind).toBeUndefined(); expect(t.svg.save()).toEqual(before); fixture.destroy();
    });

    it('infers rigid assignments, allows zero-bone unbinding, and preserves legacy custom weights', () => {
        const t = setup(); t.session.openWeights(); expect(t.session.bindingLabel).toBe('Rigid'); expect(t.session.canEditWeights).toBeFalse();
        t.session.begin(); t.session.toggle(t.rigs.activeId!, t.root.id); expect(t.session.assignmentLabel).toBe('Unbound'); t.session.confirm(); expect(t.session.binding).toBeUndefined();
        t.rigs.bind(t.path, [t.root.id], true); t.session.binding!.points[0].weights = []; t.mutations.commit('metadata');
        expect(t.session.bindingLabel).toBe('Custom weights'); expect(t.session.canEditWeights).toBeTrue();
    });
});
