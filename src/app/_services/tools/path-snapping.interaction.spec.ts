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
import { Path } from '../../editor/objects/elements/path.object';
import { Group } from '../../editor/objects/elements/group.object';
import { Shape } from '../../editor/objects/elements/shape.object';
import { Line } from '../../editor/objects/line.object';
import { Point } from '../../editor/objects/point.object';
import { combinedMatrixFor } from '../../editor/objects/element-bounds';
import { applyMatrix } from '../../editor/objects/transform.object';
import { pathPointAnimationProperty } from '../../editor/objects/animation-targets';
import { PathAnchorInteraction } from './path-anchor.interaction';
import { PenTool } from './pen.tool';
import { SelectTool } from './select.tool';
import { EditorPage } from '../../editor/editor.page';

function setup() {
    const preferences = new EditorPreferencesService();
    const enabled = spyOnProperty(preferences, 'objectSnapping').and.returnValue(true);
    const editor = new EditorService(preferences);
    const svg = new SVG(editor, { width: 800, height: 600, pos: new Point(0, 0) }); svg.zoom = 1;
    const path = new Path(editor), target = new Path(editor);
    const a = new Point(30, 40), b = new Point(70, 40), control = new Point(40, 60);
    path.lines = [new Line(editor, { type: 'bezier', points: [a, b], controlStart: control, controlEnd: new Point(60, 60) })];
    target.lines = [new Line(editor, { points: [new Point(100, 180), new Point(180, 180)] })];
    svg.elements = [path, target]; editor.selectedSVG = svg; editor.selectedElement = path;
    spyOn(editor, 'toCanvasPoint').and.callFake((x: number | Point, y?: number) => typeof x === 'number' ? new Point(x, y ?? 0) : x);
    const zone = new NgZone({ enableLongStackTrace: false });
    const animation = new AnimationPlaybackService(editor, zone, preferences); animation.mode = 'edit';
    const gestures = new AnimationGestureService(editor, animation);
    const projects = jasmine.createSpyObj<ProjectService>('projects', ['upsert', 'get']);
    const mutations = new DocumentMutationService(editor, animation, new HistoryService(), projects);
    const reset = () => { svg.snapshot(); mutations.resetBaseline(); };
    reset();
    return { editor, svg, path, target, a, b, control, enabled, zone, animation, gestures, projects, mutations, reset };
}
const mouse = (x: number, y: number, options: MouseEventInit = {}) => new MouseEvent('mousemove', { clientX: x, clientY: y, ...options });

