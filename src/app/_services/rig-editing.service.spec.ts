import { IKTargetComponent } from '../_components/rig-editor/ik-target.component';
import { RigLayersComponent } from '../_components/rig-editor/rig-layers.component';
import attachmentFixture from '../editor/migrations/fixtures/document-v11-attachments.json';
import { RigBindingSessionService } from './rig-binding-session.service';
import { BoneDrawingService } from './bone-drawing.service';
import { BoneTool } from './tools/bone.tool';
import { Shape } from '../editor/objects/elements/shape.object';
import { attachmentMatrix } from '../editor/rig-attachments';
import { ownMatrix } from '../editor/objects/element-bounds';
import { ElementRef, NgZone } from '@angular/core';
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
import { applyMatrix } from '../editor/objects/transform.object';
import { boneMatrices, normalizeWeights, validRigs } from '../editor/objects/armature';
import { combinedMotionAdjustedMatrixFor } from '../editor/objects/motion-path.object';
import { createDocumentEnvelope, migrateDocument } from '../editor/migrations/document-migrations';
import { buildSVGMarkup } from '../editor/svg-markup';
import { RigOverlayComponent } from '../_components/rig-editor/rig-overlay.component';
import { RigWeightOverlayComponent } from '../_components/rig-editor/rig-weight-overlay.component';
import { RigPanelComponent } from '../_components/rig-editor/rig-panel.component';
import { PropertiesPanelComponent } from '../_components/properties-panel/properties-panel.component';
import { PaintEditingService } from './paint-editing.service';
import { TestBed } from '@angular/core/testing';
import rigFixture from '../editor/migrations/fixtures/document-v10-rig.json';
import { evaluateRigConstraints } from '../editor/rig-constraints';
import { editableRestRig } from '../editor/rig-rest-edit';

