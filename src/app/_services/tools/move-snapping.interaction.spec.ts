import { ElementRef, NgZone } from '@angular/core';
import { EditorService } from '../editor.service';
import { EditorPreferencesService } from '../editor-preferences.service';
import { AnimationPlaybackService } from '../animation-playback.service';
import { AnimationGestureService } from '../animation-gesture.service';
import { DocumentMutationService } from '../document-mutation.service';
import { HistoryService } from '../history.service';
import { ProjectService } from '../project.service';
import { CanvasWorkspaceComponent } from '../../_components/canvas-workspace/canvas-workspace.component';
import { SVG } from '../../editor/objects/svg.object';
import { Shape } from '../../editor/objects/elements/shape.object';
import { Group } from '../../editor/objects/elements/group.object';
import { Point } from '../../editor/objects/point.object';
import { arrangementBounds } from '../../editor/objects/arrangement-bounds';
import { TransformInteraction } from './transform.interaction';
import { SelectTool } from './select.tool';

function setup() {
    const preferences = new EditorPreferencesService();
    const enabled = spyOnProperty(preferences, 'objectSnapping').and.returnValue(true);
    const editor = new EditorService(preferences);
    const svg = new SVG(editor, { width: 500, height: 500, pos: new Point(0, 0) }); svg.zoom = 1;
    const moving = new Shape(editor, { type: 'rectangle', position: new Point(30, 40), width: 40, height: 20 });
    const target = new Shape(editor, { type: 'rectangle', position: new Point(140, 180), width: 80, height: 60 });
    svg.elements = [moving, target]; editor.selectedSVG = svg; editor.selectedElements = [moving];
    spyOn(editor, 'toCanvasPoint').and.callFake((x: number | Point, y?: number) => typeof x === 'number' ? new Point(x, y ?? 0) : x);
    const zone = new NgZone({ enableLongStackTrace: false });
    const animation = new AnimationPlaybackService(editor, zone, preferences); animation.mode = 'edit';
    const gestures = new AnimationGestureService(editor, animation);
    const projects = jasmine.createSpyObj<ProjectService>('projects', ['upsert', 'get']);
    const mutations = new DocumentMutationService(editor, animation, new HistoryService(), projects);
    const reset = () => { svg.snapshot(); mutations.resetBaseline(); };
    reset();
    return { editor, svg, moving, target, enabled, zone, animation, gestures, projects, mutations, reset };
}
const mouse = (x: number, y: number, altKey = false) => new MouseEvent('mousemove', { clientX: x, clientY: y, altKey });

