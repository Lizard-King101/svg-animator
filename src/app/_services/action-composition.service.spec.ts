import { ElementRef, NgZone } from '@angular/core';
import { fakeAsync, tick } from '@angular/core/testing';
import { TimelineEditorService } from './timeline-editor.service';
import { TimelineEditingService, PropertyTimelineRow } from './timeline-editing.service';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { ActionCompositionService } from './action-composition.service';
import { DocumentMutationService } from './document-mutation.service';
import { HistoryService } from './history.service';
import { SVG } from '../editor/objects/svg.object';
import { Shape } from '../editor/objects/elements/shape.object';
import { Point } from '../editor/objects/point.object';
import { createDefaultAnimation, AnimationTrack, validComposition } from '../editor/objects/animation.object';
import { compileRuntimeAnimation, evaluateCompiledRuntimeTrack } from '../editor/animation/runtime-animation-compiler';
import { AnimationEvaluationPlan } from '../editor/animation/animation-evaluation-plan';
import { expectRuntimeDomParity, parseFixtureSvg } from '../editor/animation/runtime-dom-parity.spec-support';
import { createPlayer, validateRuntimeBundle } from '../../../packages/runtime/src/player';
import { buildSVGMarkup } from '../editor/svg-markup';
import { CURRENT_DOCUMENT_VERSION, createDocumentEnvelope, migrateDocument } from '../editor/migrations/document-migrations';
import { AnimationInspectionService } from './animation-inspection.service';
import { ElementFactory } from './element-factory.service';
import showcase from '../../../fixtures/runtime-showcase-v1/document-v5.json';
import autoOrigin from '../../../fixtures/runtime-auto-origin-v1/document-v5.json';
import actionFixture from '../editor/migrations/fixtures/document-v8-actions.json';
import timingFixture from '../editor/migrations/fixtures/document-v9-action-timing.json';

function setup() {
    const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
    const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0, 0) });
    const shape = new Shape(editor, { type: 'rectangle', position: new Point(10, 20), width: 20, height: 30 });
    svg.elements = [shape]; svg.animation.duration = 6;
    editor.selectedSVG = svg; editor.selectedElement = shape; svg.snapshot();
    const playback = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences);
    playback.mode = 'animate';
    const projects = { upsert: jasmine.createSpy('upsert') };
    const mutations = new DocumentMutationService(editor, playback, new HistoryService(), projects as never);
    mutations.resetBaseline();
    const actions = new ActionCompositionService(editor, playback, mutations);
    return { editor, svg, shape, playback, mutations, actions, projects };
}
function track(targetId: string, property = 'transform.translateX'): AnimationTrack {
    return { id: property, targetId, property, valueType: 'number', keyframes: [
        { id: 'a', time: 0, value: 0 }, { id: 'b', time: 0.5, value: 100 }, { id: 'c', time: 1, value: 0 },
    ] };
}

