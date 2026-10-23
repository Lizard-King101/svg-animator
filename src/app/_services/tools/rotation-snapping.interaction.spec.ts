import { EditorService } from '../editor.service';
import { EditorPreferencesService } from '../editor-preferences.service';
import { SVG } from '../../editor/objects/svg.object';
import { Shape } from '../../editor/objects/elements/shape.object';
import { Group } from '../../editor/objects/elements/group.object';
import { Point } from '../../editor/objects/point.object';
import { applyMatrix, identityMatrix } from '../../editor/objects/transform.object';
import { combinedMatrixFor, parentMatrixFor } from '../../editor/objects/element-bounds';
import { EdgeRotationSnapSession, flatEdges } from '../../editor/objects/edge-rotation-snapping';
import { TransformInteraction } from './transform.interaction';
import { ElementRef, NgZone } from '@angular/core';
import { AnimationPlaybackService } from '../animation-playback.service';
import { AnimationGestureService } from '../animation-gesture.service';
import { DocumentMutationService } from '../document-mutation.service';
import { HistoryService } from '../history.service';
import { ProjectService } from '../project.service';
import { CanvasWorkspaceComponent } from '../../_components/canvas-workspace/canvas-workspace.component';
import { SelectTool } from './select.tool';

function setup() {
    const preferences = new EditorPreferencesService();
    const enabled = spyOnProperty(preferences, 'objectSnapping').and.returnValue(true);
    const editor = new EditorService(preferences), svg = new SVG(editor, { width: 800, height: 600, pos: new Point(0, 0) });
    const moving = new Shape(editor, { type: 'rectangle', position: new Point(100, 100), width: 100, height: 60 });
    const target = new Shape(editor, { type: 'rectangle', position: new Point(400, 200), width: 100, height: 60 });
    target.transform.rotation = 30;
    svg.elements = [moving, target]; editor.selectedSVG = svg; editor.selectedElement = moving;
    spyOn(editor, 'toCanvasPoint').and.callFake((x: number | Point, y?: number) => typeof x === 'number' ? new Point(x, y ?? 0) : x);
    return { editor, svg, moving, target, enabled, preferences, interaction: new TransformInteraction(editor) };
}
const mouse = (x: number, y: number, options: MouseEventInit = {}) => new MouseEvent('mousemove', { clientX: x, clientY: y, ...options });
const around = (x: number, y: number, degrees: number, options: MouseEventInit = {}) => mouse(x + 100 * Math.cos(degrees * Math.PI / 180), y + 100 * Math.sin(degrees * Math.PI / 180), options);

