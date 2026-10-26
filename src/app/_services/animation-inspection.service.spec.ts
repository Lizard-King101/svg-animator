import { NgZone } from '@angular/core';
import { AnimationInspectionService } from './animation-inspection.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { EditorService } from './editor.service';
import { ElementFactory } from './element-factory.service';
import { DocumentMutationService } from './document-mutation.service';
import { SVG } from '../editor/objects/svg.object';
import { Shape } from '../editor/objects/elements/shape.object';
import { Group } from '../editor/objects/elements/group.object';
import { Point } from '../editor/objects/point.object';
import { AnimationTrack } from '../editor/objects/animation.object';
import { onionTimes } from '../editor/animation/animation-inspection';
import { buildSVGMarkup } from '../editor/svg-markup';
import { Path } from '../editor/objects/elements/path.object';
import { Line } from '../editor/objects/line.object';
import { AnimationInspectionSnapshot } from '../editor/animation/animation-inspection';
import { pathPointAnimationProperty } from '../editor/objects/animation-targets';

function setup() {
    const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
    const svg = new SVG(editor, { width: 400, height: 300, pos: new Point(0, 0) });
    const shape = new Shape(editor, { type: 'rectangle', position: new Point(10, 20), width: 20, height: 40 });
    svg.elements = [shape]; svg.animation.duration = 1;
    svg.animation.tracks = [track(shape.id, 'transform.translateX', 0, 120)];
    editor.selectedSVG = svg; editor.selectedElement = shape;
    const animation = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences);
    animation.mode = 'animate';
    const mutations = { revision: 0 };
    const inspection = new AnimationInspectionService(editor, animation, mutations as DocumentMutationService, new ElementFactory(editor));
    return { editor, svg, shape, animation, inspection, mutations };
}

function track(targetId: string, property: string, from: number | boolean, to: number | boolean): AnimationTrack {
    return { id: property, targetId, property, valueType: typeof from === 'boolean' ? 'boolean' : 'number', keyframes: [
        { id: 'a', time: 0, value: from, easing: { type: 'linear' } },
        { id: 'b', time: 1, value: to, easing: { type: 'linear' } },
    ] };
}