describe('snapped object moves', () => {
    it('snaps native geometry, bypasses immediately with Alt, and commits one undoable edit', () => {
        const { editor, moving, mutations, projects } = setup();
        const transform = new TransformInteraction(editor);
        transform.begin('move', mouse(0, 0)); transform.update(mouse(67, 137));
        expect(moving.x).toBe(100); expect(moving.y).toBe(180);
        expect(transform.snapFeedback?.matches.length).toBe(2);
        transform.setSnapBypass(true);
        expect(moving.x).toBe(97); expect(moving.y).toBe(177);
        expect(transform.snapFeedback).toBeUndefined();
        transform.setSnapBypass(false);
        expect(moving.x).toBe(100); expect(moving.y).toBe(180);
        transform.end(); expect(transform.snapFeedback).toBeUndefined();
        expect(mutations.commit()).toBeTrue(); expect(mutations.commit()).toBeFalse();
        expect(projects.upsert).toHaveBeenCalledTimes(1);
        mutations.undo(); expect((editor.selectedElement as Shape).x).toBe(30);
        mutations.redo(); expect((editor.selectedElement as Shape).x).toBe(100);
    });

    it('moves rotated and scaled siblings by the same world-space snap delta', () => {
        const { editor, svg, moving, target } = setup();
        const parent = new Group(editor); parent.elements = [moving]; parent.transform.rotation = 30; parent.transform.scaleX = 1.5;
        const second = new Shape(editor, { type: 'ellipse', position: new Point(60, 70), width: 10, height: 10 });
        svg.elements = [parent, second, target]; editor.selectedElements = [moving, second];
        const before = [moving, second].map((element) => arrangementBounds(svg, element));
        const left = Math.min(...before.map((b) => b.x));
        svg.guides = [{ id: 'align', axis: 'x', value: left + 80 }];
        const transform = new TransformInteraction(editor);
        transform.begin('move', mouse(0, 0)); transform.update(mouse(78, 17));
        expect(transform.snapFeedback?.matches.find((hit) => hit.candidate.axis === 'x')?.candidate.id).toBe('guide:align');
        [moving, second].forEach((element, index) => expect(arrangementBounds(svg, element).x - before[index].x).toBeCloseTo(80, 7));
        transform.cancel();
        expect(arrangementBounds(svg, moving)).toEqual(before[0]);
    });

    it('restores exact state on cancel, raw return, or snapping back to the original position', () => {
        const { editor, svg, moving, mutations, reset } = setup();
        const parent = new Group(editor); parent.elements = [moving]; svg.elements.unshift(parent); svg.elements = svg.elements.filter((element) => element !== moving);
        svg.guides = [{ id: 'x', axis: 'x', value: 30 }, { id: 'y', axis: 'y', value: 40 }];
        reset(); const baseline = svg.save();
        const transform = new TransformInteraction(editor);
        transform.begin('move', mouse(0, 0)); transform.update(mouse(67, 137)); transform.cancel();
        expect(svg.save()).toEqual(baseline); expect(transform.snapFeedback).toBeUndefined();
        transform.begin('move', mouse(0, 0)); transform.update(mouse(67, 137)); transform.update(mouse(0, 0)); transform.end();
        expect(svg.save()).toEqual(baseline); expect(mutations.commit()).toBeFalse();
        transform.begin('move', mouse(0, 0)); transform.update(mouse(2, 1)); transform.end();
        expect(svg.save()).toEqual(baseline); expect(mutations.commit()).toBeFalse();
    });

    it('honors the preference and leaves resize gestures unsnapped', () => {
        const { editor, moving, enabled } = setup();
        const transform = new TransformInteraction(editor);
        enabled.and.returnValue(false);
        transform.begin('move', mouse(0, 0)); transform.update(mouse(67, 137));
        expect(moving.x).toBe(97); expect(moving.y).toBe(177); expect(transform.snapFeedback).toBeUndefined();
        transform.cancel(); enabled.and.returnValue(true);
        transform.begin('se', mouse(70, 60)); transform.update(mouse(137, 177));
        expect(moving.x + moving.width).toBe(137); expect(transform.snapFeedback).toBeUndefined();
        transform.cancel();
    });

    it('keeps modifier refresh inside the workspace gesture and cancels cleanly on Escape and blur', () => {
        const { editor, svg, moving, zone, gestures, mutations, projects } = setup();
        const baseline = svg.save();
        const viewport = document.createElement('div'), target = document.createElement('div');
        target.id = moving.id; viewport.append(target); document.body.append(viewport);
        const tool = new SelectTool(editor); editor.selectedTool = tool;
        const workspace = new CanvasWorkspaceComponent(editor, mutations, zone, new ElementRef(viewport), gestures);
        workspace.ngAfterViewInit();
        const down = () => target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }));
        const move = () => document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 67, clientY: 137 }));
        const up = () => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 67, clientY: 137 }));
        const key = (type: string) => document.dispatchEvent(new KeyboardEvent(type, { key: 'Alt', bubbles: true, cancelable: true }));
        const pageKey = jasmine.createSpy('page key listener'); document.addEventListener('keydown', pageKey);
        try {
            down(); move(); key('keydown');
            expect(moving.x).toBe(97); expect(pageKey).not.toHaveBeenCalled();
            key('keyup'); expect(moving.x).toBe(100); expect(projects.upsert).not.toHaveBeenCalled();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); up();
            expect(svg.save()).toEqual(baseline); expect(tool.snapFeedback).toBeUndefined();
            down(); move(); window.dispatchEvent(new Event('blur')); up();
            expect(svg.save()).toEqual(baseline); expect(projects.upsert).not.toHaveBeenCalled();
            down(); move(); up(); expect(projects.upsert).toHaveBeenCalledTimes(1);
        } finally { workspace.ngOnDestroy(); viewport.remove(); document.removeEventListener('keydown', pageKey); }
    });

    it('captures the snapped position as an animation key while keeping base artwork intact', () => {
        const { editor, svg, moving, animation, gestures, mutations, projects } = setup();
        animation.mode = 'animate'; animation.seek(1);
        gestures.begin();
        const transform = new TransformInteraction(editor);
        transform.begin('move', mouse(0, 0)); transform.update(mouse(67, 137)); transform.end();
        gestures.end(); mutations.commit();
        expect(projects.upsert).toHaveBeenCalledTimes(1);
        expect(svg.animation.tracks.filter((track) => track.targetId === moving.id).map((track) => track.keyframes.at(-1)?.value)).toEqual([100, 180]);
        expect((mutations.captureSave()!.elements[0] as any).position).toEqual(jasmine.objectContaining({ x: 30, y: 40 }));
        animation.ngOnDestroy();
    });
});