describe('path anchor snapping gestures', () => {
    for(const mode of ['edit', 'animate'] as const) {
        it(`keeps modifier keys inside a live ${mode} handle drag and commits only on release`, () => {
            const { editor, path, control, zone, animation, gestures, mutations, projects } = setup();
            animation.mode = mode;
            const property = pathPointAnimationProperty(control.id, 'x');
            if(mode === 'animate') {
                animation.seek(1);
                animation.upsertKeyframe(path, property, 'number', 50, 40);
                mutations.commit('animation');
                projects.upsert.calls.reset();
            }
            mutations.resetBaseline();
            const baseline = mutations.captureState();
            const capture = spyOn(mutations, 'captureState').and.callThrough();
            const viewport = document.createElement('div'), target = document.createElement('div');
            target.dataset['pointRole'] = 'control-start'; target.dataset['pointId'] = control.id;
            target.dataset['lineId'] = path.lines[0].id;
            viewport.append(target); document.body.append(viewport);
            editor.selectedTool = new SelectTool(editor);
            const workspace = new CanvasWorkspaceComponent(editor, mutations, zone, new ElementRef(viewport), gestures);
            workspace.ngAfterViewInit();
            const page = new EditorPage({ hidesArtworkHandles: false } as any, {} as any, editor, animation, mutations, projects,
                { selectedLayers: [path] } as any, {} as any, {} as any, {} as any, { handleKey: () => false } as any, { active: false } as any);
            const keyboard = (event: KeyboardEvent) => page.handleKeyDown(event);
            const keyup = (event: KeyboardEvent) => page.handleKeyUp(event);
            document.addEventListener('keydown', keyboard);
            document.addEventListener('keyup', keyup);
            try {
                target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: control.x, clientY: control.y }));
                document.dispatchEvent(mouse(65, 75, { bubbles: true }));
                expect([control.x, control.y]).toEqual([65, 75]);
                for(const key of ['Control', 'Shift', 'Meta', 'Alt']) {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
                    expect(editor.keysDown[key]).toBeTrue();
                    expect([control.x, control.y]).withContext(key).toEqual([65, 75]);
                    document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
                    expect(editor.keysDown[key]).toBeUndefined();
                }
                expect(capture).not.toHaveBeenCalled();
                expect(projects.upsert).not.toHaveBeenCalled();
                document.dispatchEvent(mouse(75, 85, { bubbles: true }));
                document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                expect([control.x, control.y]).toEqual([75, 85]);
                expect(projects.upsert).toHaveBeenCalledTimes(1);
                if(mode === 'animate') {
                    expect(editor.selectedSVG!.animation.tracks.find(track => track.property === property)!.keyframes.at(-1)!.value).toBe(75);
                }
                mutations.undo();
                expect(mutations.captureState()).toBe(baseline);
            } finally {
                document.removeEventListener('keydown', keyboard);
                document.removeEventListener('keyup', keyup);
                workspace.ngOnDestroy(); viewport.remove(); animation.ngOnDestroy(); mutations.ngOnDestroy();
            }
        });
    }

    it('moves an anchor onto an interior crossing without modifying reference geometry and undoes once', () => {
        const { editor, svg, path, target, a, mutations, reset } = setup();
        target.lines.push(new Line(editor, { points: [new Point(125, 120), new Point(125, 220)] })); reset();
        const reference = target.save(), drag = new PathAnchorInteraction(editor);
        drag.begin(path, a, new Point(30, 40)); drag.update(new Point(123, 178), false);
        expect([a.x, a.y]).toEqual([125, 180]); expect(drag.feedback?.target?.kind).toBe('intersection');
        drag.end(); expect(target.save()).toEqual(reference); expect(mutations.commit()).toBeTrue();
        mutations.undo(); expect((editor.selectedElement as Path).lines[0].points[0].x).toBe(30);
    });
    it('preserves grab offset, moves attached handles once, and commits one undoable deformation', () => {
        const { editor, path, a, b, control, mutations, projects } = setup();
        const drag = new PathAnchorInteraction(editor);
        expect(drag.begin(path, a, new Point(32, 41))).toBeTrue();
        drag.update(new Point(141, 180), false);
        expect([a.x, a.y, control.x, control.y]).toEqual([140, 180, 150, 200]);
        expect([b.x, b.y]).toEqual([70, 40]); expect(drag.feedback?.target?.kind).toBe('midpoint');
        drag.setBypass(true); expect([a.x, a.y]).toEqual([139, 179]); expect(drag.feedback).toBeUndefined();
        drag.setBypass(false); expect([a.x, a.y]).toEqual([140, 180]);
        drag.end(); expect(drag.feedback).toBeUndefined();
        expect(mutations.commit()).toBeTrue(); expect(mutations.commit()).toBeFalse(); expect(projects.upsert).toHaveBeenCalledTimes(1);
        mutations.undo(); expect((editor.selectedElement as Path).lines[0].points[0].x).toBe(30);
        mutations.redo(); expect((editor.selectedElement as Path).lines[0].points[0].x).toBe(140);
    });

    it('projects through a reflected, rotated parent while keeping untouched anchors visually fixed', () => {
        const { editor, svg, path, target, a, b } = setup();
        const group = new Group(editor); group.elements = [path]; group.transform.scaleX = -2; group.transform.rotation = 35;
        path.transform.rotation = 20; svg.elements = [group, target];
        const baseline = svg.save(), matrix = combinedMatrixFor(svg.elements, path);
        const start = applyMatrix(matrix, a.x, a.y), other = applyMatrix(matrix, b.x, b.y);
        const drag = new PathAnchorInteraction(editor); drag.begin(path, a, new Point(start.x, start.y)); drag.update(new Point(137, 177), false);
        const after = combinedMatrixFor(svg.elements, path);
        expect(applyMatrix(after, a.x, a.y).x).toBeCloseTo(140, 7); expect(applyMatrix(after, a.x, a.y).y).toBeCloseTo(180, 7);
        expect(applyMatrix(after, b.x, b.y).x).toBeCloseTo(other.x, 7); expect(applyMatrix(after, b.x, b.y).y).toBeCloseTo(other.y, 7);
        drag.cancel(); expect(svg.save()).toEqual(baseline);
    });

    it('restores exact point identities and automatic origins on return, click-only, and a snap back to the start', () => {
        const { editor, svg, path, a, mutations, reset } = setup();
        svg.guides = [{ id: 'x', axis: 'x', value: 30 }, { id: 'y', axis: 'y', value: 40 }]; reset();
        const baseline = svg.save(), drag = new PathAnchorInteraction(editor);
        for(const point of [new Point(30, 40), new Point(32, 41)]) {
            drag.begin(path, a, new Point(30, 40)); drag.update(new Point(137, 177), false); drag.update(point, false); drag.end();
            expect(svg.save()).toEqual(baseline); expect(path.lines[0].points[0]).toBe(a); expect(mutations.commit()).toBeFalse();
        }
        drag.begin(path, a, new Point(30, 40)); drag.end(); expect(svg.save()).toEqual(baseline);
    });

    it('respects disabled snapping and refuses inherited locks, motion, and singular transforms', () => {
        const { editor, svg, path, target, a, enabled } = setup(); const drag = new PathAnchorInteraction(editor);
        enabled.and.returnValue(false); drag.begin(path, a, new Point(30, 40)); drag.update(new Point(137, 177), false);
        expect([a.x, a.y]).toEqual([137, 177]); drag.cancel();
        const group = new Group(editor); group.elements = [path]; svg.elements = [group, target];
        group.locked = true; expect(drag.begin(path, a, a)).toBeFalse(); group.locked = false;
        group.motion.pathId = target.id; expect(drag.begin(path, a, a)).toBeFalse(); group.motion.pathId = null;
        group.transform.scaleX = 0; expect(drag.begin(path, a, a)).toBeFalse();
    });

    it('captures snapped animation point keys without changing saved base geometry', () => {
        const { editor, svg, path, a, animation, gestures, mutations, projects } = setup();
        animation.mode = 'animate'; animation.seek(1); gestures.begin();
        const drag = new PathAnchorInteraction(editor); drag.begin(path, a, new Point(30, 40)); drag.update(new Point(137, 177), false); drag.end();
        gestures.end(); mutations.commit();
        expect(svg.animation.tracks.find((track) => track.property === pathPointAnimationProperty(a.id, 'x'))?.keyframes.map((key) => key.value)).toEqual([30, 140]);
        expect((mutations.captureSave()!.elements[0] as ReturnType<Path['save']>).contours![0].lines[0].points[0].x).toBe(30);
        expect(projects.upsert).toHaveBeenCalledTimes(1); animation.ngOnDestroy();
    });

    it('routes anchor moves, immediate Alt bypass, Escape, blur, and outside release through the canvas boundary', () => {
        const { editor, svg, a, zone, gestures, mutations, projects } = setup();
        const baseline = svg.save(), viewport = document.createElement('div'), target = document.createElement('div');
        target.dataset['pointRole'] = 'anchor'; target.dataset['pointId'] = a.id; viewport.append(target); document.body.append(viewport);
        const tool = new SelectTool(editor); editor.selectedTool = tool;
        const workspace = new CanvasWorkspaceComponent(editor, mutations, zone, new ElementRef(viewport), gestures); workspace.ngAfterViewInit();
        const down = () => target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 30, clientY: 40 }));
        const move = () => document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 137, clientY: 177 }));
        const up = () => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        try {
            down(); move(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true })); expect(a.x).toBe(137);
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true })); expect(a.x).toBe(140);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); up();
            expect(svg.save()).toEqual(baseline); expect(tool.pointSnapFeedback).toBeUndefined();
            down(); move(); window.dispatchEvent(new Event('blur')); up(); expect(svg.save()).toEqual(baseline);
            expect(projects.upsert).not.toHaveBeenCalled(); down(); move(); up(); expect(projects.upsert).toHaveBeenCalledTimes(1);
        } finally { workspace.ngOnDestroy(); viewport.remove(); }
    });

    it('preserves Alt-before-drag anchor conversion and keeps Bézier controls out of point snapping', () => {
        const { editor, path, a } = setup(); const tool = new SelectTool(editor);
        const target = document.createElement('div'); target.dataset['pointRole'] = 'anchor'; target.dataset['pointId'] = a.id;
        const down = mouse(30, 40, { altKey: true }); Object.defineProperty(down, 'target', { value: target });
        tool.down(down); expect(tool.movingPointRole).toBe('anchor-convert'); tool.drag(mouse(137, 177, { altKey: true }));
        expect([a.x, a.y]).toEqual([30, 40]); expect(path.lines[0].controlStart?.x).toBe(-77); expect(tool.pointSnapFeedback).toBeUndefined(); tool.up(mouse(137, 177));
    });
});

