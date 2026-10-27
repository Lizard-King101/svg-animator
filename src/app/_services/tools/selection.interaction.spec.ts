import { ElementRef, NgZone } from '@angular/core';
import { EditorService } from '../editor.service';
import { EditorPreferencesService } from '../editor-preferences.service';
import { LayerCommandService } from '../layer-command.service';
import { LayerOperationsService } from '../layer-operations.service';
import { ElementFactory } from '../element-factory.service';
import { DocumentMutationService } from '../document-mutation.service';
import { AnimationPlaybackService } from '../animation-playback.service';
import { AnimationGestureService } from '../animation-gesture.service';
import { CanvasSelectionCommandService } from '../canvas-selection-command.service';
import { HistoryService } from '../history.service';
import { ProjectService } from '../project.service';
import { SelectTool } from './select.tool';
import { TransformInteraction } from './transform.interaction';
import { MarqueeInteraction } from './marquee.interaction';
import { CanvasWorkspaceComponent } from '../../_components/canvas-workspace/canvas-workspace.component';
import { SVG } from '../../editor/objects/svg.object';
import { Shape } from '../../editor/objects/elements/shape.object';
import { Group } from '../../editor/objects/elements/group.object';
import { Point } from '../../editor/objects/point.object';
import { combinedMatrixFor } from '../../editor/objects/element-bounds';
import { applyMatrix } from '../../editor/objects/transform.object';
import { selectionFrame } from '../../editor/selection';

function setup() {
    const preferences = new EditorPreferencesService();
    // Keep these transform characterizations independent of magnetic placement.
    spyOnProperty(preferences, 'objectSnapping').and.returnValue(false);
    const editor = new EditorService(preferences);
    const svg = new SVG(editor, { width: 400, height: 300, pos: new Point(0, 0) });
    const first = new Shape(editor, { type: 'rectangle', position: new Point(10, 20), width: 30, height: 40 });
    const second = new Shape(editor, { type: 'ellipse', position: new Point(90, 30), width: 20, height: 20 });
    svg.elements = [first, second];
    editor.selectedSVG = svg;
    editor.selectedElements = [first, second];
    spyOn(editor, 'toCanvasPoint').and.callFake((x: number | Point, y?: number) => typeof x === 'number' ? new Point(x, y ?? 0) : x);
    const zone = new NgZone({ enableLongStackTrace: false });
    const animation = new AnimationPlaybackService(editor, zone, preferences);
    animation.mode = 'edit';
    const gestures = new AnimationGestureService(editor, animation);
    const projects = jasmine.createSpyObj<ProjectService>('projects', ['upsert', 'get']);
    const mutations = new DocumentMutationService(editor, animation, new HistoryService(), projects);
    svg.snapshot();
    mutations.resetBaseline();
    return { editor, svg, first, second, zone, animation, gestures, projects, mutations };
}

const mouse = (x: number, y: number, options: MouseEventInit = {}) => new MouseEvent('mousemove', { clientX: x, clientY: y, ...options });

