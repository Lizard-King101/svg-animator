import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { OutlineEditingService } from '../../_services/outline-editing.service';
import { EditorService } from '../../_services/editor.service';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { AnimationPlaybackService } from '../../_services/animation-playback.service';
import { DocumentMutationService } from '../../_services/document-mutation.service';
import { SVG } from '../../editor/objects/svg.object';
import { Path } from '../../editor/objects/elements/path.object';
import { Point } from '../../editor/objects/point.object';
import { Line } from '../../editor/objects/line.object';
import { resolvedOutlineSections } from '../../editor/outline-preview';
import { OutlinePanelComponent } from './outline-panel.component';
import { OutlineOverlayComponent } from './outline-overlay.component';
import { EditorPage } from '../../editor/editor.page';

describe('rendered outline editing', () => {
    async function setup() {
        const editor = new EditorService(new EditorPreferencesService());
        const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0, 0) });
        const path = new Path(editor), a = new Point(0, 0), b = new Point(100, 0), c = new Point(200, 0);
        path.lines = [new Line(editor, { points: [a, b] }), new Line(editor, { points: [b, c] })];
        path.settings.fill_enabled = true;
        path.outlineSections = [
            { id: 'first', contourId: path.contours[0].id, start: { segmentId: path.lines[0].id, t: .1 }, end: { segmentId: path.lines[0].id, t: .8 },
                startTaper: { length: .1, tipWidth: .2 } },
            { id: 'second', contourId: path.contours[0].id, start: { segmentId: path.lines[1].id, t: .2 }, end: { segmentId: path.lines[1].id, t: .9 },
                startTaper: { length: .3, tipWidth: .8 } },
        ];
        svg.elements = [path]; editor.selectedSVG = svg; editor.selectedElement = path;
        editor.selectedPathAnchor = b; editor.selectedPathLine = path.lines[0]; editor.selectedPathLines = [path.lines[0]];
        const animation = { mode: 'edit', playing: false };
        const historyRestored = new Subject<void>();
        const mutations = { revision: 0, historyRestored, mutate: jasmine.createSpy('mutate').and.callFake((change: () => void) => { change(); mutations.revision++; }) };
        const outline = new OutlineEditingService(editor, animation as AnimationPlaybackService, mutations as unknown as DocumentMutationService);
        await TestBed.configureTestingModule({ imports: [OutlinePanelComponent, OutlineOverlayComponent], providers: [{ provide: OutlineEditingService, useValue: outline }] }).compileComponents();
        const panel = TestBed.createComponent(OutlinePanelComponent), overlay = TestBed.createComponent(OutlineOverlayComponent);
        panel.componentRef.setInput('path', path);
        overlay.componentRef.setInput('artwork', { getBoundingClientRect: () => ({ left: 50, top: 100, width: 200, height: 200 }) });
        overlay.componentRef.setInput('workspace', { element: { getBoundingClientRect: () => ({ left: 50, top: 100, width: 200, height: 200 }) } });
        const detect = () => { panel.detectChanges(); overlay.detectChanges(); };
        detect(); (panel.nativeElement.querySelector('button') as HTMLButtonElement).click(); detect();
        const input = (label: string): HTMLInputElement => panel.nativeElement.querySelector(`input[aria-label="${label}"]`);
        const button = (label: string): HTMLButtonElement => Array.from(panel.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(button => button.textContent?.trim() === label)!;
        const endpoint = (label = 'Start of outline section 1'): HTMLButtonElement => overlay.nativeElement.querySelector(`button[aria-label="${label}"]`);
        const type = (target: HTMLInputElement, value: string) => { target.value = value; target.dispatchEvent(new Event('input', { bubbles: true })); detect(); };
        const key = (target: Element, value: string, shiftKey = false) => { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })); detect(); };
        const begin = (target = endpoint()) => {
            spyOn(target, 'setPointerCapture'); spyOn(target, 'hasPointerCapture').and.returnValue(false);
            target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, button: 0, clientX: 60, clientY: 100, bubbles: true, cancelable: true }));
            return target;
        };
        const pointer = (target: HTMLButtonElement, name: string, x = 85, pointerId = 7) => {
            target.dispatchEvent(new PointerEvent(name, { pointerId, clientX: x, clientY: 100, bubbles: true, cancelable: true })); detect();
        };
        const destroy = () => { panel.destroy(); overlay.destroy(); outline.ngOnDestroy(); historyRestored.complete(); };
        return { editor, svg, path, animation, mutations, historyRestored, outline, panel, overlay, detect, input, button, endpoint, type, key, begin, pointer, destroy };
    }

    it('selects several outline sections by Shift-click without changing path point selection and exposes mixed percentages', async () => {
        const t = await setup();
        try {
            const anchor = t.editor.selectedPathAnchor, line = t.editor.selectedPathLine;
            t.button('Section 2').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true })); t.detect();
            expect(t.outline.selectedIds).toEqual(['first', 'second']);
            expect(t.editor.selectedPathAnchor).toBe(anchor); expect(t.editor.selectedPathLine).toBe(line);
            expect(t.editor.selectedPathLines).toEqual([line!]);
            expect(t.input('Start taper length').value).toBe(''); expect(t.input('Start taper length').placeholder).toBe('Mixed');
            t.type(t.input('Start taper length'), '25');
            expect(resolvedOutlineSections(t.path)!.map(section => section.startTaper!.length)).toEqual([.25, .25]);
            expect(t.path.outlineSections!.map(section => section.startTaper!.length)).toEqual([.1, .3]);
            expect(t.mutations.mutate).not.toHaveBeenCalled();
            t.key(t.input('Start taper length'), 'Enter');
            expect(t.path.outlineSections!.map(section => section.startTaper!.length)).toEqual([.25, .25]);
            expect(t.mutations.mutate).toHaveBeenCalledTimes(1);
        } finally { t.destroy(); }
    });

    it('previews slider values and commits once on completion, while Escape and interrupted pointers discard drafts', async () => {
        const t = await setup();
        try {
            const saved = t.path.save();
            const slider = t.input('End taper length slider'); t.type(slider, '35');
            expect(t.outline.previewing).toBeTrue(); expect(t.path.save()).toEqual(saved);
            slider.dispatchEvent(new Event('change', { bubbles: true })); t.detect();
            expect(t.path.outlineSections![0].endTaper?.length).toBe(.35); expect(t.mutations.mutate).toHaveBeenCalledTimes(1);
            slider.dispatchEvent(new Event('blur')); expect(t.mutations.mutate).toHaveBeenCalledTimes(1);
            t.type(slider, '50'); t.key(slider, 'Escape');
            expect(t.outline.previewing).toBeFalse(); expect(t.path.outlineSections![0].endTaper?.length).toBe(.35);
            t.type(slider, '45'); slider.dispatchEvent(new PointerEvent('pointercancel')); t.detect();
            expect(t.outline.previewing).toBeFalse(); expect(resolvedOutlineSections(t.path)).toEqual(t.path.outlineSections);
            t.type(slider, '55'); slider.dispatchEvent(new PointerEvent('lostpointercapture')); t.detect();
            expect(t.outline.previewing).toBeFalse(); expect(resolvedOutlineSections(t.path)).toEqual(t.path.outlineSections);
            expect(t.mutations.mutate).toHaveBeenCalledTimes(1);
        } finally { t.destroy(); }
    });

    it('commits numeric edits on focus transfer and clamps opposite tapers without changing the other end', async () => {
        const t = await setup();
        try {
            t.type(t.input('End taper length'), '80'); t.input('End taper length').dispatchEvent(new Event('blur')); t.detect();
            t.type(t.input('Start taper length'), '90'); t.key(t.input('Start taper length'), 'Enter');
            expect(t.path.outlineSections![0].startTaper!.length).toBeCloseTo(.2);
            expect(t.path.outlineSections![0].endTaper!.length).toBe(.8);
            expect(t.mutations.mutate).toHaveBeenCalledTimes(2);
            t.type(t.input('Start taper tip width'), '60'); t.key(t.input('Start taper tip width'), 'Escape');
            expect(t.path.outlineSections![0].startTaper!.tipWidth).toBe(.2); expect(t.mutations.mutate).toHaveBeenCalledTimes(2);
        } finally { t.destroy(); }
    });

    it('renders faint source geometry, trims by pointer with one commit and supports keyboard endpoint adjustment', async () => {
        const t = await setup();
        try {
            expect(t.overlay.nativeElement.querySelector('path.source').getAttribute('d')).toBe(t.path.raw);
            const saved = t.path.save(), target = t.begin(); t.pointer(target, 'pointermove');
            expect(t.path.save()).toEqual(saved); expect(resolvedOutlineSections(t.path)![0].start.t).toBeCloseTo(.35, 2);
            t.pointer(target, 'pointerup'); expect(t.path.outlineSections![0].start.t).toBeCloseTo(.35, 2);
            expect(t.mutations.mutate).toHaveBeenCalledTimes(1);
            t.pointer(target, 'pointerup'); expect(t.mutations.mutate).toHaveBeenCalledTimes(1);
            t.key(t.endpoint(), 'ArrowRight'); expect(t.path.outlineSections![0].start.t).toBeCloseTo(.36, 2);
            expect(t.mutations.mutate).toHaveBeenCalledTimes(2);
            t.key(t.endpoint(), 'ArrowLeft', true); expect(t.path.outlineSections![0].start.t).toBeCloseTo(.26, 2);
        } finally { t.destroy(); }
    });

    it('does not save endpoint clicks or numeric edits which keep the default taper unchanged', async () => {
        const t = await setup();
        try {
            const saved = t.path.save(), target = t.begin(); t.pointer(target, 'pointerup', 60);
            expect(t.outline.previewing).toBeFalse(); expect(t.mutations.mutate).not.toHaveBeenCalled();
            t.type(t.input('End taper length'), '0'); t.key(t.input('End taper length'), 'Enter');
            t.type(t.input('End taper tip width'), '100'); t.key(t.input('End taper tip width'), 'Enter');
            expect(t.outline.previewing).toBeFalse(); expect(t.path.save()).toEqual(saved);
            expect(t.mutations.mutate).not.toHaveBeenCalled();
        } finally { t.destroy(); }
    });

    it('restores the original preview when a dragged endpoint returns to its starting deadzone', async () => {
        const t = await setup();
        try {
            const saved = t.path.save(), target = t.begin(); t.pointer(target, 'pointermove');
            expect(resolvedOutlineSections(t.path)).not.toEqual(saved.outlineSections);
            t.pointer(target, 'pointermove', 61);
            expect(resolvedOutlineSections(t.path)).toEqual(saved.outlineSections);
            t.pointer(target, 'pointerup', 60);
            expect(t.path.save()).toEqual(saved); expect(t.outline.previewing).toBeFalse();
            expect(t.mutations.mutate).not.toHaveBeenCalled();
        } finally { t.destroy(); }
    });

    for(const reason of ['pointercancel', 'lostpointercapture', 'Escape', 'blur', 'window blur', 'scope', 'tool', 'revision', 'document', 'source', 'undo', 'mode'] as const) {
        it(`discards a rendered pointer draft after ${reason}`, async () => {
            const t = await setup();
            try {
                const saved = t.path.save(), target = t.begin(); t.pointer(target, 'pointermove');
                expect(t.outline.previewing).toBeTrue();
                if(reason === 'pointercancel' || reason === 'lostpointercapture') t.pointer(target, reason);
                else if(reason === 'Escape') t.key(target, 'Escape');
                else if(reason === 'blur') target.dispatchEvent(new Event('blur'));
                else if(reason === 'window blur') window.dispatchEvent(new Event('blur'));
                else if(reason === 'scope') t.editor.selectedElement = undefined;
                else if(reason === 'tool') t.editor.selectedTool = t.editor.tools.find(tool => tool !== t.editor.activeTool);
                else if(reason === 'revision') t.mutations.revision++;
                else if(reason === 'document') t.editor.selectedSVG = new SVG(t.editor, { width: 100, height: 100, pos: new Point(0, 0) });
                else if(reason === 'source') t.path.opacity = .5;
                else if(reason === 'undo') t.historyRestored.next();
                else t.animation.mode = 'animate';
                t.detect(); t.pointer(target, 'pointerup');
                expect(t.outline.previewing).toBeFalse(); expect(t.path.outlineSections).toEqual(saved.outlineSections);
                expect(resolvedOutlineSections(t.path)).toEqual(t.path.outlineSections); expect(t.mutations.mutate).not.toHaveBeenCalled();
            } finally { t.destroy(); }
        });
    }

    it('preserves fill and point identities through source-segment hide/show and full-outline restoration', async () => {
        const t = await setup();
        try {
            const points = t.path.pathPoints(), contours = t.path.contours;
            t.button('Source segments').click(); t.detect();
            const source: SVGElement = t.overlay.nativeElement.querySelector('[aria-label="Select source segment 2"]');
            t.key(source, 'Enter'); t.button('Hide outline here').click(); t.detect();
            expect(t.path.outlineSections!.length).toBe(1); expect(t.path.settings.fill_enabled).toBeTrue();
            expect(t.path.contours).toBe(contours); expect(t.path.pathPoints()).toEqual(points);
            t.button('Show outline here').click(); t.detect(); expect(t.path.outlineSections!.length).toBe(2);
            t.button('Restore full outline').click(); t.detect(); expect(t.path.outlineSections).toBeUndefined();
            expect(t.path.settings.fill_enabled).toBeTrue(); expect(t.editor.selectedPathAnchor).toBe(points[1]);
        } finally { t.destroy(); }
    });

    it('owns source-editing shortcuts while preserving ordinary point selection and native field editing', async () => {
        const t = await setup();
        const selectionCommands = { handleKey: jasmine.createSpy('selection key').and.returnValue(false) };
        const layers = { selectedLayers: [t.path], duplicateSelectedLayers: jasmine.createSpy('duplicate'), deleteLayer: jasmine.createSpy('delete') };
        const mutations = { undo: jasmine.createSpy('undo'), redo: jasmine.createSpy('redo') };
        const host = { outline: t.outline, ui: {}, editor: t.editor, layers, selectionCommands, mutations, animation: t.animation };
        const listener = (event: KeyboardEvent) => EditorPage.prototype.handleKeyDown.call(host as unknown as EditorPage, event);
        const pressed = spyOn(t.editor, 'keyPressed');
        document.addEventListener('keydown', listener);
        const send = (target: Element, key: string, options: KeyboardEventInit = {}) => {
            const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
            target.dispatchEvent(event); t.detect(); return event;
        };
        try {
            const source = t.path.save(), anchor = t.editor.selectedPathAnchor, points = t.path.pathPoints();
            const section = t.overlay.nativeElement.querySelector('[aria-label="Select outline section 1"]');
            for(const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'i', 'c']) {
                expect(send(section, key).defaultPrevented).withContext(key).toBeTrue();
            }
            expect(t.path.save()).toEqual(source); expect(pressed).not.toHaveBeenCalled();
            expect(selectionCommands.handleKey).not.toHaveBeenCalled();
            const input = t.input('Start taper length');
            for(const key of ['ArrowRight', 'Delete', 'a']) expect(send(input, key, { ctrlKey: key === 'a' }).defaultPrevented).toBeFalse();
            expect(t.path.save()).toEqual(source);
            send(section, 'a', { ctrlKey: true }); expect(t.outline.selectedIds).toEqual(['first', 'second']);
            send(section, 'Delete');
            expect(t.path.outlineSections).toEqual([]); expect(t.path.settings.fill_enabled).toBeTrue();
            expect(t.editor.selectedPathAnchor).toBe(anchor); expect(t.path.pathPoints()).toEqual(points);
            expect(layers.deleteLayer).not.toHaveBeenCalled(); expect(t.mutations.mutate).toHaveBeenCalledTimes(1);
            const target = t.overlay.nativeElement.querySelector('svg');
            send(target, 'd', { metaKey: true }); send(target, 'z', { ctrlKey: true }); send(target, 'y', { ctrlKey: true });
            expect(layers.duplicateSelectedLayers).toHaveBeenCalledTimes(1);
            expect(mutations.undo).toHaveBeenCalledTimes(1); expect(mutations.redo).toHaveBeenCalledTimes(1);
        } finally { document.removeEventListener('keydown', listener); t.destroy(); }
    });

    it('hides the selected source segments with Backspace and selects all source segments with Cmd+A', async () => {
        const t = await setup();
        const host = { outline: t.outline, ui: {}, editor: t.editor, layers: { selectedLayers: [t.path] }, animation: t.animation };
        const listener = (event: KeyboardEvent) => EditorPage.prototype.handleKeyDown.call(host as unknown as EditorPage, event);
        document.addEventListener('keydown', listener);
        try {
            const anchor = t.editor.selectedPathAnchor, lines = t.path.lines;
            t.button('Source segments').click(); t.detect();
            const segment = t.overlay.nativeElement.querySelector('[aria-label="Select source segment 2"]');
            segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true })); t.detect();
            expect(t.outline.selectedSegmentIds).toEqual(lines.map(line => line.id));
            segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })); t.detect();
            expect(t.path.outlineSections).toEqual([]); expect(t.path.lines).toBe(lines); expect(t.editor.selectedPathAnchor).toBe(anchor);
            expect(t.mutations.mutate).toHaveBeenCalledTimes(1);
        } finally { document.removeEventListener('keydown', listener); t.destroy(); }
    });

    it('shields filled artwork from primary gestures, dismisses without mutation, and lets zoom and middle pan reach the workspace', async () => {
        const t = await setup(), mouseDown = jasmine.createSpy('workspace mousedown'), wheel = jasmine.createSpy('workspace wheel');
        const click = jasmine.createSpy('workspace click'), pointerDown = jasmine.createSpy('workspace pointerdown');
        document.addEventListener('mousedown', mouseDown); document.addEventListener('wheel', wheel); document.addEventListener('click', click);
        document.addEventListener('pointerdown', pointerDown);
        try {
            const saved = t.path.save(), background = t.overlay.nativeElement.querySelector('rect.background') as SVGElement;
            expect(getComputedStyle(background).pointerEvents).toBe('all');
            background.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
            background.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 150, clientY: 125, bubbles: true }));
            background.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: 190, clientY: 150, bubbles: true }));
            background.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 190, clientY: 150, bubbles: true }));
            expect(pointerDown).not.toHaveBeenCalled(); expect(mouseDown).not.toHaveBeenCalled(); expect(t.path.save()).toEqual(saved);
            background.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }));
            background.dispatchEvent(new PointerEvent('pointerdown', { button: 1, bubbles: true }));
            background.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true }));
            expect(wheel).toHaveBeenCalledTimes(1); expect(pointerDown).toHaveBeenCalledTimes(1); expect(mouseDown).toHaveBeenCalledTimes(1); expect(t.outline.active).toBeTrue();
            background.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true })); t.detect();
            expect(t.outline.active).toBeFalse(); expect(click).not.toHaveBeenCalled();
            expect(t.path.save()).toEqual(saved); expect(t.mutations.mutate).not.toHaveBeenCalled();
        } finally {
            document.removeEventListener('mousedown', mouseDown); document.removeEventListener('wheel', wheel); document.removeEventListener('click', click); t.destroy();
            document.removeEventListener('pointerdown', pointerDown);
        }
    });

    it('discards an in-flight pointer preview when Ctrl+Z reaches the page, even with no undo entry', async () => {
        const t = await setup(), undo = jasmine.createSpy('undo');
        const host = { outline: t.outline, ui: {}, editor: t.editor, layers: { selectedLayers: [] },
            selectionCommands: { handleKey: () => false }, mutations: { undo }, animation: t.animation };
        const listener = (event: KeyboardEvent) => EditorPage.prototype.handleKeyDown.call(host as unknown as EditorPage, event);
        document.addEventListener('keydown', listener);
        try {
            const saved = t.path.save(), target = t.begin(); t.pointer(target, 'pointermove');
            expect(t.outline.previewing).toBeTrue();
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); t.detect();
            expect(undo).not.toHaveBeenCalled(); expect(t.outline.previewing).toBeFalse();
            t.pointer(target, 'pointerup'); expect(t.path.save()).toEqual(saved); expect(t.mutations.mutate).not.toHaveBeenCalled();
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
            expect(undo).toHaveBeenCalledTimes(1);
        } finally { document.removeEventListener('keydown', listener); t.destroy(); }
    });
});