describe('armature editing and weighted FK', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
    function setup(nested = false) {
        const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
        const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0, 0) });
        const path = new Path(editor);
        path.lines = [new Line(editor, { type: 'bezier', points: [new Point(100, 100), new Point(140, 100)], controlStart: new Point(110, 90), controlEnd: new Point(130, 90) })];
        const group = new Group(editor); group.elements = [path];
        if(nested) { group.transform.scaleX = -2; group.transform.scaleY = .7; group.transform.rotation = 25; path.transform.rotation = 30; path.transform.originX = 90; path.transform.originY = 110; }
        svg.elements = nested ? [group] : [path]; editor.selectedSVG = svg; editor.selectedElement = path; svg.snapshot();
        const playback = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences);
        playback.mode = 'edit';
        const projects = { upsert: jasmine.createSpy('upsert') };
        const mutations = new DocumentMutationService(editor, playback, new HistoryService(), projects as never); mutations.resetBaseline();
        const rigs = new RigEditingService(editor, playback, mutations);
        cleanups.push(() => { playback.ngOnDestroy(); mutations.ngOnDestroy(); });
        rigs.create(); return { editor, svg, path, group, playback, projects, mutations, rigs };
    }
    it('creates one undoable armature and evaluates parent-local FK with independent roots', () => {
        const t = setup(); expect(t.projects.upsert).toHaveBeenCalledTimes(1);
        const root = t.rigs.bone!; t.rigs.addBone(true); t.rigs.editBone({ x: 40 }); const child = t.rigs.bone!;
        t.rigs.setPose(90, root.id); const matrix = boneMatrices(t.rigs.active!).get(child.id)!;
        const joint = applyMatrix(matrix, 0, 0); expect(joint.x).toBeCloseTo(100); expect(joint.y).toBeCloseTo(140);
        t.rigs.setPose(90, child.id); const end = applyMatrix(boneMatrices(t.rigs.active!).get(child.id)!, child.length, 0);
        expect(end.x).toBeCloseTo(60); expect(end.y).toBeCloseTo(140);
        t.rigs.create(); expect(t.rigs.armatures.length).toBe(2); expect(t.rigs.bone!.pose).toBe(0);
        t.mutations.undo(); expect(t.rigs.armatures.length).toBe(1); t.mutations.redo(); expect(t.rigs.armatures.length).toBe(2);
    });
    it('deforms anchors and inherited handles from rest, round-trips, exports and resets without drift', () => {
        const t = setup(); const original = t.path.pathPoints().map(point => ({ id: point.id, x: point.x, y: point.y }));
        t.rigs.bind(); t.rigs.setPose(90);
        expect(t.path.lines[0].points[1].x).toBeCloseTo(100); expect(t.path.lines[0].points[1].y).toBeCloseTo(140);
        expect(t.path.lines[0].controlStart!.x).toBeCloseTo(110); expect(t.path.lines[0].controlStart!.y).toBeCloseTo(110);
        expect(t.rigs.problem).toBeUndefined(); expect(validRigs(t.svg.rigs)).toBeTrue();
        const save = t.svg.save(), imported = migrateDocument(createDocumentEnvelope(save)); expect(imported.status).toBe('ok');
        const restored = SVG.fromSave(JSON.parse(JSON.stringify(save)), t.editor);
        expect(restored.rigs).toEqual(t.svg.rigs); expect(buildSVGMarkup(restored)).toBe(buildSVGMarkup(t.svg));
        t.editor.selectedSVG = restored; t.editor.selectedElement = restored.elements[0]; t.mutations.resetBaseline();
        expect(t.rigs.problem).toBeUndefined();
        for(let i = 0; i < 5; i++) { t.rigs.setPose(-45); t.rigs.setPose(120); }
        t.rigs.resetPose();
        const points = (restored.elements[0] as Path).pathPoints(); original.forEach((point, index) => { expect(points[index].x).toBeCloseTo(point.x); expect(points[index].y).toBeCloseTo(point.y); });
    });
    it('uses canvas-space skinning under reflected, nonuniform nested transforms and fixed pivots', () => {
        const t = setup(true), before = combinedMotionAdjustedMatrixFor(t.svg, t.path), point = t.path.lines[0].points[1];
        const world = applyMatrix(before, point.x, point.y); t.rigs.bind(); t.rigs.setPose(90);
        const after = combinedMotionAdjustedMatrixFor(t.svg, t.path), actual = applyMatrix(after, point.x, point.y);
        expect(after).toEqual(before); expect(actual.x).toBeCloseTo(100 - (world.y - 100)); expect(actual.y).toBeCloseTo(100 + (world.x - 100));
        expect(t.rigs.problem).toBeUndefined(); t.rigs.resetPose(); expect(point.x).toBeCloseTo(140); expect(point.y).toBeCloseTo(100);
    });
    it('normalizes blended weights and leaves zero-weight anchors at rest', () => {
        const t = setup(), root = t.rigs.bone!; t.rigs.addBone(true); t.rigs.editBone({ x: 40 }); const child = t.rigs.bone!;
        t.rigs.boneId = root.id; t.rigs.bind(); const anchor = t.path.lines[0].points[0];
        t.rigs.setWeight(anchor.id, child.id, .25);
        expect(t.rigs.binding!.points[0].weights).toEqual([{ boneId: root.id, weight: .75 }, { boneId: child.id, weight: .25 }]);
        t.rigs.setPose(90, child.id); expect(anchor.x).toBeCloseTo(110); expect(anchor.y).toBeCloseTo(90);
        t.rigs.setWeight(anchor.id, child.id, 0); expect(anchor.x).toBeCloseTo(100); expect(anchor.y).toBeCloseTo(100);
        t.rigs.clearPointWeights([{pathId:t.path.id,pointId:anchor.id}]); t.rigs.setPose(90, root.id); expect(anchor.x).toBeCloseTo(100); expect(anchor.y).toBeCloseTo(100);
        expect(normalizeWeights([{ boneId: 'a', weight: 2 }, { boneId: 'a', weight: 1 }, { boneId: 'b', weight: 3 }])).toEqual([{ boneId: 'a', weight: .5 }, { boneId: 'b', weight: .5 }]);
    });
    it('commits pose plus geometry once and restores binding and pose through undo/redo', () => {
        const t = setup(); t.rigs.bind(); const before = t.svg.save(), saves = t.projects.upsert.calls.count();
        t.rigs.setPose(45); const after = t.svg.save(); expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        t.rigs.setPose(45); expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        t.mutations.undo(); expect(t.svg.save()).toEqual(before); t.mutations.redo(); expect(t.svg.save()).toEqual(after);
        expect(t.rigs.problem).toBeUndefined(); t.rigs.unbind(t.path.id); expect(t.rigs.active!.bindings).toEqual([]);
        const geometry = t.svg.save().elements; t.rigs.resetPose(); expect(t.svg.save().elements).toEqual(geometry);
    });
    it('rejects cycles, invalid point lengths, duplicate bindings, and stale geometry without history', () => {
        const t = setup(), root = t.rigs.bone!; t.rigs.addBone(true); const child = t.rigs.bone!;
        t.rigs.boneId = root.id; const before = t.mutations.captureState(); t.rigs.editBone({ parentId: child.id }); expect(t.mutations.captureState()).toBe(before);
        t.rigs.bind(); const bound = t.mutations.captureState(); t.rigs.editBone({ length: 100 }); t.rigs.bind(); expect(t.mutations.captureState()).toBe(bound);
        t.path.lines[0].points[0].x++; t.mutations.commit(); const edited = t.mutations.captureState(); t.rigs.setPose(30); expect(t.mutations.captureState()).toBe(edited); expect(t.rigs.problem).toContain('edited');
        t.mutations.undo(); t.rigs.setPose(30); expect(t.rigs.bone!.pose).toBe(30);
    });
    it('rejects removed points, locked ancestors and singular binding transforms', () => {
        const t = setup(true); t.group.transform.scaleX = 0; t.mutations.commit(); t.rigs.bind(); expect(t.rigs.binding).toBeUndefined();
        t.group.transform.scaleX = -2; t.mutations.commit(); t.rigs.bind(); t.group.locked = true; t.mutations.commit();
        t.rigs.setPose(30); expect(t.rigs.bone!.pose).toBe(0); t.group.locked = false; t.path.lines[0].controlEnd = undefined; t.mutations.commit();
        t.rigs.setPose(30); expect(t.rigs.problem).toContain('topology'); expect(t.rigs.bone!.pose).toBe(0);
    });
    it('rejects malformed or future rig schemas and upgrades v9 without changing artwork', () => {
        const t = setup(); t.rigs.bind(); const save = t.svg.save();
        expect(migrateDocument({ kind: 'svg-animator/document', version: 9, data: save }).status).toBe('ok');
        const invalid = structuredClone(save); invalid.rigs!.armatures[0].bones[0].parentId = invalid.rigs!.armatures[0].bones[0].id;
        expect(migrateDocument(createDocumentEnvelope(invalid)).status).toBe('invalid');
        const future = { ...save, rigs: { version: 6, armatures: [] } }; expect(migrateDocument(future).status).toBe('unsupported');
        const attached = migrateDocument(attachmentFixture); expect(attached.status).toBe('ok');
        if(attached.status === 'ok') { t.editor.selectedSVG = SVG.fromSave(attached.value.data,t.editor); t.rigs.select('rig'); expect(t.rigs.problem).toBeUndefined(); }
        const fixture = migrateDocument(rigFixture); expect(fixture.status).toBe('ok');
        if(fixture.status === 'ok') {
            t.editor.selectedSVG = SVG.fromSave(fixture.value.data, t.editor); t.rigs.select('rig');
            expect(t.rigs.problem).toBeUndefined();
            expect(migrateDocument(fixture.value)).toEqual({ status: 'ok', value: fixture.value, migrated: false, warnings: [] });
        }
    });
    it('commits numeric fields on Enter/blur, restores rejected values, and cancels Escape', () => {
        const t = setup(); t.rigs.workspace = 'pose';
        TestBed.configureTestingModule({ imports: [RigPanelComponent], providers: [{ provide: RigEditingService, useValue: t.rigs }, { provide: RigBindingSessionService, useValue: new RigBindingSessionService(t.rigs, t.mutations) }] });
        const fixture = TestBed.createComponent(RigPanelComponent); fixture.detectChanges();
        const input = fixture.nativeElement.querySelector('[aria-label="FK rotation"]') as HTMLInputElement;
        input.value = '35'; input.dispatchEvent(new Event('blur')); fixture.detectChanges(); expect(t.rigs.bone!.pose).toBe(35);
        const saves = t.projects.upsert.calls.count(); input.value = '50'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); input.dispatchEvent(new Event('blur'));
        expect(t.rigs.bone!.pose).toBe(35); expect(input.value).toBe('35'); expect(t.projects.upsert.calls.count()).toBe(saves);
        input.value = ''; input.dispatchEvent(new Event('blur')); expect(input.value).toBe('35');
        t.rigs.setPose(12.3456); fixture.detectChanges(); expect(input.value).toBe('12.35');
        const untouched = t.projects.upsert.calls.count(); input.dispatchEvent(new Event('blur'));
        expect(t.rigs.bone!.pose).toBe(12.3456); expect(t.projects.upsert.calls.count()).toBe(untouched);
        (fixture.nativeElement.querySelector('[aria-label="Hide bones on canvas"]') as HTMLButtonElement).click(); fixture.detectChanges();
        expect(t.rigs.visible).toBeFalse(); expect(fixture.nativeElement.querySelector('[aria-label="Show bones on canvas"]')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('[aria-label="FK rotation"]')).not.toBeNull(); fixture.destroy();
    });
    it('keeps pose drags temporary, cancels on history/context changes, and supports keyboard rotation', () => {
        const t = setup(); t.rigs.addBone(true); t.rigs.workspace = 'pose';
        const overlay = new RigOverlayComponent(t.rigs, t.mutations, new RigBindingSessionService(t.rigs, t.mutations), new BoneDrawingService(t.rigs, t.mutations)), element = document.createElement('div'), button = document.createElement('button');
        spyOn(element, 'getBoundingClientRect').and.returnValue({ left: 0, top: 0, width: 200, height: 200 } as DOMRect);
        spyOn(button, 'setPointerCapture'); spyOn(button, 'hasPointerCapture').and.returnValue(false);
        overlay.artwork = element as unknown as SVGElement; overlay.workspace = { element } as never;
        const event = (x: number, y: number) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: button, preventDefault() {}, stopPropagation() {} }) as unknown as PointerEvent;
        const id = t.rigs.boneId!;
        overlay.begin(event(140, 100), id); overlay.move(event(100, 140)); expect(t.rigs.bone!.pose).toBe(0);
        overlay.cancel(); overlay.end(event(100, 140)); expect(t.rigs.bone!.pose).toBe(0);
        overlay.begin(event(140, 100), id); overlay.end(event(100, 140)); expect(t.rigs.bone!.pose).toBe(90);
        overlay.key(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }), id); expect(t.rigs.bone!.pose).toBe(80);
        overlay.begin(event(100, 140), id); t.rigs.workspace = 'rest'; overlay.ngDoCheck(); overlay.end(event(140, 100)); expect(t.rigs.bone!.pose).toBe(80);
        overlay.ngOnDestroy();
    });
    it('deforms bound artwork live during pose drags, restores on cancel and commits once', () => {
        const t = setup(); t.rigs.addBone(true); const id = t.rigs.boneId!; t.rigs.bind(); t.rigs.workspace = 'pose';
        const overlay = new RigOverlayComponent(t.rigs, t.mutations, new RigBindingSessionService(t.rigs, t.mutations), new BoneDrawingService(t.rigs, t.mutations)), element = document.createElement('div'), button = document.createElement('button');
        spyOn(element, 'getBoundingClientRect').and.returnValue({ left: 0, top: 0, width: 200, height: 200 } as DOMRect);
        spyOn(button, 'setPointerCapture'); spyOn(button, 'hasPointerCapture').and.returnValue(false);
        overlay.artwork = element as unknown as SVGElement; overlay.workspace = { element } as never;
        const event = (x: number, y: number) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: button, preventDefault() {}, stopPropagation() {} }) as unknown as PointerEvent;
        const end = t.path.lines[0].points[1], before = t.svg.save(), saves = t.projects.upsert.calls.count(), revision = t.mutations.revision;
        overlay.begin(event(140, 100), id); overlay.move(event(100, 140));
        expect(end.x).toBeCloseTo(100); expect(end.y).toBeCloseTo(140); expect(t.rigs.bone!.pose).toBe(0);
        expect(t.rigs.posePreview).toBeDefined(); expect(t.rigs.problem).toBeUndefined(); expect(overlay.bones.find(bone => bone.id === id)!.end.y).toBeCloseTo(140);
        const panel = new RigPanelComponent(t.rigs, new RigBindingSessionService(t.rigs, t.mutations)); expect(panel.livePose).toBe(90);
        expect(t.projects.upsert.calls.count()).toBe(saves); expect(t.mutations.revision).toBe(revision);
        overlay.move(event(141, 100)); expect(t.svg.save()).toEqual(before);
        overlay.move(event(100, 140)); overlay.key(new KeyboardEvent('keydown', { key: 'Escape' }), id);
        expect(t.rigs.posePreview).toBeUndefined(); expect(t.svg.save()).toEqual(before); expect(panel.livePose).toBe(0);
        overlay.begin(event(140, 100), id); overlay.move(event(100, 140)); const preview = t.svg.save().elements; overlay.end(event(100, 140));
        expect(t.rigs.bone!.pose).toBe(90); expect(t.projects.upsert.calls.count()).toBe(saves + 1); expect(t.svg.save().elements).toEqual(preview); expect(t.rigs.problem).toBeUndefined();
        t.mutations.undo(); expect(t.svg.save()).toEqual(before);
        overlay.ngOnDestroy();
    });
    it('lets only the open Weights workspace replace artwork properties', () => {
        const t = setup(); t.rigs.addBone(true); t.rigs.bind();
        TestBed.configureTestingModule({ imports: [PropertiesPanelComponent], providers: [
            { provide: RigEditingService, useValue: t.rigs }, { provide: RigBindingSessionService, useValue: new RigBindingSessionService(t.rigs, t.mutations) },
            { provide: EditorService, useValue: t.editor }, { provide: AnimationPlaybackService, useValue: t.playback }, { provide: DocumentMutationService, useValue: t.mutations },
            { provide: PaintEditingService, useValue: { apply: () => true } }] });
        const fixture = TestBed.createComponent(PropertiesPanelComponent), host = fixture.nativeElement as HTMLElement;
        t.rigs.workspace = 'pose'; fixture.detectChanges(); expect(t.rigs.ownsInspector).toBeFalse(); expect(host.querySelector('.panel-header')).toBeTruthy();
        t.rigs.workspace = 'weights'; fixture.detectChanges(); expect(t.rigs.ownsInspector).toBeTrue();
        expect(host.querySelector('.panel-header')).toBeNull(); expect(host.querySelector('[aria-label="Point weights"]')).toBeTruthy();
        t.rigs.visible = false; fixture.detectChanges(); expect(host.querySelector('.panel-header')).toBeTruthy();
        fixture.destroy();
    });
    it('clears stale feedback only when the rig workspace changes', () => {
        const t = setup(); t.rigs.message = 'Bones assigned.'; t.rigs.workspace = 'pose'; expect(t.rigs.message).toBe('');
        t.rigs.message = 'Kept'; t.rigs.workspace = 'pose'; expect(t.rigs.message).toBe('Kept');
    });
    it('draws a chain with a named point root in one transaction and keeps the last bone selected', () => {
        const t = setup(); t.rigs.activeId = undefined;
        const saves = t.projects.upsert.calls.count();
        expect(t.rigs.drawBone(new Point(20,30), new Point(60,30), 'bone')).toBeTrue();
        const rig = t.rigs.active!, root = rig.bones[0], first = t.rigs.bone!;
        expect(root.kind).toBe('point'); expect(root.length).toBe(0); expect(root.name).toBe(rig.name);
        expect(first.parentId).toBe(root.id); expect(first.length).toBeCloseTo(40);
        expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        t.rigs.drawBone({x:60,y:30}, {x:60,y:80}, 'bone');
        expect(t.rigs.bone!.parentId).toBe(first.id); expect(t.rigs.bone!.x).toBeCloseTo(40); expect(t.rigs.bone!.angle).toBeCloseTo(90);
        const parent = t.rigs.bone!.id; t.rigs.drawBone({x:60,y:80}, {x:60,y:80}, 'point');
        expect(t.rigs.bone!.kind).toBe('point'); expect(t.rigs.bone!.parentId).toBe(parent); expect(validRigs(t.svg.rigs)).toBeTrue();
        const before = t.svg.save(); t.rigs.drawBone({x:0,y:0},{x:0,y:0},'bone'); expect(t.svg.save()).toEqual(before);
    });
    it('cancels Bone tool drafts on revision changes, explicit cancellation and tool switches', () => {
        const t = setup(), drawing = new BoneDrawingService(t.rigs, t.mutations);
        const tool = t.editor.tools.find((tool): tool is BoneTool => tool instanceof BoneTool)!;
        tool.drawing = drawing; tool.restoreSelection(); spyOn(t.editor, 'toCanvasPoint').and.callFake((x: any, y?: number) => new Point(x, y!));
        const event = (x: number, y: number) => ({ button:0, clientX:x, clientY:y }) as MouseEvent;
        const before = t.svg.save(); drawing.down(event(100,100)); drawing.move(event(130,100)); drawing.cancel(); drawing.up(event(130,100)); expect(t.svg.save()).toEqual(before);
        drawing.down(event(100,100)); t.rigs.rename('Changed'); drawing.up(event(130,100)); expect(t.rigs.active!.bones.length).toBe(1);
        drawing.down(event(100,100)); t.editor.tools[0].restoreSelection(); drawing.up(event(130,100)); expect(t.rigs.active!.bones.length).toBe(1);
        tool.restoreSelection(); drawing.down(event(100,100)); drawing.up(event(130,100)); expect(t.rigs.active!.bones.length).toBe(2);
    });
    it('picks influences artwork-first without a save until Apply and starts with equal normalized weights', () => {
        const t = setup(), root = t.rigs.bone!; t.rigs.addBone(true); const child = t.rigs.bone!;
        const session = new RigBindingSessionService(t.rigs, t.mutations), before = t.svg.save(), saves = t.projects.upsert.calls.count();
        session.begin('weighted'); session.toggle(t.rigs.activeId!, root.id); session.toggle(t.rigs.activeId!, child.id);
        expect(t.projects.upsert.calls.count()).toBe(saves); expect(t.editor.selectedElement).toBe(t.path);
        session.cancel(); expect(t.svg.save()).toEqual(before);
        session.begin('weighted'); session.toggle(t.rigs.activeId!, root.id); session.toggle(t.rigs.activeId!, child.id); session.confirm();
        expect(session.pending).toBeUndefined(); expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        expect(t.rigs.binding!.boneIds).toEqual([root.id, child.id]);
        expect(t.rigs.binding!.points[0].weights).toEqual([{boneId:root.id,weight:.5},{boneId:child.id,weight:.5}]);
        expect(t.svg.elements.map(element => element.id)).toEqual(before.elements.map(element => element.id));
    });
    it('rigidly attaches shapes and groups without changing hierarchy, draw order or clipping', () => {
        const t = setup(true), shape = new Shape(t.editor, { type:'rectangle',position:new Point(30,40),width:20,height:10 });
        t.svg.elements.unshift(shape); t.svg.snapshot(); t.mutations.resetBaseline();
        const order = t.svg.elements.map(element => element.id), children = t.group.elements.map(element => element.id);
        expect(t.rigs.attach(t.group, t.rigs.boneId!)).toBeTrue();
        const before = t.svg.save(), saves = t.projects.upsert.calls.count(); t.rigs.setPose(45);
        expect(t.projects.upsert.calls.count()).toBe(saves + 1); expect(t.rigs.problem).toBeUndefined();
        const expected = attachmentMatrix(t.rigs.active!,t.rigs.active!.attachments![0]), actual = ownMatrix(t.group);
        expect(actual.a).toBeCloseTo(expected.a); expect(actual.e).toBeCloseTo(expected.e);
        expect(t.svg.elements.map(element => element.id)).toEqual(order); expect(t.group.elements.map(element => element.id)).toEqual(children);
        const markup = buildSVGMarkup(t.svg); expect(markup.indexOf('id="' + shape.id + '"')).toBeLessThan(markup.indexOf('id="' + t.group.id + '"'));
        const after = t.svg.save(); t.mutations.undo(); expect(t.svg.save()).toEqual(before); t.mutations.redo(); expect(t.svg.save()).toEqual(after);
        t.rigs.detach(t.group.id); const detached = t.svg.save().elements; t.rigs.resetPose(); expect(t.svg.save().elements).toEqual(detached);
        expect(t.rigs.attach(t.svg.elements[0], t.rigs.boneId!)).toBeTrue(); t.rigs.setPose(90); expect(t.rigs.problem).toBeUndefined();
        const restored = SVG.fromSave(JSON.parse(JSON.stringify(t.svg.save())),t.editor); expect(buildSVGMarkup(restored)).toBe(buildSVGMarkup(t.svg));
    });
    it('prevents double transforms from overlapping rigid/weighted links and rejects unrepresentable shear atomically', () => {
        const t = setup(true); expect(t.rigs.attach(t.path,t.rigs.boneId!)).toBeTrue();
        const before = t.svg.save(); t.rigs.setPose(45); expect(t.svg.save()).toEqual(before); expect(t.rigs.message).toContain('skew');
        t.rigs.bind(); expect(t.rigs.binding).toBeUndefined(); expect(t.rigs.attach(t.group,t.rigs.boneId!)).toBeFalse();
        t.rigs.detach(t.path.id); t.rigs.bind(); expect(t.rigs.attach(t.group,t.rigs.boneId!)).toBeFalse();
    });

    it('creates a new armature from Animate and returns to Select/Edit for root positioning', () => {
        const t = setup(); t.playback.setMode('animate'); t.rigs.create();
        expect(t.playback.mode).toBe('edit'); expect(t.rigs.armatures.length).toBe(2);
        expect(t.rigs.workspace).toBe('rest'); expect(t.rigs.bone!.id).toBe(t.rigs.active!.id);
    });
    it('edits a bound rest setup without moving artwork or changing weights, then poses from the new joint', () => {
        const t = setup(); t.rigs.bind(); const artwork = t.svg.save().elements, weights = structuredClone(t.rigs.binding!.points.map(p => p.weights));
        const before = t.svg.save(), count = t.projects.upsert.calls.count(); t.rigs.editBone({x:120,y:90});
        expect(t.svg.save().elements).toEqual(artwork); expect(t.rigs.binding!.points.map(p => p.weights)).toEqual(weights);
        expect(t.projects.upsert.calls.count()).toBe(count+1); expect(t.rigs.problem).toBeUndefined();
        const edited = t.svg.save(); t.mutations.undo(); expect(t.svg.save()).toEqual(before); t.mutations.redo(); expect(t.svg.save()).toEqual(edited);
        t.rigs.setPose(90); const path = t.svg.elements[0] as Path;
        expect(path.lines[0].points[1].x).toBeCloseTo(110); expect(path.lines[0].points[1].y).toBeCloseTo(110);
    });
    it('moves posed roots and rebases mixed weighted/rigid links without changing current artwork', () => {
        const t = setup(), shape = new Shape(t.editor,{type:'rectangle',position:new Point(20,30),width:20,height:10});
        t.svg.elements.push(shape); t.mutations.commit(); t.rigs.bind(); t.rigs.attach(shape,t.rigs.boneId!);
        t.rigs.setPosePosition(30,-10); expect(t.path.lines[0].points[0].x).toBeCloseTo(130); expect(t.rigs.problem).toBeUndefined();
        const translated = t.svg.save(); expect(SVG.fromSave(JSON.parse(JSON.stringify(translated)),t.editor).rigs).toEqual(t.svg.rigs);
        const invalid = structuredClone(t.svg.rigs); invalid.armatures[0].bones[0].poseX = Infinity; expect(validRigs(invalid)).toBeFalse();
        t.rigs.setPose(35); const posed = t.svg.save().elements, weights = structuredClone(t.rigs.binding!.points.map(p => p.weights));
        t.rigs.editBone({x:150,y:110}); expect(t.svg.save().elements).toEqual(posed);
        expect(t.rigs.bone!.pose).toBe(0); expect(t.rigs.binding!.points.map(p=>p.weights)).toEqual(weights); expect(t.rigs.problem).toBeUndefined();
        t.rigs.setPose(70); t.rigs.resetPose(); expect(buildSVGMarkup(t.svg)).toBe(buildSVGMarkup(SVG.fromSave({...t.svg.save(),elements:posed},t.editor)));
        expect(validRigs(t.svg.rigs)).toBeTrue(); const saved = JSON.parse(JSON.stringify(t.svg.save())); expect(SVG.fromSave(saved,t.editor).rigs).toEqual(t.svg.rigs);
    });
    it('drags Edit roots temporarily, commits once, cancels and nudges with the keyboard', () => {
        const t = setup(); t.rigs.bind(); t.rigs.workspace = 'rest';
        const overlay = new RigOverlayComponent(t.rigs,t.mutations,new RigBindingSessionService(t.rigs,t.mutations),new BoneDrawingService(t.rigs,t.mutations));
        const element = document.createElement('div'), button = document.createElement('button');
        spyOn(element,'getBoundingClientRect').and.returnValue({left:0,top:0,width:200,height:200} as DOMRect);
        spyOn(button,'setPointerCapture'); spyOn(button,'hasPointerCapture').and.returnValue(false);
        overlay.artwork = element as unknown as SVGElement; overlay.workspace = {element} as never;
        const event = (x:number,y:number) => ({button:0,pointerId:1,clientX:x,clientY:y,currentTarget:button,preventDefault(){},stopPropagation(){}}) as unknown as PointerEvent;
        const id = t.rigs.boneId!, before = t.svg.save(), saves = t.projects.upsert.calls.count();
        overlay.begin(event(100,100),id,'body'); overlay.move(event(130,120)); expect(t.svg.save()).toEqual(before);
        overlay.cancel(); overlay.end(event(130,120)); expect(t.svg.save()).toEqual(before);
        overlay.begin(event(100,100),id,'body'); overlay.end(event(130,120)); expect(t.rigs.bone!.x).toBeCloseTo(130); expect(t.rigs.bone!.y).toBeCloseTo(120);
        expect(t.projects.upsert.calls.count()).toBe(saves+1); expect(t.svg.save().elements).toEqual(before.elements);
        overlay.key(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true}),id); expect(t.rigs.bone!.x).toBeCloseTo(120);
        overlay.begin(event(120,120),id,'body'); t.rigs.workspace='pose'; overlay.ngDoCheck(); overlay.end(event(160,160)); expect(t.rigs.bone!.x).toBeCloseTo(120);
        overlay.ngOnDestroy();
    });

    it('keeps connected child joints on a resized tip while retaining free child offsets', () => {
        const t = setup(); t.rigs.addBone(true); const parent = t.rigs.bone!;
        t.rigs.addBone(true); const connected = t.rigs.bone!;
        t.rigs.boneId = parent.id; t.rigs.addBone(true); const free = t.rigs.bone!; t.rigs.editBone({x:15,y:10});
        t.rigs.boneId = parent.id; t.rigs.editBone({length:80,angle:35});
        expect(connected.x).toBe(80); expect(free.x).toBe(15); expect(free.y).toBe(10);
    });

    it('renames bones as metadata without rebasing a pose and keeps root names synchronized', () => {
        const t = setup(); t.rigs.bind(); t.rigs.setPose(25); const art = t.svg.save().elements;
        t.rigs.renameBone('Character'); expect(t.rigs.active!.name).toBe('Character'); expect(t.rigs.bone!.name).toBe('Character');
        expect(t.rigs.bone!.pose).toBe(25); expect(t.svg.save().elements).toEqual(art);
        const saves=t.projects.upsert.calls.count(); t.rigs.renameBone(' Character '); t.rigs.renameBone(' '); expect(t.projects.upsert.calls.count()).toBe(saves);
    });
    it('reparents from Layers without changing bone canvas positions, weights or draw order', () => {
        const t = setup(); const root=t.rigs.bone!; t.rigs.addBone(true); const first=t.rigs.bone!;
        t.rigs.editBone({x:30,angle:40}); t.rigs.addBone(true); const child=t.rigs.bone!;
        t.rigs.bind(); t.rigs.setPose(20,root.id); t.rigs.setPose(15,first.id);
        const world=boneMatrices(t.rigs.active!).get(child.id)!, before=t.svg.save(), weights=structuredClone(t.rigs.binding!.points.map(p=>p.weights));
        t.rigs.reparentBone(root.id); const after=boneMatrices(t.rigs.active!).get(child.id)!;
        for(const key of ['a','b','c','d','e','f'] as const) expect(after[key]).toBeCloseTo(world[key]);
        expect(child.parentId).toBe(root.id); expect(t.svg.save().elements).toEqual(before.elements); expect(t.rigs.binding!.points.map(p=>p.weights)).toEqual(weights);
        expect(t.rigs.problem).toBeUndefined(); t.mutations.undo(); expect(t.svg.save()).toEqual(before);
        t.rigs.boneId=first.id; expect(t.rigs.canReparent(child.id)).toBeFalse();
        t.rigs.boneId=root.id; expect(t.rigs.canReparent(first.id)).toBeFalse();
    });
    it('renames inline with Enter/blur, cancels Escape, and keeps creation out of row menus', () => {
        const t=setup(); const session=new RigBindingSessionService(t.rigs,t.mutations);
        TestBed.configureTestingModule({imports:[RigLayersComponent],providers:[{provide:RigEditingService,useValue:t.rigs},{provide:RigBindingSessionService,useValue:session},{provide:DocumentMutationService,useValue:t.mutations}]});
        const fixture=TestBed.createComponent(RigLayersComponent); fixture.detectChanges();
        const component=fixture.componentInstance, row=component.rows[0], saves=t.projects.upsert.calls.count();
        component.beginRename(row); fixture.detectChanges();
        let input=fixture.nativeElement.querySelector('input.rename') as HTMLInputElement;
        input.value='Cancel me'; input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); fixture.detectChanges();
        expect(t.rigs.active!.name).toBe(row.name); expect(t.projects.upsert.calls.count()).toBe(saves);
        component.beginRename(row); fixture.detectChanges(); input=fixture.nativeElement.querySelector('input.rename');
        input.value='Character'; input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); fixture.detectChanges();
        expect(t.rigs.active!.name).toBe('Character'); expect(t.projects.upsert.calls.count()).toBe(saves+1);
        const items=component.menuItems(component.rows[0]); expect(items.map(item=>item.label)).toEqual(['Rename','Delete armature']);
        component.beginRename(component.rows[0]); fixture.detectChanges(); input=fixture.nativeElement.querySelector('input.rename');
        input.value='Hero'; input.dispatchEvent(new Event('blur')); fixture.detectChanges(); expect(t.rigs.active!.name).toBe('Hero');
        component.remove(component.rows[0]); expect(t.rigs.armatures.length).toBe(0); t.mutations.undo(); expect(t.rigs.armatures.length).toBe(1);
        fixture.destroy();
    });

    it('reorders bone siblings and armatures without changing artwork or poses, and reparents in one undo step', () => {
        const t=setup(), rig=t.rigs.active!, root=t.rigs.bone!; t.rigs.addBone(true); const a=t.rigs.bone!;
        t.rigs.boneId=root.id; t.rigs.addBone(true); const b=t.rigs.bone!;
        t.rigs.bind(); t.rigs.setPose(20,a.id); const before=t.svg.save(), saves=t.projects.upsert.calls.count();
        t.rigs.moveLayerRow(rig.id,b.id,rig.id,a.id,'before');
        expect(rig.bones.filter(b=>b.parentId===root.id).map(b=>b.id)).toEqual([b.id,a.id]);
        expect(a.pose).toBe(20); expect(t.svg.save().elements).toEqual(before.elements); expect(t.projects.upsert.calls.count()).toBe(saves+1);
        t.mutations.undo(); expect(t.svg.save()).toEqual(before); t.mutations.redo();
        const world=boneMatrices(t.rigs.active!).get(b.id)!, prior=t.svg.save(), count=t.projects.upsert.calls.count();
        t.rigs.moveLayerRow(rig.id,b.id,rig.id,a.id,'inside');
        const actual=boneMatrices(t.rigs.active!).get(b.id)!; expect(actual.e).toBeCloseTo(world.e); expect(actual.f).toBeCloseTo(world.f);
        expect(t.projects.upsert.calls.count()).toBe(count+1); expect(t.svg.save().elements).toEqual(prior.elements); expect(t.rigs.problem).toBeUndefined();
        t.mutations.undo(); expect(t.svg.save()).toEqual(prior);
        t.rigs.create(); const second=t.rigs.activeId!; const art=t.svg.save().elements;
        t.rigs.moveLayerRow(second,null,rig.id,null,'before'); expect(t.rigs.armatures.map(r=>r.id)).toEqual([second,rig.id]); expect(t.svg.save().elements).toEqual(art);
    });

    it('uses click jitter for point bones and a screen-space dead zone for length bones', () => {
        const t=setup(), drawing=new BoneDrawingService(t.rigs,t.mutations), tool=t.editor.tools.find((tool):tool is BoneTool=>tool instanceof BoneTool)!;
        tool.drawing=drawing; tool.restoreSelection(); spyOn(t.editor,'toCanvasPoint').and.callFake((x:any,y?:number)=>new Point(x*2,y!*2));
        const event=(x:number,y:number)=>({button:0,clientX:x,clientY:y} as MouseEvent);
        drawing.down(event(20,20)); drawing.up(event(23,22)); expect(t.rigs.bone!.kind).toBe('point');
        const point=t.rigs.bone!; drawing.down(event(30,30)); drawing.up(event(36,30)); expect(t.rigs.bone!.kind).toBe('bone'); expect(t.rigs.bone!.length).toBeCloseTo(12);
        expect(t.rigs.bone!.parentId).toBe(point.id);
        const before=t.svg.save(); drawing.down(event(20,20)); drawing.cancel(); drawing.up(event(20,20)); expect(t.svg.save()).toEqual(before);
    });
    it('commits both IK angles and bound artwork once, with bend flip, undo and serialization', () => {
        const t=setup(); t.rigs.drawBone({x:100,y:100},{x:140,y:100},'bone'); const upper=t.rigs.bone!;
        t.rigs.drawBone({x:140,y:100},{x:170,y:100},'bone'); const lower=t.rigs.bone!;
        t.rigs.bind(); const before=t.svg.save(), count=t.projects.upsert.calls.count();
        t.rigs.setIKTarget({x:130,y:140}); expect(t.rigs.ikEndpoint!.x).toBeCloseTo(130); expect(t.rigs.ikEndpoint!.y).toBeCloseTo(140);
        expect(upper.pose).not.toBe(0); expect(lower.pose).not.toBe(0); expect(t.projects.upsert.calls.count()).toBe(count+1); expect(t.rigs.problem).toBeUndefined();
        const posed=t.svg.save(); t.mutations.undo(); expect(t.svg.save()).toEqual(before); t.mutations.redo(); expect(t.svg.save()).toEqual(posed);
        t.rigs.flipIKBend(); expect(t.rigs.ikEndpoint!.x).toBeCloseTo(130); expect(t.rigs.ikEndpoint!.y).toBeCloseTo(140); expect(t.rigs.problem).toBeUndefined();
        const restored=SVG.fromSave(JSON.parse(JSON.stringify(t.svg.save())),t.editor); expect(buildSVGMarkup(restored)).toBe(buildSVGMarkup(t.svg));
        t.rigs.resetPose(); expect(t.svg.save().elements).toEqual(before.elements);
    });
    it('keeps IK previews temporary, cancels context changes and supports keyboard target nudges', () => {
        const t=setup(); t.rigs.drawBone({x:100,y:100},{x:140,y:100},'bone'); t.rigs.drawBone({x:140,y:100},{x:170,y:100},'bone');
        t.rigs.bind(); t.rigs.workspace='pose'; t.rigs.poseMethod='ik';
        const component=new IKTargetComponent(t.rigs,t.mutations,new RigBindingSessionService(t.rigs,t.mutations));
        const element=document.createElement('div'), button=document.createElement('button');
        spyOn(element,'getBoundingClientRect').and.returnValue({left:0,top:0,width:200,height:200} as DOMRect);
        spyOn(button,'setPointerCapture'); spyOn(button,'hasPointerCapture').and.returnValue(false);
        component.artwork=element as unknown as SVGElement; component.workspace={element} as never;
        const event=(x:number,y:number)=>({button:0,pointerId:1,clientX:x,clientY:y,currentTarget:button,preventDefault(){},stopPropagation(){}} as unknown as PointerEvent);
        const before=t.svg.save(), saves=t.projects.upsert.calls.count(), revision=t.mutations.revision;
        component.begin(event(170,100)); component.move(event(130,140)); expect(t.rigs.posePreview).toBeDefined();
        expect(t.svg.save().elements).not.toEqual(before.elements); expect(t.svg.save().rigs).toEqual(before.rigs); expect(t.rigs.problem).toBeUndefined();
        expect(t.projects.upsert.calls.count()).toBe(saves); expect(t.mutations.revision).toBe(revision);
        component.key(new KeyboardEvent('keydown',{key:'Escape'})); expect(t.rigs.posePreview).toBeUndefined(); expect(t.svg.save()).toEqual(before);
        component.begin(event(170,100)); component.end(event(130,140)); expect(t.rigs.ikEndpoint!.x).toBeCloseTo(130);
        component.key(new KeyboardEvent('keydown',{key:'ArrowLeft'})); expect(t.rigs.ikEndpoint!.x).toBeCloseTo(129);
        const posed=t.svg.save(); component.begin(event(129,140)); t.rigs.workspace='rest'; component.ngDoCheck(); component.end(event(110,130)); expect(t.svg.save()).toEqual(posed);
        component.ngOnDestroy();
    });

    function constrainedLeg() {
        const t = setup(), rig = t.rigs.active!, root = t.rigs.bone!;
        rig.bones.push(
            {id:'body',name:'Body',kind:'point',parentId:root.id,x:0,y:0,angle:0,length:0,pose:0},
            {id:'upper',name:'Thigh',kind:'bone',parentId:'body',x:0,y:0,angle:0,length:40,pose:0},
            {id:'lower',name:'Shin',kind:'bone',parentId:'upper',x:40,y:0,angle:0,length:30,pose:0},
            {id:'foot',name:'Foot',kind:'point',parentId:root.id,x:60,y:10,angle:0,length:0,pose:0});
        t.mutations.commit(); t.rigs.selectBone(rig.id,'lower'); t.rigs.bind(t.path,['upper','lower'],true);
        t.rigs.workspace = 'rest'; expect(t.rigs.createIKConstraint('foot','Leg IK')).toBeTrue();
        return {...t,rootId:root.id};
    }
    it('persists a foot target and keeps it planted through body poses without overwriting authored FK', () => {
        const t = constrainedLeg(); t.rigs.workspace = 'pose';
        const constraint = t.rigs.activeIKConstraint!;
        expect(constraint.targetBoneId).toBe('foot'); expect(t.rigs.active!.bones.find(b=>b.id==='upper')!.pose).toBe(0);
        const before=t.svg.save(), count=t.projects.upsert.calls.count();
        t.rigs.setPosePosition(0,10,'body');
        expect(t.rigs.ikEndpoint!.x).toBeCloseTo(160); expect(t.rigs.ikEndpoint!.y).toBeCloseTo(110);
        expect(t.rigs.ikTargetPosition).toEqual({x:160,y:110}); expect(t.rigs.problem).toBeUndefined();
        expect(t.projects.upsert.calls.count()).toBe(count+1);
        const posed=t.svg.save(); t.mutations.undo(); expect(t.svg.save()).toEqual(before); t.mutations.redo(); expect(t.svg.save()).toEqual(posed);
        t.rigs.selectBone(t.rigs.activeId!,'foot'); expect(t.rigs.activeIKConstraint!.id).toBe(constraint.id);
        t.rigs.setIKTarget({x:150,y:125}); expect(t.rigs.ikEndpoint!.x).toBeCloseTo(150); expect(t.rigs.ikEndpoint!.y).toBeCloseTo(125);
        t.rigs.setPosePosition(10,20,t.rootId); expect(t.rigs.ikEndpoint!.x).toBeCloseTo(160); expect(t.rigs.ikEndpoint!.y).toBeCloseTo(145);
        const saved=t.svg.save(), restored=SVG.fromSave(JSON.parse(JSON.stringify(saved)),t.editor);
        expect(restored.rigs).toEqual(t.svg.rigs); expect(buildSVGMarkup(restored)).toBe(buildSVGMarkup(t.svg));
        t.editor.selectedSVG=restored; t.editor.selectedElement=restored.elements[0]; t.mutations.resetBaseline();
        expect(t.rigs.problem).toBeUndefined(); t.rigs.flipIKBend(); expect(t.rigs.activeIKConstraint!.bend).toBe(constraint.bend === 1 ? -1 : 1);
        t.rigs.resetPose(); expect(t.rigs.ikTargetPosition).toEqual({x:160,y:110}); expect(t.rigs.problem).toBeUndefined();
    });
    it('picks IK targets from bones outside the chain, including length bones, and rejects carriers', () => {
        const t = setup(), rig = t.rigs.active!, root = t.rigs.bone!;
        rig.bones.push(
            {id:'body',name:'Body',kind:'point',parentId:root.id,x:0,y:0,angle:0,length:0,pose:0},
            {id:'upper',name:'Thigh',kind:'bone',parentId:'body',x:0,y:0,angle:0,length:40,pose:0},
            {id:'lower',name:'Shin',kind:'bone',parentId:'upper',x:40,y:0,angle:0,length:30,pose:0},
            {id:'heel',name:'Foot',kind:'bone',parentId:root.id,x:70,y:0,angle:90,length:10,pose:0});
        t.mutations.commit(); t.rigs.selectBone(rig.id, 'lower');
        expect(t.rigs.ikTargetCandidates.map(bone => bone.id)).toEqual(['heel']);
        const session = new RigBindingSessionService(t.rigs, t.mutations), saves = t.projects.upsert.calls.count();
        t.rigs.beginIKTargetPick(); session.toggle(rig.id, 'body');
        expect(t.rigs.ikPick).toBeDefined(); expect(t.rigs.message).toContain('Pick a bone outside Thigh → Shin'); expect(t.projects.upsert.calls.count()).toBe(saves);
        session.toggle(rig.id, 'heel');
        expect(t.rigs.ikPick).toBeUndefined(); expect(t.rigs.boneId).toBe('lower'); expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        expect(t.rigs.active!.constraints![0]).toEqual(jasmine.objectContaining({ upperBoneId: 'upper', lowerBoneId: 'lower', targetBoneId: 'heel' }));
        t.rigs.workspace = 'pose'; expect(t.rigs.problem).toBeUndefined(); expect(t.rigs.ikEndpoint!.x).toBeCloseTo(170); expect(t.rigs.ikEndpoint!.y).toBeCloseTo(100);
        t.mutations.undo(); t.mutations.undo(); expect(t.rigs.active!.constraints ?? []).toEqual([]); t.rigs.workspace = 'rest'; t.rigs.selectBone(t.rigs.activeId!, 'lower');
        t.rigs.beginIKTargetPick(); t.rigs.workspace = 'weights'; expect(t.rigs.ikPick).toBeUndefined(); t.rigs.workspace = 'rest';
        t.rigs.beginIKTargetPick(); expect(t.rigs.pickIKTarget()).toBeTrue();
        expect(t.rigs.active!.bones.find(bone => bone.id === t.rigs.active!.constraints![0].targetBoneId)!.name).toBe('Shin target');
    });
    it('offers Reset to rest when IK keeps a reset pose bent, keeping the bones picked for artwork', () => {
        const t = constrainedLeg(); t.rigs.workspace = 'pose'; t.rigs.setIKTarget({ x: 150, y: 125 });
        const other = new Path(t.editor); other.lines = [new Line(t.editor, { type: 'line', points: [new Point(10, 10), new Point(20, 20)] })];
        t.svg.elements.push(other); t.mutations.commit();
        t.rigs.resetPose(); expect(t.rigs.atRest).toBeFalse();
        expect(t.rigs.drawBone({ x: 10, y: 10 }, { x: 30, y: 10 }, 'bone')).toBeFalse(); expect(t.rigs.restBlocked).toBeTrue();
        const session = new RigBindingSessionService(t.rigs, t.mutations); t.editor.selectedElement = other;
        session.begin(); session.toggle(t.rigs.activeId!, 'upper'); expect(session.assignmentProblem).toContain('Reset to rest');
        session.resetToRest();
        expect(t.rigs.atRest).toBeTrue(); expect(session.pending?.bones).toEqual(['upper']); expect(session.assignmentProblem).toBeUndefined();
        session.confirm(); expect(t.rigs.active!.attachments ?? []).toEqual([]); expect(t.rigs.active!.bindings.some(binding => binding.pathId === other.id)).toBeTrue();
        t.rigs.workspace = 'pose'; expect(t.rigs.workspace).toBe('pose'); expect(t.rigs.active!.constraintsActive).toBeTrue(); expect(t.rigs.problem).toBeUndefined();
    });
    it('keeps IK joints intact in Bone setup and repairs a drifted joint in one step', () => {
        const t = constrainedLeg(); t.rigs.workspace = 'rest'; t.rigs.selectBone(t.rigs.activeId!, 'lower');
        const before = t.svg.save();
        t.rigs.editBone({ x: 45 }); expect(t.rigs.message).toContain('must stay on Thigh'); expect(t.svg.save()).toEqual(before);
        // Rigs saved before this guard can already contain a drifted knee.
        const drifted = editableRestRig(t.svg, t.rigs.displayedRig!); Object.assign(drifted.bones.find(bone => bone.id === 'lower')!, { x: 43, y: 2 });
        t.mutations.mutate(() => Object.assign(t.rigs.active!, { bones: drifted.bones, bindings: drifted.bindings, constraintsActive: false }));
        t.rigs.workspace = 'pose'; expect(t.rigs.workspace).toBe('rest'); expect(t.rigs.message).toContain('Reconnect joint');
        const artwork = t.svg.save().elements, saves = t.projects.upsert.calls.count();
        expect(t.rigs.moveJoint('lower')).toBeTrue(); expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        expect(t.svg.save().elements).toEqual(artwork); expect(t.rigs.isJointConnected('lower')).toBeTrue();
        t.rigs.workspace = 'pose'; expect(t.rigs.workspace).toBe('pose'); expect(t.rigs.problem).toBeUndefined();
        t.rigs.setPose(20, 'upper'); expect(t.rigs.message).toContain('Thigh follows Leg IK. Drag Foot');
    });
    it('drags a connected bone in Bone setup as a shared joint and nudges it with the keyboard', () => {
        const t = setup(); t.rigs.addBone(true); const thigh = t.rigs.bone!; t.rigs.addBone(true); const shin = t.rigs.bone!; t.rigs.workspace = 'rest';
        const overlay = new RigOverlayComponent(t.rigs, t.mutations, new RigBindingSessionService(t.rigs, t.mutations), new BoneDrawingService(t.rigs, t.mutations));
        const element = document.createElement('div'), button = document.createElement('button');
        spyOn(element, 'getBoundingClientRect').and.returnValue({ left: 0, top: 0, width: 200, height: 200 } as DOMRect);
        spyOn(button, 'setPointerCapture'); spyOn(button, 'hasPointerCapture').and.returnValue(false);
        overlay.artwork = element as unknown as SVGElement; overlay.workspace = { element } as never;
        const event = (x: number, y: number) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: button, preventDefault() {}, stopPropagation() {} }) as unknown as PointerEvent;
        const saves = t.projects.upsert.calls.count(), point = (id: string, along: number) => applyMatrix(boneMatrices(t.rigs.active!).get(id)!, along, 0);
        overlay.begin(event(140, 100), shin.id, 'body'); overlay.move(event(140, 120));
        const draft = overlay.bones.find(bone => bone.id === thigh.id)!; expect(draft.end.x).toBeCloseTo(140); expect(draft.end.y).toBeCloseTo(120);
        expect(t.projects.upsert.calls.count()).toBe(saves);
        overlay.end(event(140, 120)); expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        expect(point(thigh.id, thigh.length).y).toBeCloseTo(120); expect(point(shin.id, shin.length).x).toBeCloseTo(180); expect(point(shin.id, shin.length).y).toBeCloseTo(100);
        expect(t.rigs.isJointConnected(shin.id)).toBeTrue();
        overlay.key(new KeyboardEvent('keydown', { key: 'ArrowUp' }), shin.id);
        expect(point(shin.id, 0).y).toBeCloseTo(119); expect(t.rigs.isJointConnected(shin.id)).toBeTrue();
        overlay.ngOnDestroy();
    });
    it('starts new bones exactly on a nearby selected tip so drawn chains connect', () => {
        const t = setup(), drawing = new BoneDrawingService(t.rigs, t.mutations), tool = t.editor.tools.find((tool): tool is BoneTool => tool instanceof BoneTool)!;
        tool.drawing = drawing; tool.restoreSelection(); spyOn(t.editor, 'toCanvasPoint').and.callFake((x: any, y?: number) => new Point(x, y!));
        t.rigs.addBone(true); const thigh = t.rigs.bone!;
        const event = (x: number, y: number) => ({ button: 0, clientX: x, clientY: y }) as MouseEvent;
        drawing.down(event(143, 102)); drawing.move(event(150, 140)); drawing.up(event(150, 140));
        expect(t.rigs.bone!.parentId).toBe(thigh.id); expect(t.rigs.isJointConnected(t.rigs.bone!.id)).toBeTrue();
        drawing.down(event(170, 120)); drawing.move(event(190, 150)); drawing.up(event(190, 150));
        expect(t.rigs.isJointConnected(t.rigs.bone!.id)).toBeFalse();
    });
    it('keeps constraint previews temporary and deletes the link without moving artwork', () => {
        const t=constrainedLeg(); t.rigs.workspace='pose'; const before=t.svg.save(), count=t.projects.upsert.calls.count();
        const preview=t.rigs.previewIK({x:145,y:130}); expect(preview).toBeDefined(); expect(t.rigs.posePreview).toBe(preview);
        expect(t.svg.save().elements).not.toEqual(before.elements); expect(t.svg.save().rigs).toEqual(before.rigs); expect(t.projects.upsert.calls.count()).toBe(count);
        const constraint=t.rigs.activeIKConstraint!;
        // Commands restore the uncommitted preview before writing.
        t.rigs.removeIKConstraint(constraint.id); expect(t.rigs.posePreview).toBeUndefined(); expect(t.rigs.active!.constraints).toEqual([]); expect(t.svg.save().elements).toEqual(before.elements);
        expect(t.rigs.problem).toBeUndefined(); t.mutations.undo(); expect(t.svg.save()).toEqual(before);
    });
    it('suspends IK for bound rest edits, preserves weights, and matches a target before returning to Pose', () => {
        const t=constrainedLeg(); t.rigs.workspace='pose'; t.rigs.setPosePosition(0,5,'body');
        const art=t.svg.save().elements, weights=structuredClone(t.rigs.binding!.points.map(p=>p.weights));
        t.rigs.workspace='rest'; t.rigs.selectBone(t.rigs.activeId!,'body'); t.rigs.editBone({x:5,y:15});
        expect(t.rigs.active!.constraintsActive).toBeFalse(); expect(t.svg.save().elements).toEqual(art);
        expect(t.rigs.binding!.points.map(p=>p.weights)).toEqual(weights); expect(t.rigs.problem).toBeUndefined();
        t.rigs.selectBone(t.rigs.activeId!,'foot'); const endpoint=t.rigs.ikEndpoint!;
        t.rigs.matchIKTarget(t.rigs.activeIKConstraint!.id); expect(t.rigs.ikTargetPosition!.x).toBeCloseTo(endpoint.x); expect(t.rigs.ikTargetPosition!.y).toBeCloseTo(endpoint.y);
        t.rigs.workspace='pose'; expect(t.rigs.active!.constraintsActive).toBeTrue(); expect(t.rigs.problem).toBeUndefined();
        expect(t.rigs.ikEndpoint!.x).toBeCloseTo(endpoint.x); expect(t.rigs.ikEndpoint!.y).toBeCloseTo(endpoint.y);
    });
    it('rejects constraint-dependent deletion, target parenting and duplicate writers atomically', () => {
        const t=constrainedLeg(); t.rigs.selectBone(t.rigs.activeId!,'foot'); const before=t.svg.save(), count=t.projects.upsert.calls.count();
        t.rigs.deleteBone(); expect(t.rigs.message).toContain('constraint'); expect(t.svg.save()).toEqual(before);
        t.rigs.reparentBone('lower'); expect(t.rigs.message).toContain('outside'); expect(t.svg.save()).toEqual(before);
        t.rigs.selectBone(t.rigs.activeId!,'lower'); expect(t.rigs.createIKConstraint('foot')).toBeFalse(); expect(t.svg.save()).toEqual(before);
        expect(t.projects.upsert.calls.count()).toBe(count);
    });
    it('allows FK when a constraint is disabled and preserves artwork during Edit constraint changes', () => {
        const t=constrainedLeg(); t.rigs.workspace='pose'; const id=t.rigs.activeIKConstraint!.id;
        t.rigs.updateIKConstraint(id,{enabled:false}); t.rigs.setPose(25,'upper');
        expect(t.rigs.active!.bones.find(bone=>bone.id==='upper')!.pose).toBe(25); expect(t.rigs.problem).toBeUndefined();
        t.rigs.updateIKConstraint(id,{enabled:true}); expect(t.rigs.ikEndpoint!.x).toBeCloseTo(160);
        const authored=t.rigs.active!.bones.map(bone=>bone.pose); t.rigs.workspace='rest';
        t.rigs.updateIKConstraint(id,{name:'Left leg'}); expect(t.rigs.active!.bones.map(bone=>bone.pose)).toEqual(authored);
        const artwork=t.svg.save().elements; t.rigs.updateIKConstraint(id,{bend:-1});
        expect(t.rigs.active!.constraintsActive).toBeFalse(); expect(t.svg.save().elements).toEqual(artwork);
        expect(t.rigs.problem).toBeUndefined();
    });
    it('creates an independent point target at the visible tip without a pose jump', () => {
        const t=setup(); t.rigs.drawBone({x:100,y:100},{x:140,y:100},'bone'); t.rigs.drawBone({x:140,y:100},{x:170,y:100},'bone');
        t.rigs.workspace='pose'; t.rigs.setIKTarget({x:130,y:140}); const tip=t.rigs.ikEndpoint!, count=t.projects.upsert.calls.count();
        expect(t.rigs.createIKConstraint('')).toBeTrue(); const constraint=t.rigs.activeIKConstraint!, target=t.rigs.active!.bones.find(b=>b.id===constraint.targetBoneId)!;
        expect(target.kind).toBe('point'); expect(target.parentId).toBe(t.rigs.activeId!);
        expect(t.rigs.ikTargetPosition!.x).toBeCloseTo(tip.x); expect(t.rigs.ikEndpoint!.y).toBeCloseTo(tip.y);
        expect(t.projects.upsert.calls.count()).toBe(count+1); expect(validRigs(t.svg.rigs)).toBeTrue();
    });
    it('edits the influence list without rebinding and weights pinned artwork through IK evaluation', () => {
        const t=constrainedLeg(); t.rigs.workspace='pose';
        const before=structuredClone(t.rigs.binding!.points), count=t.projects.upsert.calls.count();
        expect(t.rigs.setBindingInfluences(t.path.id,['upper','lower',t.rootId])).toBeTrue();
        expect(t.rigs.binding!.points).toEqual(before); expect(t.projects.upsert.calls.count()).toBe(count+1);
        t.editor.selectedElement=undefined;
        t.rigs.setWeight(before[0].id,'upper',.8,t.path.id);
        const binding=t.rigs.active!.bindings[0]; expect(binding.points[0].weights.find(w=>w.boneId==='upper')!.weight).toBeCloseTo(.8);
        expect(t.rigs.setBindingInfluences(t.path.id,['upper'])).toBeTrue();
        expect(t.rigs.active!.bindings[0].points[0].weights).toEqual([{boneId:'upper',weight:1}]);
        expect(t.rigs.problem).toBeUndefined();
        expect(evaluateRigConstraints(t.rigs.active!).bones.find(b=>b.id==='upper')!.pose).not.toBe(0);
    });
    it('projects colored anchors and inherited handles from the pinned path and tolerates stale geometry', () => {
        const t=setup(); t.rigs.bind();
        const session=new RigBindingSessionService(t.rigs,t.mutations); session.openWeights();
        const element=document.createElement('div');
        const overlay=new RigWeightOverlayComponent(t.rigs,session,t.mutations,new ElementRef(element));
        spyOn(element,'getBoundingClientRect').and.returnValue({left:0,top:0,width:200,height:200} as DOMRect);
        overlay.artwork=element as unknown as SVGElement; overlay.workspace={element} as never;
        const points=overlay.points; expect(points.length).toBe(4); expect(points.filter(point=>point.handle).length).toBe(2);
        for(const handle of points.filter(point=>point.handle)) {
            const anchor=points.find(point=>point.pointId===handle.ownerPointId)!;
            expect(handle.inherited).toBeTrue(); expect(handle.color).toBe(anchor.color); expect(handle.anchor).toEqual({x:anchor.x,y:anchor.y});
        }
        t.editor.selectedElement=new Path(t.editor); expect(overlay.points).toEqual(points);
        t.path.lines[0].points.pop(); expect(()=>overlay.points).not.toThrow(); expect(overlay.points.length).toBe(2);
        overlay.ngOnDestroy();
    });

});