describe('pen point snapping', () => {
    it('snaps straight Pen segments to either circle normal across zoom, retaining hysteresis and Alt bypass', () => {
        for(const zoom of [.5, 1, 2]) for(const x of [150, 250]) {
            const t = setup();
            try {
                const circle = new Shape(t.editor, { type: 'ellipse', position: new Point(150, 150), width: 100, height: 100 });
                circle.locked = true; t.svg.elements = [circle]; t.svg.zoom = zoom;
                const reference = circle.save(), pen = new PenTool(t.editor);
                pen.click(mouse(100, 200)); pen.drag(mouse(x + 3 / zoom, 200 + 2 / zoom));
                expect(pen.pointSnapFeedback?.target?.kind).toBe('perpendicular');
                pen.drag(mouse(x + 8 / zoom, 200)); expect(pen.pointSnapFeedback?.target?.kind).toBe('perpendicular');
                pen.keyPressed('Alt'); expect(pen.pointSnapFeedback).toBeUndefined();
                pen.drag(mouse(x + 3 / zoom, 200 + 2 / zoom, { altKey: true })); pen.keyReleased('Alt');
                expect(pen.pointSnapFeedback?.target?.kind).toBe('perpendicular');
                pen.down(mouse(x + 3 / zoom, 200 + 2 / zoom)); pen.up(mouse(x + 3 / zoom, 200 + 2 / zoom)); pen.click(mouse(x + 3 / zoom, 200 + 2 / zoom));
                const endpoint = (t.editor.activeElement as Path).lines[0].points[1];
                expect(endpoint.x).toBeCloseTo(x, 7); expect(endpoint.y).toBeCloseTo(200, 7);
                expect(circle.save()).toEqual(reference);
            } finally { t.mutations.ngOnDestroy(); t.animation.ngOnDestroy(); }
        }
    });

    for(const collapseHandles of [false, true]) it(`keeps every straight corner roundable after closing a Pen path (collapsed handles: ${collapseHandles})`, () => {
        const { editor, svg, enabled } = setup(); enabled.and.returnValue(false); svg.elements = []; editor.activeElement = undefined;
        const pen = new PenTool(editor);
        pen.click(mouse(300, 300));
        if(collapseHandles) {
            // Pull a handle and return it to its anchor before releasing: visually straight, still a cubic.
            pen.down(mouse(400, 300)); pen.drag(mouse(405, 300)); pen.drag(mouse(400, 300)); pen.up(mouse(400, 300));
        }
        pen.click(mouse(400, 300)); pen.click(mouse(400, 400)); pen.click(mouse(300, 400)); pen.click(mouse(300, 300));
        const path = editor.selectedElement as Path;
        expect(path.closed).toBeTrue(); expect(path.lines.length).toBe(4);
        const anchors = path.lines.map(line => line.points[0]);
        expect(anchors.every(anchor => path.cornerEligible(anchor))).toBeTrue();
        const before = path.save();
        anchors.forEach(anchor => anchor.cornerRadius = 10);
        expect(path.raw.match(/C /g)?.length).toBe(4);
        expect(path.raw).toContain('M 310 300'); expect(path.raw).toContain('L 390 300 C');
        expect(path.raw).toContain('L 400 390 C'); expect(path.raw).toContain('L 310 400 C');
        expect(path.raw).toContain('L 300 310 C');
        anchors.forEach(anchor => anchor.cornerRadius = 0); expect(path.save()).toEqual(before);
    });

    it('previews and commits either native-circle tangent at every zoom, with bypass and no conversion', () => {
        for(const zoom of [.5, 1, 2]) for(const sign of [-1, 1]) {
            const { editor, svg, enabled } = setup();
            const circle = new Shape(editor, { type: 'ellipse', position: new Point(150, 150), width: 100, height: 100 });
            circle.locked = true; svg.elements = [circle]; svg.zoom = zoom;
            const reference = circle.save(), pen = new PenTool(editor), y = 200 + sign * 25 * Math.sqrt(3);
            pen.click(mouse(100, 200)); pen.drag(mouse(175 + 2 / zoom, y + 2 / zoom));
            expect(pen.pointSnapFeedback?.target?.kind).toBe('tangent');
            expect(pen.tmpPath!.lines[0].points[1].x).toBeCloseTo(175, 8);
            expect(pen.tmpPath!.lines[0].points[1].y).toBeCloseTo(y, 8);
            pen.keyPressed('Alt'); expect(pen.pointSnapFeedback).toBeUndefined();
            pen.keyReleased('Alt'); expect(pen.pointSnapFeedback?.target?.kind).toBe('tangent');
            enabled.and.returnValue(false); pen.drag(mouse(177, y + 2)); expect(pen.pointSnapFeedback).toBeUndefined();
            enabled.and.returnValue(true); pen.drag(mouse(175, y));
            pen.down(mouse(175, y)); pen.up(mouse(175, y)); pen.click(mouse(175, y));
            const placed = (editor.activeElement as Path).lines[0].points[1];
            expect(placed.x).toBeCloseTo(175, 8); expect(placed.y).toBeCloseTo(y, 8);
            expect(circle.save()).toEqual(reference); expect(svg.elements[0]).toBe(circle);
        }
    });

    it('does not offer a native-circle tangent when starting inside it', () => {
        const { editor, svg } = setup();
        svg.elements = [new Shape(editor, { type: 'ellipse', position: new Point(150, 150), width: 100, height: 100 })];
        const pen = new PenTool(editor); pen.click(mouse(200, 200)); pen.drag(mouse(175, 157));
        expect(pen.pointSnapFeedback?.target).toBeUndefined();
    });

    it('places tangent and perpendicular straight segments with bypass and no reference mutation', () => {
        for(const kind of ['tangent', 'perpendicular'] as const) {
            const { editor, target } = setup();
            target.lines = [new Line(editor, { type: 'bezier', points: [new Point(100, 100), new Point(200, 100)],
                controlStart: new Point(100, 200), controlEnd: new Point(200, 200) })];
            const reference = target.save(), pen = new PenTool(editor);
            pen.click(kind === 'tangent' ? mouse(50, 175) : mouse(150, 250));
            pen.drag(mouse(148, 173));
            expect(pen.pointSnapFeedback?.target?.kind).toBe(kind);
            expect(pen.tmpPath!.lines[0].points[1].x).toBeCloseTo(150, 6);
            pen.keyPressed('Alt'); expect(pen.tmpPath!.lines[0].points[1].x).toBe(148);
            pen.keyReleased('Alt'); expect(pen.pointSnapFeedback?.target?.kind).toBe(kind);
            pen.down(mouse(148, 173)); pen.up(mouse(148, 173)); pen.click(mouse(148, 173));
            const placed = (editor.activeElement as Path).lines[0];
            expect(placed.type).toBe('line'); expect(placed.points[1].y).toBeCloseTo(175, 6);
            expect(target.save()).toEqual(reference);
        }
    });

    it('does not claim a straight-line contact while shaping a Bézier segment', () => {
        const { editor, target } = setup();
        target.lines = [new Line(editor, { type: 'bezier', points: [new Point(100, 100), new Point(200, 100)],
            controlStart: new Point(100, 200), controlEnd: new Point(200, 200) })];
        const pen = new PenTool(editor); pen.click(mouse(50, 175)); pen.down(mouse(148, 173));
        expect(pen.pointSnapFeedback?.target?.kind).toBe('tangent');
        pen.drag(mouse(180, 190)); expect(pen.pointSnapFeedback).toBeUndefined();
        pen.up(mouse(180, 190));
        expect((editor.activeElement as Path).lines[0].type).toBe('bezier');
        pen.drag(mouse(148, 173)); expect(pen.pointSnapFeedback?.target?.kind).not.toBe('tangent');
    });

    it('previews and places interiors and crossings while keeping independent topology', () => {
        const { editor, target } = setup(); const pen = new PenTool(editor);
        target.lines.push(new Line(editor, { points: [new Point(125, 120), new Point(125, 220)] }));
        const reference = target.save(); pen.click(mouse(240, 240));
        pen.drag(mouse(163, 183)); expect(pen.pointSnapFeedback?.target?.kind).toBe('path');
        pen.down(mouse(163, 183)); pen.up(mouse(163, 183)); pen.click(mouse(163, 183));
        expect((editor.activeElement as Path).lines[0].points[1].y).toBe(180);
        pen.drag(mouse(123, 178)); expect(pen.pointSnapFeedback?.target?.kind).toBe('intersection');
        pen.down(mouse(123, 178)); pen.up(mouse(123, 178)); pen.click(mouse(123, 178));
        const placed = (editor.activeElement as Path).lines[1].points[1];
        expect([placed.x, placed.y]).toEqual([125, 180]); expect(target.save()).toEqual(reference);
        expect(target.lines.flatMap((line) => line.points)).not.toContain(placed);
    });
    it('keeps the preview target through mouse release until the click commits the point', () => {
        const { editor } = setup(); const pen = new PenTool(editor);
        pen.click(mouse(240, 240)); pen.drag(mouse(137, 177)); pen.drag(mouse(148, 180));
        expect(pen.tmpPath!.lines[0].points[1].x).toBe(140);
        pen.down(mouse(148, 180)); pen.up(mouse(148, 180)); pen.click(mouse(148, 180));
        expect((editor.activeElement as Path).lines[0].points[1].x).toBe(140);
    });
    it('refreshes targets when a document appears after the initial empty-canvas hover', () => {
        const { editor, svg } = setup(); const pen = new PenTool(editor);
        editor.selectedSVG = undefined; pen.drag(mouse(137, 177));
        editor.selectedSVG = svg; pen.drag(mouse(137, 177));
        expect(pen.pointSnapFeedback?.target?.kind).toBe('midpoint');
    });
    it('previews and places midpoint targets without sharing anchor identity across paths', () => {
        const { editor, svg, target } = setup(); const pen = new PenTool(editor);
        pen.drag(mouse(137, 177)); expect(pen.pointSnapFeedback?.target?.kind).toBe('midpoint');
        pen.click(mouse(137, 177)); const path = editor.activeElement as Path;
        expect(path.lines[0].points[0]).toEqual(jasmine.objectContaining({ x: 140, y: 180 }));
        pen.drag(mouse(99, 181)); expect(pen.pointSnapFeedback?.target?.kind).toBe('anchor');
        pen.click(mouse(99, 181)); expect(path.lines[0].points[1]).not.toBe(target.lines[0].points[0]);
        expect(path.lines[0].points[1].id).not.toBe(target.lines[0].points[0].id);
        pen.contextMenu(mouse(0, 0)); expect(path.lines.length).toBe(1); expect(svg.tempElements.length).toBe(0); expect(pen.pointSnapFeedback).toBeUndefined();
    });

    it('refreshes an unsnapped pen preview with Alt and honors the magnet preference and legacy Ctrl bypass', () => {
        const { editor, enabled } = setup(); const pen = new PenTool(editor);
        pen.click(mouse(240, 240)); pen.drag(mouse(137, 177)); expect(pen.tmpPath!.lines[0].points[1].x).toBe(140);
        pen.keyPressed('Alt'); expect(pen.tmpPath!.lines[0].points[1].x).toBe(137); expect(pen.pointSnapFeedback).toBeUndefined();
        pen.keyReleased('Alt'); expect(pen.tmpPath!.lines[0].points[1].x).toBe(140);
        pen.click(mouse(137, 177, { altKey: true })); expect((editor.activeElement as Path).lines[0].points[1].x).toBe(137);
        enabled.and.returnValue(false); pen.drag(mouse(99, 181)); expect(pen.tmpPath!.lines[0].points[1].x).toBe(99);
        enabled.and.returnValue(true); pen.drag(mouse(99, 181, { ctrlKey: true })); expect(pen.tmpPath!.lines[0].points[1].x).toBe(99);
        pen.leave(); expect(pen.pointSnapFeedback).toBeUndefined();
    });

    it('keeps the snapped anchor fixed while pulling curve handles and can cancel the pending gesture', () => {
        const { editor, svg } = setup(); const pen = new PenTool(editor);
        pen.click(mouse(240, 240)); const baseline = svg.save();
        pen.down(mouse(137, 177)); pen.drag(mouse(137, 177)); expect(pen.draggingBezier).toBeFalse();
        pen.drag(mouse(165, 205)); pen.reset(); expect(svg.save()).toEqual(baseline);
        pen.click(mouse(165, 205)); expect(svg.save()).toEqual(baseline); // native click following cancelled release
        pen.down(mouse(137, 177)); pen.drag(mouse(165, 205)); pen.up(mouse(165, 205)); pen.click(mouse(165, 205));
        const path = editor.activeElement as Path;
        expect(path.lines[0].points[1]).toEqual(jasmine.objectContaining({ x: 140, y: 180 }));
        expect(path.lines[0].controlEnd).toEqual(jasmine.objectContaining({ x: 165, y: 205 }));
    });

    it('closes a path within screen-pixel tolerance using the original shared start point', () => {
        const { editor, svg } = setup(); const pen = new PenTool(editor); svg.zoom = 2;
        pen.click(mouse(240, 240)); pen.click(mouse(300, 240)); pen.click(mouse(300, 280));
        const path = editor.activeElement as Path, first = path.lines[0].points[0];
        pen.drag(mouse(242, 242)); pen.click(mouse(242, 242));
        expect(path.closed).toBeTrue(); expect(path.lines.at(-1)!.points[1]).toBe(first); expect(editor.activeElement).toBeUndefined();
    });

    it('resumes a partial pen path without dropping the working segment', () => {
        const { editor } = setup(); const pen = new PenTool(editor);
        pen.click(mouse(240, 240)); pen.click(mouse(300, 240)); const path = editor.activeElement as Path;
        pen.deselect(); pen.onselect(); pen.click(mouse(340, 280)); pen.contextMenu(mouse(0, 0));
        expect(path.lines.length).toBe(2); expect(path.lines[1].points[1]).toEqual(jasmine.objectContaining({ x: 340, y: 280 }));
    });
});

