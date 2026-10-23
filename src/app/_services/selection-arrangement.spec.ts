import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { faCircleInfo } from '@fortawesome/free-solid-svg-icons';
import { SelectionActionsComponent } from '../_components/selection-actions/selection-actions.component';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { HistoryService } from './history.service';
import { ProjectService } from './project.service';
import { ElementFactory } from './element-factory.service';
import { LayerOperationsService } from './layer-operations.service';
import { ObjectClipboardService } from './object-clipboard.service';
import { ObjectClipboardCommandService } from './object-clipboard-command.service';
import { SelectionArrangementService } from './selection-arrangement.service';
import { Group } from '../editor/objects/elements/group.object';
import { Shape } from '../editor/objects/elements/shape.object';
import { Path } from '../editor/objects/elements/path.object';
import { Line } from '../editor/objects/line.object';
import { Point } from '../editor/objects/point.object';
import { SVG } from '../editor/objects/svg.object';
import { GradientPaint } from '../editor/objects/paint.object';
import { Color } from '../editor/objects/color.object';
import { combinedMatrixFor, localBounds } from '../editor/objects/element-bounds';
import { combinedMotionAdjustedMatrixFor } from '../editor/objects/motion-path.object';
import { transformedBounds } from '../editor/objects/transform.object';
import { captureObjectClipboard, instantiateObjectClipboard } from '../editor/object-clipboard';
import { arrangementBounds } from '../editor/objects/arrangement-bounds';

function setup(clipboard = new ObjectClipboardService()) {
    const preferences = new EditorPreferencesService();
    const editor = new EditorService(preferences);
    const svg = new SVG(editor, { width: 400, height: 300, pos: new Point(0, 0) });
    const first = new Shape(editor, { type: 'rectangle', position: new Point(10, 20), width: 30, height: 40 });
    const second = new Shape(editor, { type: 'rectangle', position: new Point(90, 60), width: 20, height: 20 });
    const third = new Shape(editor, { type: 'rectangle', position: new Point(200, 120), width: 40, height: 50 });
    svg.elements = [first, second, third];
    editor.selectedSVG = svg;
    editor.selectedElements = [first, second, third];
    const animation = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences);
    animation.mode = 'edit';
    const projects = jasmine.createSpyObj<ProjectService>('projects', ['get', 'upsert']);
    const mutations = new DocumentMutationService(editor, animation, new HistoryService(), projects);
    const factory = new ElementFactory(editor);
    const layers = new LayerOperationsService(editor, factory);
    const commands = new ObjectClipboardCommandService(editor, animation, mutations, layers, clipboard);
    const arrangement = new SelectionArrangementService(editor, animation, mutations);
    const baseline = () => { svg.snapshot(); mutations.resetBaseline(); };
    baseline();
    return { editor, svg, first, second, third, animation, projects, mutations, factory, commands, arrangement, baseline };
}

const bounds = (svg: SVG, element: Shape | Group | Path) => transformedBounds(localBounds(element), combinedMatrixFor(svg.elements, element));