describe('animation inspection', () => {
    it('bounds onion samples without duplicate endpoints or loop wrapping', () => {
        expect(onionTimes(0, 1, 0.1)).toEqual([0.1, 0.2]);
        expect(onionTimes(1, 1, 0.1)).toEqual([0.8, 0.9]);
        expect(onionTimes(0.5, 1, 2)).toEqual([]);
    });

    it('samples ghosts and origins without changing the live preview, draft, selection or export', () => {
        const { svg, shape, animation, inspection, editor } = setup();
        animation.seek(0.5);
        // A live gesture may temporarily differ from the currently evaluated key.
        shape.transform.translateX = 73;
        const save = JSON.stringify(svg.save()), markup = buildSVGMarkup(svg);
        inspection.onions = inspection.motionTrails = true;
        const display = inspection.display!;
        expect(display.skins.length).toBe(4);
        expect(display.skins.map(skin => skin.direction)).toEqual(['past', 'past', 'future', 'future']);
        const ghost = decodeURIComponent(display.skins[0].image.split(',')[1]);
        expect(ghost).toContain('matrix(1 0 0 1 36 0)');
        expect(display.trails[0].ticks[0]).toEqual({ x: 20, y: 40, time: 0 });
        expect(display.trails[0].ticks.at(-1)).toEqual({ x: 140, y: 40, time: 1 });
        expect(display.current.get(shape.id)).toEqual({ x: 80, y: 40, time: 0.5 });
        expect(JSON.stringify(svg.save())).toBe(save); expect(buildSVGMarkup(svg)).toBe(markup);
        expect(editor.selectedElement).toBe(shape); expect(animation.currentTime).toBe(0.5);
        animation.ngOnDestroy();
    });

    it('reuses samples while panning, updates after keys/undo, and discards them on document switches', () => {
        const { svg, shape, animation, inspection, mutations, editor } = setup();
        inspection.onions = inspection.motionTrails = true;
        const first = inspection.display!;
        svg.zoom = 2; svg.pos.x += 50;
        expect(inspection.display!.skins).toBe(first.skins);
        expect(inspection.display!.trails).toBe(first.trails);
        expect(inspection.display!.current).toBe(first.current);
        svg.animation.tracks[0].keyframes[1].value = 240; animation.invalidate();
        expect(inspection.display!.trails[0].ticks.at(-1)!.x).toBe(260);
        svg.animation.tracks[0].keyframes[1].value = 120; mutations.revision++;
        expect(inspection.display!.trails[0].ticks.at(-1)!.x).toBe(140);
        editor.selectedSVG = new SVG(editor, { width: 10, height: 10, pos: new Point(0, 0) });
        expect(inspection.display!.trails).toEqual([]);
        animation.ngOnDestroy();
    });

    it('projects animated ancestors and custom origins, omitting invisible poses', () => {
        const { svg, shape, animation, inspection, editor } = setup();
        const parent = new Group(editor);
        parent.elements = [shape]; parent.transform.scaleX = 2; parent.transform.originX = 0; parent.transform.originY = 0;
        svg.elements = [parent]; shape.transform.originX = 5; shape.transform.originY = 6;
        svg.animation.tracks.push(track(parent.id, 'transform.translateY', 0, 50));
        inspection.motionTrails = true;
        expect(inspection.display!.trails[0].ticks.at(-1)).toEqual({ x: 250, y: 56, time: 1 });
        svg.animation.tracks.push(track(parent.id, 'visible', false, true)); animation.invalidate();
        expect(inspection.display!.current.size).toBe(0);
        animation.ngOnDestroy();
    });

    it('hides inspection in Edit mode and playback and validates spacing without document edits', () => {
        const { animation, inspection, svg } = setup();
        const before = svg.save();
        expect(inspection.display).toBeUndefined(); inspection.onions = true;
        inspection.setStep(NaN); expect(inspection.step).toBe(0.1);
        inspection.setStep(-2); expect(inspection.step).toBe(0.01);
        inspection.setStep(50); expect(inspection.step).toBe(10);
        animation.playing = true; expect(inspection.display).toBeUndefined();
        animation.playing = false; animation.mode = 'edit'; expect(inspection.display).toBeUndefined();
        expect(svg.save()).toEqual(before); animation.ngOnDestroy();
    });

    it('does not join trails across hidden intervals or include static backgrounds in ghosts', () => {
        const { editor, svg, shape, animation, inspection } = setup();
        const background = new Shape(editor, { type: 'rectangle', position: new Point(0, 0), width: 400, height: 300 });
        svg.elements.unshift(background); editor.selectedElements = [];
        inspection.onions = true;
        const ghost = decodeURIComponent(inspection.display!.skins[0].image.split(',')[1]);
        expect(ghost).toContain(`id="${shape.id}"`);
        expect(ghost).not.toContain(`id="${background.id}"`);
        editor.selectedElement = shape; inspection.motionTrails = true;
        const visibility = track(shape.id, 'visible', true, true);
        visibility.keyframes.splice(1, 0, { id: 'hide', time: 0.4, value: false }, { id: 'show', time: 0.7, value: true });
        svg.animation.tracks.push(visibility); animation.invalidate();
        const segments = inspection.display!.trails[0].segments;
        expect(segments.length).toBe(2);
        expect(segments[0].at(-1)!.time).toBeLessThan(0.4);
        expect(segments[1][0].time).toBeGreaterThanOrEqual(0.7);
        animation.ngOnDestroy();
    });

    it('isolates visible clipping paint in onion skins while retaining the clipping geometry', () => {
        const { editor, svg, shape, animation } = setup();
        const source = new Shape(editor, { type: 'ellipse', position: new Point(0, 0), width: 100, height: 60 });
        const group = new Group(editor); group.elements = [source, shape]; group.clipElementId = source.id; svg.elements = [group];
        const snapshot = new AnimationInspectionSnapshot(svg);
        const ghost = (id: string) => new DOMParser().parseFromString(decodeURIComponent(snapshot.skins(.5, .1, [id])[0].image.split(',')[1]), 'image/svg+xml');
        const pupilGhost = ghost(shape.id);
        const sourceNodes = [...pupilGhost.querySelectorAll(`[data-render-target="${source.id}"]`)];
        expect(sourceNodes.some(node => !!node.closest('clipPath'))).toBeTrue();
        expect(sourceNodes.filter(node => !node.closest('defs')).length).toBe(0);
        expect(pupilGhost.getElementById(shape.id)).not.toBeNull();
        const sourceGhost = ghost(source.id);
        expect([...sourceGhost.querySelectorAll(`[data-render-target="${source.id}"]`)].filter(node => !node.closest('defs')).length).toBe(2);
        expect(sourceGhost.getElementById(shape.id)).toBeNull();
        animation.ngOnDestroy();
    });

    it('rejects sampling restoration into the live document', () => {
        const { animation, svg } = setup();
        animation.seek(0.5);
        expect(() => animation.restoreSamplingBase(svg)).toThrowError('Animation sampling requires a detached document.');
        animation.ngOnDestroy();
    });

    it('samples point deformation and frame movement independently of sampling order', () => {
        const { editor, svg, animation } = setup();
        const path = new Path(editor), first = new Point(0, 0), second = new Point(40, 40);
        path.lines = [new Line(editor, { points: [first, second] })]; svg.elements = [path];
        svg.animation.tracks = [track(path.id, 'geometry.x', 0, 80), track(path.id, pathPointAnimationProperty(first.id, 'x'), 0, 100)];
        const snapshot = new AnimationInspectionSnapshot(new ElementFactory(editor).restoreDocument(svg.save()));
        const atStart = snapshot.origins(0, [path.id]).get(path.id);
        const atEnd = snapshot.origins(1, [path.id]).get(path.id);
        snapshot.skins(0.5, 0.1); snapshot.trails([path.id]);
        expect(snapshot.origins(0, [path.id]).get(path.id)).toEqual(atStart);
        expect(snapshot.origins(1, [path.id]).get(path.id)).toEqual(atEnd);
        expect(first.x).toBe(0); expect(second.x).toBe(40); animation.ngOnDestroy();
    });

    it('follows a native motion-path attachment when sampling an origin trail', () => {
        const { editor, svg, shape, animation, inspection } = setup();
        const path = new Path(editor); path.lines = [new Line(editor, { points: [new Point(50, 60), new Point(150, 60)] })];
        svg.elements.push(path); shape.motion.pathId = path.id;
        svg.animation.tracks = [track(shape.id, 'motion.progress', 0, 1)];
        inspection.motionTrails = true;
        const ticks = inspection.display!.trails[0].ticks;
        expect(ticks[0]).toEqual({ x: 50, y: 60, time: 0 });
        expect(ticks.at(-1)).toEqual({ x: 150, y: 60, time: 1 });
        animation.ngOnDestroy();
    });
});