describe('action composition', () => {
    it('commits a left-edge trim and scene start together and rejects extensions into adjacent blocks', () => {
        const t = setup(), source = t.actions.create('Move')!;
        t.playback.editAction(); const first = t.actions.place(source.id, 0)!, second = t.actions.place(source.id, 1)!;
        const saves = t.projects.upsert.calls.count();
        t.actions.retime(second, { start: 1.25, sourceStart: .25 });
        expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        expect(second.start + t.actions.duration(second)).toBe(2);
        t.mutations.undo(); expect(t.actions.placements[1].start).toBe(1); expect(t.actions.placements[1].sourceStart).toBeUndefined();
        t.mutations.redo(); expect(t.actions.placements[1].start).toBe(1.25); expect(t.actions.placements[1].sourceStart).toBe(.25);
        const before = t.mutations.captureState();
        t.actions.retime(t.actions.placements[1], { start: .9, sourceStart: 0 });
        expect(t.mutations.captureState()).toBe(before); expect(t.actions.message).toContain('overlap');
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('trims, rates and loops a placement with exact local-time evaluation and runtime parity', () => {
        const t = setup(), source = t.actions.create('Move')!;
        source.animation.tracks = [track(t.shape.id)]; t.mutations.commit('animation'); t.playback.editAction();
        const p = t.actions.place(source.id, 1)!;
        t.actions.retime(p, { sourceStart: .25, sourceEnd: .75, rate: 2, repeat: 3 });
        expect(t.actions.duration(p)).toBe(.75);
        const compiled = compileRuntimeAnimation(t.mutations.captureSave()!);
        expect(compiled.bundle.requiredCapabilities).toContain('composition.action-timing-v1');
        const channel = compiled.bundle.animation.tracks.find(track => track.actionWindows?.length)!;
        for(const [scene, expected] of [[1, 50], [1.125, 100], [1.25, 50], [1.375, 100], [1.5, 50], [1.75, 0], [.5, 0], [1.125, 100]]) {
            expect(evaluateCompiledRuntimeTrack(channel, scene)).withContext(String(scene)).toBeCloseTo(expected);
        }
        expectRuntimeDomParity(t.mutations.captureSave()!, [0, 1, 1.125, 1.249, 1.25, 1.375, 1.5, 1.749, 1.75, 1.1]);
        const restored = SVG.fromSave(JSON.parse(JSON.stringify(t.mutations.captureSave())), t.editor);
        expect(restored.animation.composition?.placements[0]).toEqual(p);
        t.actions.repeatPlacement(p);
        expect(t.actions.placements[1]).toEqual(jasmine.objectContaining({ start: 1.75, sourceStart: .25, sourceEnd: .75, rate: 2, repeat: 3 }));
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('rejects invalid trims, rates, loop counts and timing collisions without history', () => {
        const t = setup(), source = t.actions.create('Move')!;
        t.playback.editAction(); const first = t.actions.place(source.id, 0)!, second = t.actions.place(source.id, 1)!;
        const before = t.mutations.captureState(), saves = t.projects.upsert.calls.count();
        for(const changes of [{ sourceStart: 1 }, { sourceEnd: 2 }, { rate: 0 }, { rate: NaN }, { repeat: 1.5 }, { repeat: 2 }]) {
            t.actions.retime(first, changes); expect(t.mutations.captureState()).toBe(before);
        }
        expect(t.projects.upsert.calls.count()).toBe(saves);
        t.actions.retime(second, { rate: .5, repeat: 2 }); expect(t.actions.duration(second)).toBe(4);
        t.mutations.undo(); expect(t.actions.duration(t.actions.placements[1])).toBe(1);
        t.mutations.redo(); expect(t.actions.duration(t.actions.placements[1])).toBe(4);
        t.playback.editAction(source.id); t.actions.retime(t.actions.placements[0], { sourceEnd: .8 });
        t.playback.setDuration(.5); expect(t.playback.duration).toBe(1);
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('composes disjoint channels on one object and rejects conflicting source edits without a save or undo step', () => {
        const t = setup(), move = t.actions.create('Move')!;
        move.animation.tracks = [track(t.shape.id)]; t.mutations.commit('animation');
        const fade = t.actions.create('Fade')!;
        fade.animation.tracks = [track(t.shape.id, 'opacity')]; t.mutations.commit('animation');
        t.playback.editAction();
        expect(t.actions.place(move.id, 0)).toBeDefined(); expect(t.actions.place(fade.id, 0)).toBeDefined();
        expect(validComposition(t.svg.animation.composition)).toBeTrue();
        expectRuntimeDomParity(t.mutations.captureSave()!, [0, .25, .5, .99, 1]);
        t.playback.editAction(fade.id);
        const before = t.mutations.captureState(), saves = t.projects.upsert.calls.count();
        t.playback.upsertKeyframe(t.shape, 'transform.translateX', 'number', 20, 0);
        expect(t.mutations.commit('animation')).toBeFalse();
        expect(t.playback.contextMessage).toContain('same channel');
        expect(t.mutations.captureState()).toBe(before); expect(t.projects.upsert.calls.count()).toBe(saves);
        expect(t.playback.activeAction?.animation.tracks.map(track => track.property)).toEqual(['opacity']);
        t.mutations.undo(); expect(t.actions.placements.length).toBe(1);
        t.mutations.redo(); expect(t.actions.placements.length).toBe(2);
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('guards bulk track restoration and disabled channels at the same commit boundary', () => {
        const t = setup(), first = t.actions.create('Move')!;
        first.animation.tracks = [track(t.shape.id)]; t.mutations.commit('animation');
        const second = t.actions.create('Other')!;
        second.animation.tracks = [{ ...track(t.shape.id), enabled: false }]; t.mutations.commit('animation');
        t.actions.place(first.id, 0); t.actions.place(second.id, 0);
        const before = t.mutations.captureState();
        second.animation.tracks[0].enabled = true;
        expect(t.mutations.commit('animation')).toBeFalse(); expect(t.mutations.captureState()).toBe(before);
        t.playback.activeAction!.animation.tracks.push(track(t.shape.id));
        expect(t.mutations.commit('animation')).toBeFalse(); expect(t.mutations.captureState()).toBe(before);
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('treats frame and point deformation as a shared geometry conflict domain', () => {
        const t = setup(), first = t.actions.create('Frame')!;
        first.animation.tracks = [track(t.shape.id, 'geometry.width')]; t.mutations.commit('animation');
        const second = t.actions.create('Points')!;
        second.animation.tracks = [track(t.shape.id, 'path.points.anchor.x')]; t.mutations.commit('animation');
        t.actions.place(first.id, 0);
        expect(t.actions.place(second.id, .5)).toBeUndefined();
        expect(t.actions.place(second.id, 1)).toBeDefined();
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('cancels a numeric key draft and clears key selection when leaving an action', fakeAsync(() => {
        const t = setup(), action = t.actions.create('Blink')!;
        const timeline = new TimelineEditorService(t.editor, t.playback, new ElementRef(document.createElement('div')),
            new EditorPreferencesService(), new TimelineEditingService(), new NgZone({ enableLongStackTrace: false }),
            t.mutations, { markForCheck: () => {} } as never, {} as never);
        timeline.selectedKeyframeIds = new Set(['old-context-key']);
        const row: PropertyTimelineRow = { type: 'property', element: t.shape, depth: 1,
            property: { property: 'opacity', label: 'Opacity', valueType: 'number', group: 'style', mvp: true } };
        const input = document.createElement('input');
        const event = (clientX: number) => ({ button: 0, pointerId: 7, clientX, currentTarget: input, preventDefault: () => {}, stopPropagation: () => {} }) as unknown as PointerEvent;
        timeline.beginNumberDrag(row, event(0)); timeline.updateNumberDrag(event(-50)); tick(20);
        expect(action.animation.tracks.length).toBe(1);
        t.playback.editAction();
        expect(action.animation.tracks).toEqual([]); expect(t.shape.opacity).toBe(1); expect(timeline.selectedKeyframeIds.size).toBe(0);
        timeline.ngOnDestroy(); t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    }));

    it('duplicates sources independently while placements stay linked to the original', () => {
        const t = setup(), original = t.actions.create('Blink')!;
        original.animation.tracks = [track(t.shape.id)]; t.playback.invalidate();
        t.actions.place(original.id, 0); t.actions.duplicate(original);
        const copy = t.playback.activeAction!;
        expect(copy.id).not.toBe(original.id); expect(copy.animation.tracks[0].id).not.toBe(original.animation.tracks[0].id);
        copy.animation.tracks[0].keyframes[1].value = 9;
        expect(original.animation.tracks[0].keyframes[1].value).toBe(100); expect(t.actions.placements[0].actionId).toBe(original.id);
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });
    it('preserves path, gradient, color, nested transform and origin parity when existing motion becomes an action', () => {
        for(const fixture of [showcase, autoOrigin]) {
            const model = SVG.fromSave(fixture.data as never, { ID: 'fixture' } as never);
            const local = model.animation;
            model.animation = { ...createDefaultAnimation(), duration: local.duration * 3 + 2, composition: {
                version: 1, actions: [{ id: 'source', name: 'Source', targetIds: [...new Set(local.tracks.map(track => track.targetId))], animation: local }],
                placements: [{ id: 'one', actionId: 'source', start: 1 }, { id: 'two', actionId: 'source', start: local.duration + 2 }],
            } };
            expectRuntimeDomParity(model.save(), [0, 1, 1 + local.duration / 2, 1 + local.duration, 2 + local.duration, 2 + local.duration * 1.5, 2 + local.duration * 2]);
            Object.assign(model.animation.composition!.placements[0], { sourceStart: local.duration * .2, sourceEnd: local.duration * .8, rate: 1.5, repeat: 2 });
            expectRuntimeDomParity(model.save(), [0, 1, 1 + local.duration * .2, 1 + local.duration * .4, 1 + local.duration * .6, 1 + local.duration * .8, 1.1]);
        }
    });
    it('edits action-local keys without replacing the document, then resolves both linked placements', () => {
        const t = setup();
        t.playback.seek(4);
        const action = t.actions.create('Blink')!;
        expect(t.playback.duration).toBe(1);
        expect(t.playback.currentTime).toBe(0);
        t.playback.seek(0.5);
        t.playback.upsertKeyframe(t.shape, 'transform.translateX', 'number', 80, 0);
        t.mutations.commit('animation');
        expect(t.svg.animation.tracks).toEqual([]);
        expect(action.animation.tracks.length).toBe(1);
        expect(t.editor.selectedSVG).toBe(t.svg);
        t.playback.editAction();
        expect(t.playback.currentTime).toBe(4);
        t.actions.place(action.id, 1); t.actions.place(action.id, 3);
        [1.5, 3.5].forEach(time => { t.playback.seek(time); expect(t.shape.transform.translateX).toBe(80); });
        [2, 0, 4, 2.5].forEach(time => { t.playback.seek(time); expect(t.shape.transform.translateX).toBe(0); });
        t.playback.editAction(action.id); expect(t.playback.currentTime).toBe(0.5);
        t.playback.upsertKeyframe(t.shape, 'transform.translateX', 'number', 120);
        t.mutations.commit('animation'); t.playback.editAction();
        [1.5, 3.5].forEach(time => { t.playback.seek(time); expect(t.shape.transform.translateX).toBe(120); });
        t.mutations.undo(); t.playback.seek(3.5);
        expect(t.svg.elements[0].transform.translateX).toBe(80);
        t.mutations.redo(); t.playback.seek(1.5);
        expect(t.svg.elements[0].transform.translateX).toBe(120);
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('commits placements once, rejects overlaps/no-ops, and restores source links through undo/redo and JSON', () => {
        const t = setup(), action = t.actions.create('Blink')!;
        t.playback.editAction();
        const first = t.actions.place(action.id, 1)!;
        const saves = t.projects.upsert.calls.count();
        expect(t.actions.place(action.id, 1.5)).toBeUndefined();
        t.actions.move(first, 1); expect(t.projects.upsert.calls.count()).toBe(saves);
        t.actions.move(first, 3); expect(t.projects.upsert.calls.count()).toBe(saves + 1);
        t.mutations.undo(); expect(t.actions.placements[0].start).toBe(1);
        t.mutations.redo(); expect(t.actions.placements[0].start).toBe(3);
        const restored = SVG.fromSave(JSON.parse(JSON.stringify(t.mutations.captureSave())), t.editor);
        expect(restored.animation.composition).toEqual(t.svg.animation.composition);
        t.actions.removeAction(t.actions.actions[0]); expect(t.actions.placements.length).toBe(0);
        t.mutations.undo(); expect(t.actions.placements[0].actionId).toBe(action.id);
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('extracts selected motion as one undoable source operation and limits authoring to its scope', () => {
        const t = setup(); t.svg.animation.tracks = [track(t.shape.id)]; t.mutations.commit('animation');
        const other = new Shape(t.editor, { type: 'rectangle', position: new Point(0, 0), width: 10, height: 10 });
        t.svg.elements.push(other); t.mutations.commit('artwork');
        const action = t.actions.create('Extracted', true)!;
        expect(action.animation.tracks.length).toBe(1); expect(t.svg.animation.tracks.length).toBe(0);
        t.playback.upsertKeyframe(other, 'opacity', 'number', 0.2, 1);
        expect(other.opacity).toBe(1); expect(action.animation.tracks.length).toBe(1);
        t.mutations.undo(); expect(t.svg.animation.tracks.length).toBe(1); expect(t.playback.activeAction).toBeUndefined();
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('prevents source-duration edits from making placements overlap', () => {
        const t = setup(), action = t.actions.create('Blink')!;
        t.actions.place(action.id, 0); t.actions.place(action.id, 1);
        t.playback.setDuration(2);
        expect(action.animation.duration).toBe(1); expect(t.playback.contextMessage).toContain('overlap');
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('samples the active action independently of scene placement time', () => {
        const t = setup(), action = t.actions.create('Blink')!;
        action.animation.tracks = [track(t.shape.id)]; t.playback.invalidate();
        const inspection = new AnimationInspectionService(t.editor, t.playback, t.mutations, new ElementFactory(t.editor));
        inspection.motionTrails = true;
        t.playback.seek(0.5); expect(inspection.display!.current.get(t.shape.id)!.x).toBe(120);
        t.playback.editAction(); expect(inspection.display!.trails).toEqual([]);
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('matches runtime evaluation at gaps, adjacent boundaries, temporal curves and random seeks', () => {
        const t = setup(), action = t.actions.create('Blink')!;
        const motion = track(t.shape.id);
        motion.keyframes[0].temporal = { linked: false, out: { speed: 0, influence: 0.6 } };
        action.animation.tracks = [motion, { ...track(t.shape.id, 'visible'), valueType: 'boolean', keyframes: [{ id: 'visible', time: 0, value: false }] }];
        t.playback.editAction(); t.actions.place(action.id, 1); t.actions.place(action.id, 2); t.actions.place(action.id, 4);
        const source = t.mutations.captureSave()!;
        const { bundle, diagnostics } = compileRuntimeAnimation(source);
        expect(diagnostics).toEqual([]); expect(bundle.requiredCapabilities).toContain('composition.action-windows-v1');
        validateRuntimeBundle(bundle);
        const times = [0, 1, 1.25, 1.9999, 2, 2.5, 3, 3.5, 4.25, 5, 6];
        expectRuntimeDomParity(source, times);
        const model = SVG.fromSave(source, t.editor), plan = new AnimationEvaluationPlan(model.animation, model.elements);
        for(const time of [2.5, 0, 4.25, 3, 1.25, 6, 2]) {
            bundle.animation.tracks.forEach(compiled => {
                const expected = plan.evaluate(time).find(value => value.property === bundle.animation.properties[compiled.property])!.value;
                expect(evaluateCompiledRuntimeTrack(compiled, time)).withContext(`${time}`).toEqual(expected as number | boolean | string);
            });
        }
        const root = parseFixtureSvg(buildSVGMarkup(model, { runtime: { signature: bundle.artwork.signature } }));
        const player = createPlayer(root, bundle);
        player.seek(1.5); player.seek(3);
        expect(root.querySelector(`[id="${t.shape.id}"]`)!.getAttribute('transform')).toBeNull();
        player.destroy(); t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('resumes direct scene animation outside action windows', () => {
        const t = setup(), action = t.actions.create('Offset')!;
        action.animation.tracks = [track(t.shape.id)];
        t.svg.animation.tracks = [{ ...track(t.shape.id), keyframes: [{ id: 'direct', time: 0, value: 17 }] }];
        t.playback.editAction(); t.actions.place(action.id, 1);
        t.playback.seek(1.5); expect(t.shape.transform.translateX).toBe(100);
        t.playback.seek(2); expect(t.shape.transform.translateX).toBe(17);
        expectRuntimeDomParity(t.mutations.captureSave()!, [0, 1, 1.5, 2, 6]);
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('migrates v7 and rejects malformed or future composition instead of discarding it', () => {
        const t = setup(); const action = t.actions.create('Blink')!;
        const envelope = createDocumentEnvelope(t.mutations.captureSave()!);
        expect(envelope.version).toBe(CURRENT_DOCUMENT_VERSION); expect(migrateDocument(envelope).status).toBe('ok');
        expect(migrateDocument({ ...envelope, version: 7, data: { ...envelope.data, animation: createDefaultAnimation() } }).status).toBe('ok');
        expect(validComposition({ ...t.svg.animation.composition, version: 2 })).toBeFalse();
        action.animation.composition = { version: 1, actions: [], placements: [] };
        expect(validComposition(t.svg.animation.composition)).toBeFalse();
        t.playback.ngOnDestroy(); t.mutations.ngOnDestroy();
    });

    it('keeps the v8 action fixture idempotent and rejects unknown composition versions at the migration boundary', () => {
        const result = migrateDocument(actionFixture);
        expect(result.status).toBe('ok');
        if(result.status === 'ok') { expect(result.migrated).toBeTrue(); expect(result.value.data).toEqual(actionFixture.data as never); expect(migrateDocument(result.value).status).toBe('ok'); }
        const invalid = JSON.parse(JSON.stringify(actionFixture)); invalid.data.animation.composition.version = 2;
        expect(migrateDocument(invalid).status).toBe('unsupported');
    });

    it('round-trips v9 timing and rejects invalid runtime mappings or missing capabilities', () => {
        const migrated = migrateDocument(timingFixture);
        expect(migrated.status).toBe('ok');
        if(migrated.status === 'ok') { expect(migrated.migrated).toBeTrue(); expect(migrateDocument(migrated.value)).toEqual({ status: 'ok', value: migrated.value, migrated: false, warnings: [] }); }
        const bundle = compileRuntimeAnimation(timingFixture.data as never).bundle;
        validateRuntimeBundle(bundle);
        const missing = JSON.parse(JSON.stringify(bundle));
        missing.requiredCapabilities = missing.requiredCapabilities.filter((v: string) => v !== 'composition.action-timing-v1');
        expect(() => validateRuntimeBundle(missing)).toThrow();
        const invalid = JSON.parse(JSON.stringify(bundle)); invalid.animation.tracks[0].actionWindows[0].timing.rate = 0;
        expect(() => validateRuntimeBundle(invalid)).toThrow();
    });

    it('requires a declared runtime capability and rejects nested or overlapping windows', () => {
        const bundle = compileRuntimeAnimation(actionFixture.data as never).bundle;
        validateRuntimeBundle(bundle);
        const clone = () => JSON.parse(JSON.stringify(bundle)) as typeof bundle;
        const missing = clone(); missing.requiredCapabilities = missing.requiredCapabilities.filter(capability => capability !== 'composition.action-windows-v1');
        expect(() => validateRuntimeBundle(missing)).toThrow();
        const overlap = clone(); overlap.animation.tracks[0].actionWindows![1].start = 0.6;
        expect(() => validateRuntimeBundle(overlap)).toThrow();
        const nested = clone(); nested.animation.tracks[0].actionWindows![0].track.actionWindows = [];
        expect(() => validateRuntimeBundle(nested)).toThrow();
    });
});