describe('selection arrangement', () => {
    it('aligns actual curve extrema rather than Bezier control handles without changing the pivot', () => {
        const { editor, svg, arrangement } = setup();
        const path = new Path(editor);
        path.lines = [new Line(editor, { type: 'bezier', points: [new Point(0, 0), new Point(100, 0)],
            controlStart: new Point(0, 100), controlEnd: new Point(100, 100) })];
        svg.elements = [path]; editor.selectedElements = [path];
        expect(arrangementBounds(svg, path).height).toBeCloseTo(75, 7);
        arrangement.align('bottom');
        const result = arrangementBounds(svg, path);
        expect(result.y + result.height).toBeCloseTo(300, 7);
        expect(path.transform.translateY).toBeCloseTo(225, 7);
        expect(path.transform.originX).toBeUndefined();
    });

    it('measures a rotated ellipse by its curve instead of the corners of its frame', () => {
        const { editor, svg } = setup();
        const ellipse = new Shape(editor, { type: 'ellipse', position: new Point(0, 0), width: 80, height: 20 });
        ellipse.transform.rotation = 45; svg.elements = [ellipse];
        const result = arrangementBounds(svg, ellipse);
        expect(result.width).toBeCloseTo(Math.sqrt(3400), 7);
        expect(result.height).toBeCloseTo(result.width, 7);
    });

    it('aligns to selection once, skips no-ops and restores selected IDs through undo/redo', () => {
        const { editor, svg, first, second, third, arrangement, mutations, projects } = setup();
        const ids = editor.selectedElements.map((element) => element.id);
        arrangement.align('left');
        expect([first, second, third].map((element) => bounds(svg, element).x)).toEqual([10, 10, 10]);
        expect(projects.upsert).toHaveBeenCalledTimes(1);
        arrangement.align('left');
        expect(projects.upsert).toHaveBeenCalledTimes(1);
        mutations.undo();
        expect(editor.selectedElements.map((element) => element.id)).toEqual(ids);
        expect(bounds(svg, svg.elements[1] as Shape).x).toBe(90);
        mutations.redo();
        expect(bounds(svg, svg.elements[1] as Shape).x).toBe(10);
    });

    it('aligns one object to an offset canvas and uses the last selected object as a fixed reference', () => {
        const { editor, svg, first, second, arrangement } = setup();
        svg.viewBoxX = -100; svg.viewBoxY = 80;
        editor.selectedElements = [first];
        arrangement.align('right'); arrangement.align('centerY');
        expect(bounds(svg, first).x + first.width).toBe(300);
        expect(bounds(svg, first).y + first.height / 2).toBe(230);
        editor.selectedElements = [first, second];
        arrangement.reference = 'last';
        const reference = JSON.stringify(second.save());
        arrangement.align('centerX');
        expect(bounds(svg, first).x + first.width / 2).toBe(bounds(svg, second).x + second.width / 2);
        expect(JSON.stringify(second.save())).toBe(reference);
    });

    it('distributes unequal sizes by edge gaps while fixing endpoints', () => {
        const { svg, first, second, third, arrangement, projects } = setup();
        arrangement.distribute('x');
        expect(bounds(svg, second).x).toBe(110);
        expect(bounds(svg, first).x).toBe(10);
        expect(bounds(svg, third).x).toBe(200);
        arrangement.distribute('y');
        expect(bounds(svg, second).y).toBe(80);
        expect(bounds(svg, first).y).toBe(20);
        expect(bounds(svg, third).y).toBe(120);
        expect(projects.upsert).toHaveBeenCalledTimes(2);
    });

    it('translates through reflected and rotated parents without moving unselected siblings', () => {
        const { editor, svg, first, second, third, arrangement, baseline } = setup();
        const left = new Group(editor), right = new Group(editor);
        left.elements = [first, third]; left.transform.rotation = 33; left.transform.scaleX = -2;
        right.elements = [second]; right.transform.rotation = -24; right.transform.scaleY = 1.8;
        svg.elements = [left, right]; editor.selectedElements = [first, second];
        const unselectedBefore = bounds(svg, third);
        baseline(); arrangement.align('top');
        expect(bounds(svg, first).y).toBeCloseTo(bounds(svg, second).y, 7);
        expect(bounds(svg, third).x).toBeCloseTo(unselectedBefore.x, 7);
        expect(bounds(svg, third).y).toBeCloseTo(unselectedBefore.y, 7);
    });

    it('filters selected descendants, honors inherited locks and disables motion/Animate arrangement', () => {
        const { editor, svg, first, second, arrangement, animation, projects } = setup();
        const group = new Group(editor); group.elements = [first]; svg.elements = [group, second];
        editor.selectedElements = [group, first, second];
        expect(arrangement.count).toBe(2);
        group.locked = true; editor.selectedElements = [first];
        expect(arrangement.available).toBeFalse();
        editor.selectedElements = [second]; second.motion.pathId = 'path';
        expect(arrangement.available).toBeFalse();
        second.motion.pathId = null; animation.mode = 'animate';
        arrangement.align('left');
        expect(projects.upsert).not.toHaveBeenCalled();
    });
});