describe('shared canvas selection', () => {
    it('shares modifier selection between canvas and Layers without creating history', () => {
        const { editor, svg, first, second, mutations, projects } = setup();
        const layers = new LayerCommandService(editor, new LayerOperationsService(editor, new ElementFactory(editor)), mutations);
        layers.selectLayer(first);
        const target = document.createElement('div');
        target.id = second.id;
        const event = mouse(100, 40, { shiftKey: true });
        Object.defineProperty(event, 'target', { value: target });
        const tool = new SelectTool(editor);
        tool.down(event); tool.up(event);
        expect(layers.selectedLayers).toEqual([first, second]);
        expect(editor.selectedElement).toBeUndefined();
        layers.selectLayer(first, mouse(0, 0, { ctrlKey: true }));
        expect(editor.selectedElement).toBe(second);
        expect(mutations.commit()).toBeFalse();
        expect(projects.upsert).not.toHaveBeenCalled();
    });

    it('marquees in both directions, adds to selection, skips hidden/locked objects, and cancels', () => {
        const { editor, first, second } = setup();
        const marquee = new MarqueeInteraction(editor);
        editor.selectedElements = [second];
        marquee.begin(mouse(50, 70, { shiftKey: true }));
        marquee.update(mouse(0, 0));
        expect(editor.selectedElements).toEqual([second, first]);
        marquee.cancel();
        expect(editor.selectedElements).toEqual([second]);
        first.locked = true;
        marquee.begin(mouse(0, 0)); marquee.update(mouse(150, 100)); marquee.end();
        expect(editor.selectedElements).toEqual([second]);
        first.locked = false; first.visible = false;
        marquee.begin(mouse(0, 0)); marquee.update(mouse(150, 100)); marquee.end();
        expect(editor.selectedElements).toEqual([second]);
    });

    it('toggles a selected group when modifier-clicking its child artwork', () => {
        const { editor, svg, first, second } = setup();
        const group = new Group(editor); group.elements = [first]; svg.elements = [group, second];
        editor.selectedElements = [group, second];
        const target = document.createElement('div'); target.id = first.id;
        const event = mouse(20, 30, { shiftKey: true });
        Object.defineProperty(event, 'target', { value: target });
        const tool = new SelectTool(editor); tool.down(event); tool.up(event);
        expect(editor.selectedElements).toEqual([second]);
    });

    it('selects visible clipping artwork through its fill and outline projections', () => {
        const { editor, svg, first, second } = setup();
        const group = new Group(editor); group.elements = [first, second]; group.clipElementId = first.id; svg.elements = [group];
        const container = document.createElementNS('http://www.w3.org/2000/svg', 'g'); container.id = group.id;
        const projection = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        projection.id = `${first.id}--stroke-${group.id}`; projection.setAttribute('data-render-target', first.id);
        const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'path'); projection.appendChild(stroke); container.appendChild(projection);
        const event = mouse(20, 30); Object.defineProperty(event, 'target', { value: stroke });
        const tool = new SelectTool(editor), select = () => { editor.selectedElements = []; tool.down(event); tool.up(event); };
        select(); expect(editor.selectedElement).toBe(first);
        first.visible = false; select(); expect(editor.selectedElements).toEqual([]); first.visible = true;
        first.locked = true; select(); expect(editor.selectedElements).toEqual([]); first.locked = false;
        group.visible = false; select(); expect(editor.selectedElements).toEqual([]);
    });

    it('uses a screen-pixel marquee threshold and selects a whole group once', () => {
        const { editor, svg, first, second } = setup();
        const group = new Group(editor); group.elements = [first, second]; svg.elements = [group];
        editor.selectedElements = [];
        (editor.toCanvasPoint as jasmine.Spy).and.callFake((x: number, y: number) => new Point(x / 2, y / 2));
        const marquee = new MarqueeInteraction(editor);
        marquee.begin(mouse(0, 0)); marquee.update(mouse(2, 1));
        expect(marquee.bounds).toBeUndefined();
        marquee.update(mouse(240, 140)); marquee.end();
        expect(editor.selectedElements).toEqual([group]);
    });
});

