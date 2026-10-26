import { NgClass, NgFor, NgIf } from '@angular/common';
import { NgZone, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AnimationPlaybackService } from '../../_services/animation-playback.service';
import { DocumentMutationService } from '../../_services/document-mutation.service';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { EditorService } from '../../_services/editor.service';
import { ElementFactory } from '../../_services/element-factory.service';
import { HistoryService } from '../../_services/history.service';
import { LayerCommandService } from '../../_services/layer-command.service';
import { LayerOperationsService } from '../../_services/layer-operations.service';
import { InlineRenameDirective } from '../../editor/inline-rename.directive';
import { Group } from '../../editor/objects/elements/group.object';
import { Shape } from '../../editor/objects/elements/shape.object';
import { Point } from '../../editor/objects/point.object';
import { SVG } from '../../editor/objects/svg.object';
import { LayersPanelComponent } from './layers-panel.component';

describe('layer rename interaction', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

    async function setup() {
        const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
        const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0, 0) });
        const source = new Shape(editor, { type: 'ellipse', position: new Point(10, 10) });
        const other = new Shape(editor, { type: 'rectangle', position: new Point(20, 20) });
        source.name = 'Eye'; other.name = 'Hair';
        svg.elements = [source, other]; editor.selectedSVG = svg;
        const operations = new LayerOperationsService(editor, new ElementFactory(editor));
        const animation = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences);
        animation.mode = 'edit';
        const projects = { get: () => undefined, upsert: jasmine.createSpy('upsert'), updateThumbnail: jasmine.createSpy('updateThumbnail') };
        const mutations = new DocumentMutationService(editor, animation, new HistoryService(), projects as never);
        const commands = new LayerCommandService(editor, operations, mutations);
        svg.snapshot(); mutations.resetBaseline();
        await TestBed.configureTestingModule({ imports: [LayersPanelComponent],
            providers: [{ provide: LayerCommandService, useValue: commands }] })
            .overrideComponent(LayersPanelComponent, { set: {
                imports: [NgClass, NgFor, NgIf, InlineRenameDirective], schemas: [NO_ERRORS_SCHEMA],
            } }).compileComponents();
        const fixture = TestBed.createComponent(LayersPanelComponent);
        fixture.detectChanges();
        cleanups.push(() => { fixture.destroy(); animation.ngOnDestroy(); mutations.ngOnDestroy(); });
        const row = () => fixture.nativeElement.querySelector(`[data-layer-id="${source.id}"]`) as HTMLElement;
        const begin = () => {
            row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); fixture.detectChanges();
            return row().querySelector<HTMLInputElement>('input')!;
        };
        const key = (input: HTMLInputElement, key: string, options: KeyboardEventInit = {}) => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
            fixture.detectChanges();
        };
        const commit = spyOn(mutations, 'commit').and.callThrough();
        return { editor, source, other, svg, operations, commands, mutations, animation, projects, fixture, row, begin, key, commit };
    }

    it('keeps typing, selection and clipboard native without changing artwork or entering Angular', async () => {
        const t = await setup(), input = t.begin(), zone = TestBed.inject(NgZone);
        expect(document.activeElement).toBe(input);
        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
        let zoneEntries = 0;
        const sub = zone.onUnstable.subscribe(() => zoneEntries++);
        const bubbled = jasmine.createSpy('bubbled');
        t.row().addEventListener('keydown', bubbled);
        zone.runOutsideAngular(() => {
            for(const character of ' Foreground') {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: character, bubbles: true }));
                input.value += character;
                input.dispatchEvent(new InputEvent('input', { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup', { key: character, bubbles: true }));
            }
            input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true }));
            input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        });
        sub.unsubscribe();
        expect(zoneEntries).toBe(0);
        expect(bubbled).not.toHaveBeenCalled();
        expect(t.source.name).toBe('Eye');
        expect(t.commit).not.toHaveBeenCalled();
        expect(input.value).toBe('Eye Foreground');
        t.fixture.detectChanges();
        expect(input.value).toBe('Eye Foreground');
    });

    it('commits once on Enter as metadata, returns row focus and supports one-step undo/redo', async () => {
        const t = await setup(), input = t.begin();
        const invalidate = spyOn(t.animation, 'invalidate').and.callThrough();
        input.value = '  Eye outline  ';
        t.key(input, 'Enter');
        input.dispatchEvent(new FocusEvent('blur'));
        expect(t.source.name).toBe('Eye outline');
        expect(t.commit).toHaveBeenCalledOnceWith('metadata');
        expect(t.projects.upsert).toHaveBeenCalledTimes(1);
        expect(t.projects.updateThumbnail).not.toHaveBeenCalled();
        expect(invalidate).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(t.row());
        t.mutations.undo();
        expect(t.editor.selectedSVG!.elements[0].name).toBe('Eye');
        t.mutations.redo();
        expect(t.editor.selectedSVG!.elements[0].name).toBe('Eye outline');
    });

    it('discards Escape and unchanged drafts without committing, including the following blur', async () => {
        const t = await setup();
        let input = t.begin(); input.value = 'Discarded'; t.key(input, 'Escape');
        input.dispatchEvent(new FocusEvent('blur'));
        expect(t.source.name).toBe('Eye');
        expect(document.activeElement).toBe(t.row());
        input = t.begin(); input.value = '  Eye  '; t.key(input, 'Enter');
        expect(t.commit).not.toHaveBeenCalled();
    });

    it('commits on focus transfer and preserves the destination focus', async () => {
        const t = await setup(), input = t.begin();
        input.value = 'Eyelash';
        const destination: HTMLButtonElement = t.fixture.nativeElement.querySelector(`[data-layer-id="${t.other.id}"] .layer-toggle`);
        destination.focus(); t.fixture.detectChanges();
        expect(t.source.name).toBe('Eyelash');
        expect(t.commit).toHaveBeenCalledOnceWith('metadata');
        expect(document.activeElement).toBe(destination);
    });

    it('keeps IME Enter and native Tab behavior, and normalizes an empty completed name', async () => {
        const t = await setup(), input = t.begin();
        input.value = '  ';
        t.key(input, 'Enter', { isComposing: true });
        expect(t.commands.renamingLayer).toBe(t.source);
        const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        input.dispatchEvent(tab);
        expect(tab.defaultPrevented).toBeFalse();
        input.blur(); t.fixture.detectChanges();
        expect(t.source.name).toBe('Layer');
        expect(t.commit).toHaveBeenCalledOnceWith('metadata');
    });

    it('discards drafts after document, selection, or revision changes', async () => {
        const t = await setup();
        let input = t.begin(); input.value = 'Old document';
        t.editor.selectedSVG = new SVG(t.editor, { width: 200, height: 200, pos: new Point(0, 0) });
        input.dispatchEvent(new FocusEvent('blur')); t.fixture.detectChanges();
        expect(t.source.name).toBe('Eye');
        t.editor.selectedSVG = t.svg; t.fixture.detectChanges();
        input = t.begin(); input.value = 'Old selection';
        t.commands.selectLayer(t.other); t.fixture.detectChanges();
        input.dispatchEvent(new FocusEvent('blur'));
        expect(t.source.name).toBe('Eye');
        input = t.begin(); input.value = 'Old revision';
        t.other.name = 'Hair changed'; t.mutations.commit('metadata');
        t.commit.calls.reset();
        t.key(input, 'Enter');
        expect(t.source.name).toBe('Eye');
        expect(t.commit).not.toHaveBeenCalled();
    });

    it('uses known row parents for clipping presentation without repeatedly searching the document', async () => {
        const t = await setup(), group = new Group(t.editor);
        group.elements = [t.source]; group.clipElementId = t.source.id; t.svg.elements = [group, t.other];
        const context = spyOn(t.operations, 'context').and.callThrough();
        t.fixture.detectChanges();
        expect(t.row().classList.contains('clipping-mask')).toBeTrue();
        expect(t.row().querySelector('.layer-badge')?.textContent).toBe('Clip');
        expect(context).not.toHaveBeenCalled();
    });
});