describe('object clipboard', () => {
    it('copies without mutating, survives project changes, and pastes independent IDs in one undo step', () => {
        const clipboard = new ObjectClipboardService();
        const source = setup(clipboard), destination = setup(clipboard);
        source.editor.selectedElements = [source.first, source.second];
        const original = JSON.stringify(source.svg.save());
        expect(source.commands.copy()).toBeTrue();
        expect(JSON.stringify(source.svg.save())).toBe(original);
        expect(source.projects.upsert).not.toHaveBeenCalled();
        source.first.transform.translateX = 1000; // Clipboard is a snapshot, not a live reference.
        destination.commands.paste(true);
        expect(destination.svg.elements.length).toBe(5);
        expect(destination.editor.selectedElements.length).toBe(2);
        expect(bounds(destination.svg, destination.editor.selectedElements[0] as Shape).x).toBe(10);
        expect(destination.projects.upsert).toHaveBeenCalledTimes(1);
        const ids = destination.editor.selectedElements.map((element) => element.id);
        expect(ids).not.toContain(source.first.id);
        destination.mutations.undo(); expect(destination.svg.elements.length).toBe(3);
        destination.mutations.redo(); expect(destination.svg.elements.length).toBe(5);
        destination.commands.paste();
        expect(destination.editor.selectedElements.every((element) => !ids.includes(element.id))).toBeTrue();
        expect(bounds(destination.svg, destination.editor.selectedElements[0] as Shape).x).toBe(20);
        destination.commands.paste();
        expect(bounds(destination.svg, destination.editor.selectedElements[0] as Shape).x).toBe(30);
    });

    it('keeps pruned parent transforms, opacity and draw order without copying siblings', () => {
        const { editor, svg, first, second, third, commands } = setup();
        const inner = new Group(editor), outer = new Group(editor);
        inner.elements = [first, second]; inner.transform.rotation = 30; inner.transform.scaleX = -1.5;
        outer.elements = [inner]; outer.transform.rotation = 40; outer.transform.scaleY = .7; outer.opacity = .4;
        svg.elements = [outer, third]; editor.selectedElements = [first];
        const before = bounds(svg, first);
        commands.copy(); commands.paste(true);
        const copy = editor.selectedElement as Group;
        const copiedInner = copy.elements[0] as Group;
        expect(copy.opacity).toBe(.4);
        expect(copiedInner.elements.length).toBe(1);
        const after = bounds(svg, copiedInner.elements[0] as Shape);
        expect(after.x).toBeCloseTo(before.x, 3); expect(after.y).toBeCloseTo(before.y, 3);
        expect(after.width).toBeCloseTo(before.width, 3); expect(after.height).toBeCloseTo(before.height, 3);
    });

    it('remaps clips, shared path points, gradient stops and animation property IDs', () => {
        const { editor, svg, first, commands } = setup();
        const group = new Group(editor), path = new Path(editor);
        const point = new Point(0, 0), next = new Point(30, 20), end = new Point(50, 0);
        path.contours = [path.createContour([
            new Line(editor, { points: [point, next] }), new Line(editor, { points: [next, end] }),
        ], false)];
        const paint: GradientPaint = { type: 'linear-gradient', id: 'paint', units: 'objectBoundingBox', spreadMethod: 'pad', coordinates: {},
            stops: [{ id: 'stop', offset: 0, opacity: 1, color: new Color('#ff0000') }] };
        path.settings.fill = paint;
        group.elements = [first, path]; group.clipElementId = first.id;
        svg.elements = [group]; editor.selectedElements = [group, path];
        svg.animation.tracks = [
            { id: 'point-track', targetId: path.id, property: `path.points.${next.id}.x`, valueType: 'number', keyframes: [{ id: 'point-key', time: 4, value: 70, easing: { type: 'ease-in' }, temporal: { linked: true, out: { speed: 30, influence: .3 } } }] },
            { id: 'stop-track', targetId: path.id, property: 'settings.fill.gradient.stops.stop.offset', valueType: 'number', keyframes: [{ id: 'stop-key', time: 0, value: .7 }] },
        ];
        commands.copy(); commands.paste(true);
        const copiedGroup = editor.selectedElement as Group, copiedPath = copiedGroup.elements[1] as Path;
        expect(copiedGroup.clipElementId).toBe(copiedGroup.elements[0].id);
        expect(copiedPath.lines[0].points[1]).toBe(copiedPath.lines[1].points[0]);
        const tracks = svg.animation.tracks.filter((track) => track.targetId === copiedPath.id);
        expect(tracks[0].property).toBe(`path.points.${copiedPath.lines[0].points[1].id}.x`);
        expect(tracks[1].property).toBe(`settings.fill.gradient.stops.${(copiedPath.settings.fill as GradientPaint).stops[0].id}.offset`);
        expect(tracks[0].keyframes[0].temporal?.out?.speed).toBe(30);
        expect(tracks[0].keyframes[0].id).not.toBe('point-key');
        expect(svg.animation.duration).toBe(4);
    });

    it('includes an unselected motion path as a hidden dependency and offsets the whole motion', () => {
        const { editor, svg, first, commands, animation } = setup();
        const path = new Path(editor);
        path.lines = [new Line(editor, { points: [new Point(100, 100), new Point(200, 100)] })];
        first.motion.pathId = path.id; first.motion.progress = .5;
        svg.elements = [first, path]; editor.selectedElements = [first];
        const before = combinedMotionAdjustedMatrixFor(svg, first);
        svg.animation.tracks = [{ id: 'motion', targetId: first.id, property: 'motion.progress', valueType: 'number',
            keyframes: [{ id: 'start', time: 0, value: 0 }, { id: 'end', time: 3, value: 1 }] }];
        commands.copy(); commands.paste();
        const copy = editor.selectedElement as Shape;
        const copiedPath = svg.elements.find((element) => element.id === copy.motion.pathId)!;
        expect(copiedPath).toBeInstanceOf(Path); expect(copiedPath.visible).toBeFalse();
        const after = combinedMotionAdjustedMatrixFor(svg, copy);
        expect(after.e - before.e).toBeCloseTo(10, 3); expect(after.f - before.f).toBeCloseTo(10, 3);
        expect(animation.evaluate(svg, 3).some((value) => value.targetId === copy.id)).toBeTrue();
    });

    it('remaps preserved SVG resources across fragments and does not alter text or colors', () => {
        const { editor, svg, first, commands } = setup();
        const group = new Group(editor); group.elements = [first]; svg.elements = [group]; editor.selectedElements = [group];
        svg.importedSourceNodes = [
            { id: 'defs', parentId: null, tagName: 'defs', markup: '<defs><filter id="effect"><feGaussianBlur stdDeviation="2"/></filter></defs>' },
            { id: 'image', parentId: group.id, tagName: 'g', markup: '<g id="opaque" filter="url(#effect)" fill="#abc"><text>effect</text><use href="#opaque"/></g>' },
        ];
        commands.copy(); commands.paste(true);
        const sources = svg.importedSourceNodes.slice(2);
        const defs = new DOMParser().parseFromString(sources[0].markup, 'image/svg+xml');
        const newId = defs.querySelector('filter')!.id;
        expect(newId).not.toBe('effect');
        expect(sources[1].markup).toContain(`url(#${newId})`);
        expect(sources[1].markup).toContain('fill="#abc"');
        expect(sources[1].markup).toContain('>effect</text>');
        expect(sources[1].parentId).toBe(editor.selectedElement!.id);
    });

    it('preserves animated paste offsets and only handles supported Edit-mode shortcuts', () => {
        const { editor, svg, first, commands, animation } = setup();
        editor.selectedElements = [first];
        svg.animation.tracks = [{ id: 'track', targetId: first.id, property: 'transform.translateX', valueType: 'number', keyframes: [{ id: 'key', time: 0, value: 50 }] }];
        expect(commands.handleKey(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))).toBeTrue();
        commands.copy(new DataTransfer());
        const pasteKey = new KeyboardEvent('keydown', { key: 'v', metaKey: true, cancelable: true });
        expect(commands.handleKey(pasteKey)).toBeTrue();
        expect(pasteKey.defaultPrevented).toBeFalse();
        commands.paste();
        expect(svg.animation.tracks.at(-1)!.keyframes[0].value).toBe(60);
        expect(commands.handleKey(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true }))).toBeTrue();
        expect(svg.animation.tracks.at(-1)!.keyframes[0].value).toBe(50);
        animation.mode = 'animate';
        expect(commands.handleKey(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))).toBeFalse();
        expect(commands.canPaste).toBeFalse();
    });

    it('ignores empty/locked selections and never mutates the stored fragment during repeated instantiation', () => {
        const { svg, first } = setup();
        first.locked = true;
        expect(captureObjectClipboard(svg, [first])).toBeUndefined();
        first.locked = false;
        first.motion.pathId = 'deleted-path';
        const fragment = captureObjectClipboard(svg, [first])!;
        const before = JSON.stringify(fragment);
        const copy = instantiateObjectClipboard(fragment, 'one', 10);
        expect(copy.document.elements[0].motion?.pathId).toBeNull();
        instantiateObjectClipboard(fragment, 'two', 20);
        expect(JSON.stringify(fragment)).toBe(before);
    });
});