describe('shared selection transforms', () => {
    it('moves nested objects in canvas coordinates across differently transformed parents', () => {
        const { editor, svg, first, second } = setup();
        const a = new Group(editor); a.elements = [first]; a.transform.rotation = 30; a.transform.scaleX = 2;
        const b = new Group(editor); b.elements = [second]; b.transform.rotation = -25; b.transform.scaleY = -0.7;
        svg.elements = [a, b];
        const before = [first, second].map((element) => applyMatrix(combinedMatrixFor(svg.elements, element), element.x, element.y));
        const transform = new TransformInteraction(editor);
        transform.begin('move', mouse(0, 0)); transform.update(mouse(15, -9)); transform.end();
        [first, second].forEach((element, index) => {
            const after = applyMatrix(combinedMatrixFor(svg.elements, element), element.x, element.y);
            expect(after.x).toBeCloseTo(before[index].x + 15, 6);
            expect(after.y).toBeCloseTo(before[index].y - 9, 6);
        });
        expect(selectionFrame(svg, editor.selectedElements)?.canRotate).toBeFalse();
    });

    it('scales rotated objects proportionally about the opposite selection corner', () => {
        const { editor, svg, first, second } = setup();
        first.transform.rotation = 33; second.transform.rotation = -17;
        const bounds = selectionFrame(svg, editor.selectedElements)!.bounds;
        const before = [first, second].map((element) => applyMatrix(combinedMatrixFor(svg.elements, element), element.x, element.y));
        const transform = new TransformInteraction(editor);
        transform.begin('se', mouse(bounds.x + bounds.width, bounds.y + bounds.height));
        // MouseEvents round coordinates, so use integral frame corners in the
        // assertion by computing the ratio from the actual pointer baseline.
        const start = mouse(bounds.x + bounds.width, bounds.y + bounds.height);
        const end = mouse(bounds.x + bounds.width * 2, bounds.y + bounds.height * 2);
        const x = start.clientX - bounds.x, y = start.clientY - bounds.y;
        const ratio = ((end.clientX - bounds.x) * x + (end.clientY - bounds.y) * y) / (x * x + y * y);
        transform.update(end); transform.end();
        [first, second].forEach((element, index) => {
            const after = applyMatrix(combinedMatrixFor(svg.elements, element), element.x, element.y);
            expect(after.x).toBeCloseTo(bounds.x + (before[index].x - bounds.x) * ratio, 5);
            expect(after.y).toBeCloseTo(bounds.y + (before[index].y - bounds.y) * ratio, 5);
            expect(element.transform.scaleX).toBeCloseTo(ratio, 5);
            expect(element.transform.scaleY).toBeCloseTo(ratio, 5);
        });
    });

    it('rotates the selection around one shared center and preserves reflections', () => {
        const { editor, svg, first, second } = setup();
        second.transform.scaleX = -1;
        const bounds = selectionFrame(svg, editor.selectedElements)!.bounds;
        const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        const before = [first, second].map((element) => applyMatrix(combinedMatrixFor(svg.elements, element), element.x, element.y));
        const transform = new TransformInteraction(editor);
        transform.begin('rotate', mouse(center.x + 50, center.y));
        transform.update(mouse(center.x, center.y + 50)); transform.end();
        [first, second].forEach((element, index) => {
            const after = applyMatrix(combinedMatrixFor(svg.elements, element), element.x, element.y);
            expect(after.x).toBeCloseTo(center.x - (before[index].y - center.y), 5);
            expect(after.y).toBeCloseTo(center.y + (before[index].x - center.x), 5);
        });
        expect(second.transform.scaleX).toBeLessThan(0);
    });

    it('does not transform selected descendants twice and restores exact state on Escape or returning to start', () => {
        const { editor, svg, first, second } = setup();
        const group = new Group(editor); group.elements = [first]; group.transform.rotation = 15;
        svg.elements = [group, second]; editor.selectedElements = [group, first, second];
        const baseline = svg.save();
        const transform = new TransformInteraction(editor);
        transform.begin('move', mouse(0, 0)); transform.update(mouse(20, 10));
        expect(first.transform.translateX).toBe(0);
        transform.cancel(); expect(svg.save()).toEqual(baseline);
        transform.begin('move', mouse(0, 0)); transform.update(mouse(20, 10)); transform.update(mouse(0, 0)); transform.end();
        expect(svg.save()).toEqual(baseline);
        transform.begin('se', mouse(150, 80)); transform.end(); expect(svg.save()).toEqual(baseline);
    });

    it('keeps selection attached to restored model instances across one undo and redo', () => {
        const { editor, first, second, mutations, projects } = setup();
        const ids = [first.id, second.id];
        const transform = new TransformInteraction(editor);
        transform.begin('move', mouse(0, 0)); transform.update(mouse(20, 10)); transform.end();
        expect(mutations.commit()).toBeTrue(); expect(mutations.commit()).toBeFalse();
        expect(projects.upsert).toHaveBeenCalledTimes(1);
        mutations.undo();
        expect(editor.selectedElements.map((element) => element.id)).toEqual(ids);
        expect(editor.selectedElements[0]).not.toBe(first);
        expect(editor.selectedElements[0].transform.translateX).toBe(0);
        mutations.redo();
        expect(editor.selectedElements[0].transform.translateX).toBe(20);
    });

    it('rotates siblings in their shared scaled parent space without introducing skew', () => {
        const { editor, svg, first, second } = setup();
        const parent = new Group(editor); parent.elements = [first, second];
        parent.transform.scaleX = 2; parent.transform.scaleY = 0.6; parent.transform.rotation = 30;
        svg.elements = [parent];
        const frame = selectionFrame(svg, editor.selectedElements)!;
        expect(frame.canRotate).toBeTrue();
        const center = { x: frame.bounds.x + frame.bounds.width / 2, y: frame.bounds.y + frame.bounds.height / 2 };
        const start = applyMatrix(frame.matrix, center.x + 50, center.y);
        const end = applyMatrix(frame.matrix, center.x, center.y + 50);
        const transform = new TransformInteraction(editor);
        transform.begin('rotate', mouse(start.x, start.y));
        transform.update(mouse(end.x, end.y)); transform.end();
        // Browser MouseEvent coordinates are integral, so allow pointer rounding.
        expect(first.transform.rotation).toBeCloseTo(90, -1);
        expect(second.transform.rotation).toBeCloseTo(first.transform.rotation, 6);
        expect(first.transform.scaleX).toBeCloseTo(1, 6);
        expect(first.transform.scaleY).toBeCloseTo(1, 6);
        expect(parent.transform.originX).toBeDefined();
    });

    it('honors inherited locks and declines unsupported motion-path selection transforms', () => {
        const { editor, svg, first, second } = setup();
        const parent = new Group(editor); parent.elements = [first]; parent.locked = true;
        svg.elements = [parent, second];
        expect(selectionFrame(svg, editor.selectedElements)!.elements).toEqual([second]);
        editor.selectedElement = first;
        expect(new TransformInteraction(editor).begin('move', mouse(0, 0))).toBeFalse();
        editor.selectedElements = [first, second];
        second.motion.pathId = 'path';
        const baseline = svg.save();
        expect(new TransformInteraction(editor).begin('move', mouse(0, 0))).toBeFalse();
        expect(svg.save()).toEqual(baseline);
    });
});