describe('flat edge rotation snapping', () => {
    it('commits one workspace rotation, cancels with Escape/blur, and captures Animate keys separately from the base', () => {
        const { editor, svg, moving, preferences } = setup();
        const zone = new NgZone({ enableLongStackTrace: false }), animation = new AnimationPlaybackService(editor, zone, preferences);
        animation.mode = 'edit';
        const gestures = new AnimationGestureService(editor, animation), projects = jasmine.createSpyObj<ProjectService>('projects', ['upsert', 'get']);
        const mutations = new DocumentMutationService(editor, animation, new HistoryService(), projects);
        svg.snapshot(); mutations.resetBaseline(); const baseline = svg.save();
        const viewport = document.createElement('div'), handle = document.createElement('div');
        handle.dataset['transformHandle'] = 'rotate'; viewport.append(handle); document.body.append(viewport);
        const tool = new SelectTool(editor); editor.selectedTool = tool;
        const workspace = new CanvasWorkspaceComponent(editor, mutations, zone, new ElementRef(viewport), gestures); workspace.ngAfterViewInit();
        const down = () => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 250, clientY: 130 }));
        const move = () => document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 238, clientY: 177 }));
        const up = () => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 238, clientY: 177 }));
        try {
            down(); move(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
            expect(moving.transform.rotation).not.toBeCloseTo(30, 5);
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
            expect(moving.transform.rotation).toBeCloseTo(30, 5);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); up(); expect(svg.save()).toEqual(baseline);
            down(); move(); window.dispatchEvent(new Event('blur')); up(); expect(svg.save()).toEqual(baseline);
            expect(projects.upsert).not.toHaveBeenCalled(); down(); move(); up(); expect(projects.upsert).toHaveBeenCalledTimes(1);
            mutations.undo(); expect(editor.selectedElement!.transform.rotation).toBe(0);
            mutations.redo(); expect(editor.selectedElement!.transform.rotation).toBeCloseTo(30, 5);
            mutations.undo(); animation.mode = 'animate'; animation.seek(1);
            down(); move(); up();
            const track = svg.animation.tracks.find((track) => track.property === 'transform.rotation');
            expect(track?.keyframes.length).toBe(2);
            expect(track?.keyframes[0].value).toBe(0); expect(track?.keyframes[1].value as number).toBeCloseTo(30, 5);
            expect(mutations.captureSave()!.elements[0].transform?.rotation).toBe(0);
        } finally { workspace.ngOnDestroy(); animation.ngOnDestroy(); viewport.remove(); }
    });
    it('captures parallel directions modulo 180 with angular hysteresis and bypass', () => {
        const edge = { id: 'a', label: 'Moving', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
        const target = { ...edge, id: 'b', label: 'Reference', end: { x: 100 * Math.cos(Math.PI / 6), y: 50 } };
        const session = new EdgeRotationSnapSession([edge], [target], identityMatrix(), { x: 0, y: 0 });
        expect(session.update(28, false)).toBeCloseTo(30, 7);
        expect(session.update(34, false)).toBeCloseTo(30, 7);
        expect(session.update(36, false)).toBe(36); expect(session.feedback).toBeUndefined();
        expect(session.update(208, false)).toBeCloseTo(210, 7);
        expect(session.update(208, true)).toBe(208); expect(session.feedback).toBeUndefined();
        expect(session.update(0, false)).toBe(0);
    });

    it('rotates a single object, refreshes stationary Alt, and restores an exact no-op or cancellation', () => {
        const { svg, moving, interaction, enabled } = setup(); const baseline = svg.save();
        interaction.begin('rotate', around(150, 130, 0)); interaction.update(around(150, 130, 28));
        expect(moving.transform.rotation).toBeCloseTo(30, 5); expect(interaction.rotationSnapFeedback).toBeDefined();
        interaction.setSnapBypass(true); expect(moving.transform.rotation).toBeCloseTo(28, 0);
        interaction.setSnapBypass(false); expect(moving.transform.rotation).toBeCloseTo(30, 5);
        interaction.cancel(); expect(svg.save()).toEqual(baseline); expect(interaction.rotationSnapFeedback).toBeUndefined();
        interaction.begin('rotate', around(150, 130, 0)); interaction.update(around(150, 130, 28)); interaction.update(around(150, 130, 0)); interaction.end();
        expect(svg.save()).toEqual(baseline);
        enabled.and.returnValue(false); interaction.begin('rotate', around(150, 130, 0)); interaction.update(around(150, 130, 28));
        expect(interaction.rotationSnapFeedback).toBeUndefined(); interaction.cancel();
    });

    it('aligns actual sides inside a reflected nonuniform parent and rotates about a custom origin', () => {
        const { svg, editor, moving, target } = setup(); const parent = new Group(editor);
        parent.elements = [moving]; parent.transform.scaleX = -2; parent.transform.scaleY = .7; parent.transform.rotation = 20;
        moving.transform.originX = 100; moving.transform.originY = 100;
        svg.elements = [parent, target]; const baseline = svg.save();
        const matrix = parentMatrixFor(svg.elements, moving), pivot = applyMatrix(matrix, 100, 100);
        const start = applyMatrix(matrix, 200, 100);
        const references = flatEdges(svg, [target]);
        // Find the required parent-space rotation through the same physical direction, independently of gesture code.
        const a = references[0].end.x - references[0].start.x, b = references[0].end.y - references[0].start.y;
        const det = matrix.a * matrix.d - matrix.b * matrix.c;
        const angle = Math.atan2((-matrix.b * a + matrix.a * b) / det, (matrix.d * a - matrix.c * b) / det);
        const pointer = applyMatrix(matrix, 100 + 100 * Math.cos(angle - .02), 100 + 100 * Math.sin(angle - .02));
        const interaction = new TransformInteraction(editor);
        interaction.begin('rotate', mouse(start.x, start.y)); interaction.update(mouse(pointer.x, pointer.y));
        const edges = flatEdges(svg, [moving]), direction = { x: edges[0].end.x - edges[0].start.x, y: edges[0].end.y - edges[0].start.y };
        expect((direction.x * b - direction.y * a) / (Math.hypot(direction.x, direction.y) * Math.hypot(a, b))).toBeCloseTo(0, 6);
        const after = applyMatrix(combinedMatrixFor(svg.elements, moving), 100, 100);
        expect(after.x).toBeCloseTo(pivot.x, 5); expect(after.y).toBeCloseTo(pivot.y, 5);
        interaction.cancel(); expect(svg.save()).toEqual(baseline);
    });

    it('supports multi-object rotation while retaining Shift angle increments and cancellation', () => {
        const { svg, editor, moving, interaction } = setup();
        const second = new Shape(editor, { type: 'rectangle', position: new Point(240, 100), width: 40, height: 60 });
        svg.elements.push(second); editor.selectedElements = [moving, second];
        const baseline = svg.save();
        interaction.begin('rotate', around(190, 130, 0)); interaction.update(around(190, 130, 28));
        expect(moving.transform.rotation).toBeCloseTo(30, 5); expect(second.transform.rotation).toBeCloseTo(30, 5);
        interaction.update(around(190, 130, 43, { shiftKey: true }));
        expect(moving.transform.rotation).toBeCloseTo(45, 5); expect(interaction.rotationSnapFeedback).toBeUndefined();
        interaction.cancel(); expect(svg.save()).toEqual(baseline);
    });

    it('uses locked reference sides, trims rounded rectangles, and excludes hidden/clipped/moving geometry', () => {
        const { svg, editor, moving, target, interaction } = setup();
        target.locked = true; target.settings.corner_radius = 15;
        expect(flatEdges(svg, [target]).length).toBe(4);
        const clip = new Group(editor); clip.elements = [target]; clip.clipElementId = target.id; svg.elements = [moving, clip];
        expect(flatEdges(svg).length).toBe(4);
        interaction.begin('rotate', around(150, 130, 0)); interaction.update(around(150, 130, 28));
        expect(interaction.rotationSnapFeedback).toBeUndefined(); interaction.cancel();
        svg.elements = [moving, target]; target.visible = false; expect(flatEdges(svg).length).toBe(4);
        target.visible = true; moving.motion.pathId = target.id;
        interaction.begin('rotate', around(150, 130, 0)); interaction.update(around(150, 130, 28));
        expect(interaction.rotationSnapFeedback).toBeUndefined(); interaction.cancel();
    });
});