describe('selection actions controls', () => {
    it('offers reference alignment and distribution through labelled icon buttons', async () => {
        const state = setup();
        await TestBed.configureTestingModule({ imports: [SelectionActionsComponent], providers: [
            { provide: SelectionArrangementService, useValue: state.arrangement },
        ] }).compileComponents();
        TestBed.inject(FaIconLibrary).addIcons(faCircleInfo);
        const fixture = TestBed.createComponent(SelectionActionsComponent); fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const button = (label: string) => root.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
        expect([...root.querySelectorAll('button')].map((item) => item.getAttribute('aria-label'))).toEqual([
            'Align left edges', 'Align horizontal centers', 'Align right edges', 'Align top edges', 'Align vertical centers', 'Align bottom edges',
            'Equal horizontal gaps', 'Equal vertical gaps',
        ]);
        expect(button('Equal horizontal gaps').disabled).toBeFalse();
        button('Align left edges').click();
        expect(bounds(state.svg, state.second).x).toBe(10);
        state.editor.selectedElements = [state.first]; fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
        expect(button('Equal horizontal gaps').disabled).toBeTrue();
        expect((root.querySelector('select') as HTMLSelectElement).disabled).toBeTrue();
        expect(root.querySelector('fa-icon.hint')).toBeNull();
        fixture.destroy();
    });
});