describe('canvas selection keyboard and gesture lifecycle', () => {
    it('selects all editable roots, nudges with Shift, and clears without document history', () => {
        const { editor, first, second, gestures, mutations, projects, animation } = setup();
        const commands = new CanvasSelectionCommandService(editor, gestures, mutations, animation, { handleKey: () => false } as any);
        second.locked = true; mutations.resetBaseline();
        commands.handleKey(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
        expect(editor.selectedElements).toEqual([first]);
        commands.handleKey(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }));
        expect(first.transform.translateX).toBe(10);
        expect(second.transform.translateX).toBe(0);
        expect(projects.upsert).toHaveBeenCalledTimes(1);
        animation.mode = 'animate';
        expect(commands.handleKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }))).toBeFalse();
        expect(first.transform.translateX).toBe(10);
        commands.handleKey(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(editor.selectedElements).toEqual([]);
        expect(projects.upsert).toHaveBeenCalledTimes(1);
    });

    it('captures all animation values before upserting tracks can reapply preview values', () => {
        const { editor, first, second } = setup();
        const writes: { id: string; value: unknown }[] = [];
        const animation = { mode: 'animate', upsertKeyframe(element: Shape, property: string, type: string, value: unknown) {
            writes.push({ id: element.id, value });
            second.transform.translateX = 0;
        } } as unknown as AnimationPlaybackService;
        const gestures = new AnimationGestureService(editor, animation);
        gestures.begin(); first.transform.translateX = 10; second.transform.translateX = 20; gestures.end();
        expect(writes).toEqual([{ id: first.id, value: 10 }, { id: second.id, value: 20 }]);
    });

    it('persists one multi-object animation edit with unchanged artwork base values', () => {
        const { editor, svg, first, second, animation, gestures, mutations, projects } = setup();
        animation.mode = 'animate'; animation.seek(1);
        gestures.begin();
        const transform = new TransformInteraction(editor);
        transform.begin('move', mouse(0, 0)); transform.update(mouse(10, 20)); transform.end();
        gestures.end(); mutations.commit();
        expect(projects.upsert).toHaveBeenCalledTimes(1);
        const saved = mutations.captureSave()!;
        expect(saved.elements.every((element) => element.transform?.translateX === 0 && element.transform?.translateY === 0)).toBeTrue();
        [first, second].forEach((element) => {
            expect(svg.animation.tracks.find((track) => track.targetId === element.id && track.property === 'transform.translateX')?.keyframes.map((key) => key.value)).toEqual([0, 10]);
            expect(svg.animation.tracks.find((track) => track.targetId === element.id && track.property === 'transform.translateY')?.keyframes.map((key) => key.value)).toEqual([0, 20]);
        });
        mutations.undo();
        expect(svg.animation.tracks).toEqual([]);
        expect(editor.selectedElements.length).toBe(2);
        animation.ngOnDestroy();
    });

    it('finishes a drag released outside the workspace and cancels on Escape or blur without saving', () => {
        const { editor, first, second, zone, gestures, mutations, projects } = setup();
        const viewport = document.createElement('div');
        const target = document.createElement('div'); target.id = first.id; viewport.append(target); document.body.append(viewport);
        editor.selectedTool = new SelectTool(editor);
        const workspace = new CanvasWorkspaceComponent(editor, mutations, zone, new ElementRef(viewport), gestures);
        workspace.ngAfterViewInit();
        const down = () => target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }));
        const move = () => document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 20 }));
        const up = () => document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 20 }));
        try {
            down(); move(); up();
            expect(first.transform.translateX).toBe(10); expect(second.transform.translateY).toBe(20);
            expect(projects.upsert).toHaveBeenCalledTimes(1);
            down(); move(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); up();
            expect(first.transform.translateX).toBe(10); expect(projects.upsert).toHaveBeenCalledTimes(1);
            down(); move(); window.dispatchEvent(new Event('blur')); up();
            expect(second.transform.translateY).toBe(20); expect(projects.upsert).toHaveBeenCalledTimes(1);
        } finally { workspace.ngOnDestroy(); viewport.remove(); }
    });
});