describe('ellipse curve joins and common tangent interactions', () => {
    it('aligns a moved curve endpoint handle, preserves length, and restores exact geometry on bypass and cancellation', () => {
        const { editor, svg, path, b } = setup();
        svg.elements = [path, new Shape(editor, { type: 'ellipse', position: new Point(150, 150), width: 100, height: 100 })];
        const before = path.save(), handle = path.lines[0].controlEnd!, length = Math.hypot(handle.x - b.x, handle.y - b.y);
        const drag = new PathAnchorInteraction(editor);
        drag.begin(path, b, new Point(b.x, b.y)); drag.update(new Point(252, 200), false);
        expect(b.x).toBeCloseTo(250, 5); expect(b.y).toBeCloseTo(200, 5);
        expect(handle.x).toBeCloseTo(b.x, 5); expect(Math.hypot(handle.x - b.x, handle.y - b.y)).toBeCloseTo(length, 8);
        expect(drag.feedback?.target?.tangent).toBeDefined();
        drag.setBypass(true); expect(b.x).toBe(252); expect(drag.feedback).toBeUndefined();
        drag.setBypass(false); expect(handle.x).toBeCloseTo(b.x, 5);
        drag.cancel(); expect(path.save()).toEqual(before);
    });
    it('snaps a newly drawn curve endpoint and handle to an ellipse, including stationary Alt bypass', () => {
        const { editor, svg } = setup();
        svg.elements = [new Shape(editor, { type: 'ellipse', position: new Point(150, 150), width: 100, height: 100 })];
        const pen = new PenTool(editor);
        pen.click(mouse(350, 100)); pen.down(mouse(252, 200)); pen.drag(mouse(280, 240));
        expect(pen.pendingPoint!.x).toBeCloseTo(250, 5);
        expect(pen.tmpPath!.lines[0].controlEnd!.x).toBeCloseTo(250, 5);
        expect(pen.pointSnapFeedback?.target?.tangent).toBeDefined();
        pen.keyPressed('Alt'); expect(pen.pendingPoint!.x).toBe(252); expect(pen.pointSnapFeedback).toBeUndefined();
        pen.keyReleased('Alt'); expect(pen.pendingPoint!.x).toBeCloseTo(250, 5);
        pen.up(mouse(280, 240)); pen.click(mouse(280, 240));
        const line = (editor.activeElement as Path).lines[0];
        expect(line.controlEnd!.x).toBeCloseTo(line.points[1].x, 5);
        expect(line.controlEnd!.y).toBeGreaterThan(line.points[1].y);
    });
    it('moves both ends of the first straight Pen segment onto a common tangent and restores the start during bypass', () => {
        const { editor, svg } = setup();
        svg.elements = [new Shape(editor, { type: 'ellipse', position: new Point(50, 50), width: 100, height: 100 }),
            new Shape(editor, { type: 'ellipse', position: new Point(250, 50), width: 100, height: 100 })];
        const pen = new PenTool(editor); pen.click(mouse(60, 70)); pen.drag(mouse(301, 49));
        expect(pen.pointSnapFeedback?.target?.origin).toBeDefined();
        expect(pen.workingLine!.points[0].x).toBeCloseTo(100, 5); expect(pen.workingLine!.points[0].y).toBeCloseTo(50, 5);
        pen.keyPressed('Alt'); expect(pen.workingLine!.points[0].x).toBe(60);
        pen.keyReleased('Alt'); pen.click(mouse(301, 49));
        const line = (editor.activeElement as Path).lines[0];
        expect(line.points[0].y).toBeCloseTo(50, 5); expect(line.points[1].y).toBeCloseTo(50, 5);
    });
});
