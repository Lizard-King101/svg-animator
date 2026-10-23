import { ConstructionControlsComponent } from '../_components/construction-controls/construction-controls.component';
import { ToolPaletteComponent } from '../_components/tool-palette/tool-palette.component';
import { ElementRef, NgZone } from '@angular/core';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { AnimationGestureService } from './animation-gesture.service';
import { DocumentMutationService } from './document-mutation.service';
import { LayerOperationsService } from './layer-operations.service';
import { ElementFactory } from './element-factory.service';
import { HistoryService } from './history.service';
import { ProjectService } from './project.service';
import { ConstructionDrawingService } from './construction-drawing.service';
import { PenTool } from './tools/pen.tool';
import { ConstructionTool, ConstructionKind } from './tools/construction.tool';
import { CanvasWorkspaceComponent } from '../_components/canvas-workspace/canvas-workspace.component';
import { SVG } from '../editor/objects/svg.object';
import { Point } from '../editor/objects/point.object';
import { Path } from '../editor/objects/elements/path.object';
import { Shape } from '../editor/objects/elements/shape.object';
import { buildSVGMarkup } from '../editor/svg-markup';
import { Color } from '../editor/objects/color.object';

function setup(kind: ConstructionKind = 'line') {
    const preferences = new EditorPreferencesService(); spyOnProperty(preferences, 'objectSnapping').and.returnValue(false);
    const editor = new EditorService(preferences);
    const svg = SVG.fromSave({ id: 'construction', name: 'Construction', width: 800, height: 600, elements: [] }, editor);
    editor.selectedSVG = svg; svg.zoom = 1;
    spyOn(editor, 'toCanvasPoint').and.callFake((x: number | Point, y?: number) => typeof x === 'number' ? new Point(x, y!) : x);
    const zone = new NgZone({ enableLongStackTrace: false });
    const animation = new AnimationPlaybackService(editor, zone, preferences); animation.mode = 'edit';
    const projects = jasmine.createSpyObj<ProjectService>('projects', ['upsert', 'get']);
    const mutations = new DocumentMutationService(editor, animation, new HistoryService(), projects); mutations.resetBaseline();
    const layers = new LayerOperationsService(editor, new ElementFactory(editor));
    const drawing = new ConstructionDrawingService(editor, animation, mutations, layers);
    const tools = editor.tools.flatMap(tool => tool.children).filter((tool): tool is ConstructionTool => tool instanceof ConstructionTool);
    tools.forEach(tool => tool.drawing = drawing); tools.find(tool => tool.kind === kind)!.restoreSelection();
    const host = document.createElement('div'); document.body.appendChild(host);
    const workspace = new CanvasWorkspaceComponent(editor, mutations, zone, new ElementRef(host), new AnimationGestureService(editor, animation));
    workspace.ngAfterViewInit();
    const event = (type: string, x: number, y: number, options: MouseEventInit = {}) => host.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, ...options }));
    const click = (x: number, y: number, options: MouseEventInit = {}) => { event('mousedown', x, y, options); event('mouseup', x, y, options); event('click', x, y, options); };
    const drag = (x: number, y: number, ex: number, ey: number, options: MouseEventInit = {}) => { event('mousedown', x, y, options); event('mousemove', ex, ey, options); event('mouseup', ex, ey, options); event('click', ex, ey, options); };
    const destroy = () => { drawing.ngOnDestroy(); workspace.ngOnDestroy(); host.remove(); animation.ngOnDestroy(); mutations.ngOnDestroy(); };
    return { preferences, editor, svg, animation, projects, mutations, drawing, tools, event, click, drag, destroy };
}

describe('construction drawing', () => {
    for(const kind of ['line', 'arc'] as const) it(`captures ${kind} stroke color and alpha with one undoable commit`, () => {
        const t = setup(kind), original = t.preferences.drawingPaint;
        try {
            t.preferences.setDrawingPaint({ fill: '#ff0000', stroke: '#12345680' });
            t.click(100, 100);
            t.preferences.setDrawingPaint({ fill: null, stroke: '#ffffff' });
            t.click(200, 100); if(kind === 'arc') t.click(100, 200);
            const path = t.svg.elements[0] as Path;
            expect((path.settings.stroke as Color).serialized).toBe('#12345680');
            expect(path.settings.fill_enabled).toBeFalse(); expect(path.settings.stroke_width).toBe(2);
            expect(t.projects.upsert).toHaveBeenCalledTimes(1);
            const saved = path.save(); t.mutations.undo(); expect(t.svg.elements.length).toBe(0);
            t.mutations.redo(); expect(t.svg.elements[0].save()).toEqual(saved);
        } finally { t.preferences.setDrawingPaint(original); t.destroy(); }
    });
    it('stages click-click lines, commits once, and restores complete geometry with undo/redo', () => {
        const t = setup();
        try {
            t.click(100, 120); t.event('mousemove', 250, 180);
            expect(t.svg.elements.length).toBe(0); expect(t.svg.tempElements.length).toBe(1);
            expect(t.projects.upsert).not.toHaveBeenCalled(); expect(t.svg.save().elements.length).toBe(0);
            t.click(250, 180);
            expect(t.svg.tempElements.length).toBe(0); expect(t.svg.elements.length).toBe(1);
            expect(t.projects.upsert).toHaveBeenCalledTimes(1);
            const path = t.svg.elements[0] as Path;
            expect(path.lines[0].points.map(p => [p.x, p.y])).toEqual([[100, 120], [250, 180]]);
            t.mutations.undo(); expect(t.svg.elements.length).toBe(0);
            t.mutations.redo(); expect((t.svg.elements[0] as Path).raw).toBe(path.raw);
        } finally { t.destroy(); }
    });
    it('supports drag creation and a 15-degree Shift constraint without a trailing click duplicate', () => {
        const t = setup();
        try {
            t.drag(100, 100, 200, 104, { shiftKey: true });
            expect(t.svg.elements.length).toBe(1); expect(t.projects.upsert).toHaveBeenCalledTimes(1);
            const end = (t.svg.elements[0] as Path).lines[0].points[1];
            expect(end.y).toBeCloseTo(100); expect(end.x).toBeCloseTo(100 + Math.hypot(100, 4));
        } finally { t.destroy(); }
    });
    it('keeps centered circles in the existing ellipse tool with Shift+Alt, preserving export and restore', () => {
        const t = setup();
        try {
            t.editor.tools.flatMap(tool => tool.children).find(tool => tool.preferenceKey === 'ellipse')!.restoreSelection();
            t.editor.keyPressed('Shift'); t.editor.keyPressed('Alt');
            t.drag(300, 250, 350, 290);
            const shape = t.svg.elements[0] as Shape;
            expect(shape.type).toBe('ellipse'); expect([shape.x, shape.y, shape.width, shape.height]).toEqual([250, 200, 100, 100]);
            expect(shape.save().settings.fill).toBe(t.editor.drawingPaint.fill); expect(buildSVGMarkup(t.svg)).toContain('<ellipse');
            expect(SVG.fromSave(t.svg.save(), t.editor).elements[0] instanceof Shape).toBeTrue();
            expect(t.projects.upsert).toHaveBeenCalledTimes(1);
        } finally { t.destroy(); }
    });
    it('constructs a quarter arc with shared endpoints and a circular tangent, and supports the complementary long arc', () => {
        const t = setup('arc');
        try {
            t.click(300, 300); t.click(400, 300);
            expect(t.svg.elements.length).toBe(0); expect(t.projects.upsert).not.toHaveBeenCalled();
            t.click(300, 450);
            const arc = t.svg.elements[0] as Path;
            expect(arc.closed).toBeFalse(); expect(arc.lines.length).toBe(1);
            const segment = arc.lines[0];
            expect(segment.points.map(p => [p.x, p.y])).toEqual([[400, 300], [300, 400]]);
            expect(segment.controlStart!.x).toBeCloseTo(400); expect(segment.controlStart!.y).toBeCloseTo(355.228475);
            t.drag(300, 300, 400, 300); t.click(300, 450, { shiftKey: true });
            const long = t.svg.elements[1] as Path;
            expect(long.lines.length).toBe(3);
            expect(long.lines[0].points[1]).toBe(long.lines[1].points[0]);
            expect(long.lines[0].controlStart!.y).toBeLessThan(300);
            expect(t.projects.upsert).toHaveBeenCalledTimes(2);
        } finally { t.destroy(); }
    });
    it('cancels zero-length, interrupted, and mode/document-switched drafts without saving', () => {
        const t = setup();
        try {
            t.click(100, 100); t.click(100, 100); t.drawing.key('Enter');
            expect(t.svg.elements.length).toBe(0); t.drawing.key('Escape'); expect(t.svg.tempElements.length).toBe(0);
            t.event('mousedown', 100, 100); t.event('mousemove', 200, 200);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            t.event('mouseup', 200, 200); t.event('click', 200, 200);
            expect(t.svg.elements.length).toBe(0);
            t.click(100, 100); t.animation.mode = 'animate'; t.drawing.validate();
            expect(t.svg.tempElements.length).toBe(0); t.click(200, 200); expect(t.svg.elements.length).toBe(0);
            t.animation.mode = 'edit'; t.click(100, 100); t.editor.selectedSVG = undefined; t.drawing.validate();
            expect(t.svg.tempElements.length).toBe(0); expect(t.projects.upsert).not.toHaveBeenCalled();
        } finally { t.destroy(); }
    });
    it('shares tangent snapping and stationary Alt bypass with pen construction', () => {
        const t = setup();
        try {
            spyOnProperty(t.editor, 'objectSnapping').and.returnValue(true);
            t.svg.elements.push(new Shape(t.editor, { type: 'ellipse', position: new Point(350, 200), width: 200, height: 200 }));
            t.svg.snapshot(); t.mutations.resetBaseline();
            t.click(200, 300); t.event('mousemove', 410, 209);
            expect(t.drawing.pointSnapFeedback?.target?.kind).toBe('tangent');
            t.editor.keyPressed('Alt'); expect(t.drawing.pointSnapFeedback).toBeUndefined();
            t.editor.keyReleased('Alt'); expect(t.drawing.pointSnapFeedback?.target?.kind).toBe('tangent');
            t.click(410, 209);
            const end = (t.svg.elements[1] as Path).lines[0].points[1];
            expect(end.x).toBeCloseTo(410); expect(end.y).toBeCloseTo(208.348486);
        } finally { t.destroy(); }
    });
    it('draws a perpendicular line to a native ellipse, supports bypass/cancellation, and undoes once', () => {
        const t = setup();
        try {
            spyOnProperty(t.editor, 'objectSnapping').and.returnValue(true);
            const ellipse = new Shape(t.editor, { type: 'ellipse', position: new Point(350, 240), width: 200, height: 120 });
            t.svg.elements.push(ellipse); t.svg.snapshot(); t.mutations.resetBaseline();
            const reference = ellipse.save();
            t.click(200, 300); t.event('mousemove', 353, 302);
            expect(t.drawing.pointSnapFeedback?.target?.kind).toBe('perpendicular');
            t.editor.keyPressed('Alt'); expect(t.drawing.pointSnapFeedback).toBeUndefined();
            t.editor.keyReleased('Alt'); expect(t.drawing.pointSnapFeedback?.target?.kind).toBe('perpendicular');
            t.editor.keyPressed('Escape'); expect(t.svg.elements.length).toBe(1); expect(t.projects.upsert).not.toHaveBeenCalled();
            t.click(200, 300); t.click(353, 302);
            const path = t.svg.elements[1] as Path;
            expect(path.lines[0].points[1].x).toBeCloseTo(350, 7); expect(path.lines[0].points[1].y).toBeCloseTo(300, 7);
            expect(ellipse.save()).toEqual(reference); expect(t.projects.upsert).toHaveBeenCalledTimes(1);
            t.mutations.undo(); expect(t.svg.elements.length).toBe(1);
            t.mutations.redo(); expect((t.svg.elements[1] as Path).raw).toBe(path.raw);
        } finally { t.destroy(); }
    });
    it('cancels staged gestures on toolbar undo, keyboard Escape, blur and tool changes, without stealing focused Enter', () => {
        const t = setup();
        const controls = new ConstructionControlsComponent(t.drawing, t.editor);
        try {
            t.drag(100, 100, 200, 200); t.click(300, 300); t.event('mousemove', 400, 400);
            t.mutations.undo(); expect(t.drawing.active).toBeFalse(); expect(t.svg.tempElements.length).toBe(0);
            t.click(300, 300); t.event('mousemove', 400, 400);
            const button = document.createElement('button'); document.body.appendChild(button);
            const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
            button.dispatchEvent(enter); button.remove();
            expect(enter.defaultPrevented).toBeFalse(); expect(t.drawing.active).toBeTrue();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(t.drawing.active).toBeFalse();
            t.click(300, 300); controls.blur(); expect(t.drawing.active).toBeFalse();
            t.click(300, 300); t.editor.tools[0].restoreSelection(); controls.ngDoCheck();
            expect(t.drawing.active).toBeFalse(); expect(t.svg.tempElements.length).toBe(0);
        } finally { controls.ngOnDestroy(); t.destroy(); }
    });
    it('switches between grouped pen and line tools without leaking previews and forwards pen snapping keys', () => {
        const t = setup();
        try {
            spyOnProperty(t.editor, 'objectSnapping').and.returnValue(true);
            t.svg.elements.push(new Shape(t.editor, { type: 'ellipse', position: new Point(350, 200), width: 200, height: 200 }));
            t.svg.snapshot(); t.mutations.resetBaseline();
            const paths = t.editor.tools.find(tool => tool.preferenceKey === 'paths')!;
            const pen = paths.children.find(tool => tool instanceof PenTool) as PenTool;
            t.click(100, 100); t.event('mousemove', 150, 150);
            pen.restoreSelection();
            expect(t.drawing.active).toBeFalse(); expect(t.svg.tempElements.length).toBe(0);
            expect(t.editor.selectedTool).toBe(paths);
            t.click(200, 300); t.event('mousemove', 410, 209);
            expect(pen.pointSnapFeedback?.target?.kind).toBe('tangent');
            t.editor.keyPressed('Alt'); expect(pen.pointSnapFeedback).toBeUndefined();
            t.editor.keyReleased('Alt'); expect(pen.pointSnapFeedback?.target?.kind).toBe('tangent');
            t.click(410, 209);
            expect((t.svg.elements[1] as Path).lines[0].points[1].y).toBeCloseTo(208.348486);
            t.tools.find(tool => tool.kind === 'line')!.restoreSelection();
            expect(pen.pointSnapFeedback).toBeUndefined(); expect(pen.tmpPath).toBeUndefined();
            expect(t.svg.tempElements.length).toBe(0);
            t.drag(100, 100, 200, 100);
            expect(t.svg.elements.length).toBe(3);
        } finally { t.destroy(); }
    });
    it('draws a line tangent to two native ellipses by adjusting both contacts with one undo', () => {
        const t = setup();
        try {
            spyOnProperty(t.editor, 'objectSnapping').and.returnValue(true);
            t.svg.elements = [new Shape(t.editor, { type: 'ellipse', position: new Point(50, 50), width: 100, height: 100 }),
                new Shape(t.editor, { type: 'ellipse', position: new Point(250, 50), width: 100, height: 100 })];
            t.svg.snapshot(); t.mutations.resetBaseline();
            t.click(60, 70); t.event('mousemove', 301, 49);
            expect(t.drawing.pointSnapFeedback?.target?.origin).toBeDefined();
            t.editor.keyPressed('Shift');
            expect(t.drawing.guide!.origin.x).toBe(60); expect(t.drawing.guide!.end.y).toBeCloseTo(70, 5);
            t.editor.keyReleased('Shift');
            t.editor.keyPressed('Alt'); expect(t.drawing.guide!.origin.x).toBe(60);
            t.editor.keyReleased('Alt'); t.click(301, 49);
            const line = (t.svg.elements[2] as Path).lines[0];
            expect(line.points[0].x).toBeCloseTo(100, 5); expect(line.points[0].y).toBeCloseTo(50, 5);
            expect(line.points[1].x).toBeCloseTo(300, 5); expect(line.points[1].y).toBeCloseTo(50, 5);
            expect(t.projects.upsert).toHaveBeenCalledTimes(1);
            t.mutations.undo(); expect(t.svg.elements.length).toBe(2);
        } finally { t.destroy(); }
    });
    it('opens construction choices and selects a tool by keyboard', () => {
        const t = setup();
        try {
            const palette = new ToolPaletteComponent(t.editor);
            const shapes = t.editor.tools.find(tool => tool.preferenceKey === 'shapes')!;
            const paths = t.editor.tools.find(tool => tool.preferenceKey === 'paths')!;
            expect(shapes.children.map(tool => tool.preferenceKey)).toEqual(['rectangle', 'ellipse', 'arc', 'regions']);
            expect(paths.children.map(tool => tool.preferenceKey)).toEqual(['pen', 'line', 'trim']);
            palette.key(new KeyboardEvent('keydown', { key: 'ArrowRight' }), paths);
            expect(paths.showChildren).toBeTrue();
            palette.key(new KeyboardEvent('keydown', { key: 'Enter' }), paths.children[0]);
            expect(paths.selectedChild?.preferenceKey).toBe('pen'); expect(paths.showChildren).toBeFalse();
            palette.key(new KeyboardEvent('keydown', { key: 'ArrowRight' }), shapes);
            expect(shapes.showChildren).toBeTrue();
            palette.key(new KeyboardEvent('keydown', { key: 'Enter' }), t.tools.find(tool => tool.kind === 'arc')!);
            expect(shapes.selectedChild?.preferenceKey).toBe('arc'); expect(shapes.showChildren).toBeFalse();
        } finally { t.destroy(); }
    });

});
