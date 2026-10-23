import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { HistoryService } from './history.service';
import { ProjectService } from './project.service';
import { ReferenceImageService } from './reference-image.service';
import { SVG } from '../editor/objects/svg.object';
import { fitReference, restoreReferenceImage } from '../editor/objects/reference-image';
import { ReferenceOverlayComponent } from '../_components/reference-image/reference-overlay.component';
import { ReferencePanelComponent } from '../_components/reference-image/reference-panel.component';
import { ProjectExportService } from './project-export.service';
import { RuntimeExportService } from './runtime-export.service';
import { parseProjectJSON } from '../editor/import/project-json-import';
import { migrateDocument } from '../editor/migrations/document-migrations';
import fixture from '../editor/migrations/fixtures/document-v6-reference.json';

function setup() {
    const preferences = new EditorPreferencesService();
    const editor = new EditorService(preferences);
    const svg = SVG.fromSave(fixture.data as any, editor); editor.selectedSVG = svg;
    const animation = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences);
    const projects = jasmine.createSpyObj<ProjectService>('projects', ['get', 'upsert', 'updateThumbnail']);
    const mutations = new DocumentMutationService(editor, animation, new HistoryService(), projects);
    mutations.resetBaseline();
    const reference = new ReferenceImageService(editor, mutations);
    return { editor, svg, animation, projects, mutations, reference };
}

describe('tracing references', () => {
    it('round-trips the v6 fixture through project export/import while excluding it from SVG and runtime artwork', async () => {
        const { svg } = setup();
        const migrated = migrateDocument(fixture);
        expect(migrated.status).toBe('ok');
        if(migrated.status === 'ok') expect(migrated.migrated).toBeTrue();
        const content = new ProjectExportService().build({ name: svg.name!, svgData: svg.save() }).content as string;
        const restored = parseProjectJSON(content).document;
        expect(restored.referenceImage).toEqual(svg.referenceImage);
        const exported = await new RuntimeExportService().build(svg, { kind: 'static-svg', bakeRoundedCorners: true });
        expect(exported.content).not.toContain('data:image');
        expect(JSON.stringify(new RuntimeExportService().inspect(svg).compile.bundle)).not.toContain('data:image');
    });
    it('adds the first reference to a document with empty history sections and undoes to no image', () => {
        const editor = new EditorService(new EditorPreferencesService());
        const svg = SVG.fromSave({ id: 'empty', name: 'Empty', width: 800, height: 600, elements: [] }, editor);
        svg.referenceImage = { ...fixture.data.referenceImage };
        expect(() => svg.snapshot()).not.toThrow();
        svg.undo(); expect(svg.referenceImage).toBeUndefined();
        svg.redo(); expect(svg.referenceImage?.name).toBe('reference.png');
    });
    it('rejects external URLs, SVG payloads and invalid geometry at the file boundary', () => {
        for(const patch of [{ source: 'https://example.com/image.png' }, { source: 'data:image/svg+xml;base64,PHN2Zz4=' }, { width: 0 }, { x: Infinity }]) {
            expect(restoreReferenceImage({ ...fixture.data.referenceImage, ...patch })).toBeUndefined();
        }
        const malformed = { ...fixture, data: { ...fixture.data, referenceImage: { ...fixture.data.referenceImage, source: 'javascript:alert(1)' } } };
        expect(() => parseProjectJSON(JSON.stringify(malformed))).toThrowError(/reference image/);
    });
    it('fits and centers with nonzero canvas coordinates, preserving aspect ratio', () => {
        expect(fitReference({ width: 400, height: 200 }, { x: -100, y: 50, width: 600, height: 600 })).toEqual({ x: -100, y: 200, width: 600, height: 300 });
    });
    it('commits opacity, visibility, lock and removal once, with undo/redo and no thumbnail work', () => {
        const { reference, svg, mutations, projects } = setup();
        reference.number('opacity', '25');
        expect(svg.referenceImage?.opacity).toBe(.25);
        expect(projects.upsert).toHaveBeenCalledTimes(1);
        reference.number('opacity', '25'); expect(projects.upsert).toHaveBeenCalledTimes(1);
        mutations.undo(); expect(svg.referenceImage?.opacity).toBe(.4);
        mutations.redo(); expect(svg.referenceImage?.opacity).toBe(.25);
        reference.update({ visible: false }); expect(svg.referenceImage?.visible).toBeFalse();
        reference.remove(); expect(svg.referenceImage).toBeUndefined();
        mutations.undo(); expect(svg.referenceImage?.visible).toBeFalse();
        expect(projects.updateThumbnail).not.toHaveBeenCalled();
    });
    it('keeps gesture previews out of saves, cancels cleanly and commits only once on completion', () => {
        const { reference, svg, projects, mutations } = setup();
        expect(reference.begin()).toBeFalse();
        reference.update({ locked: false }); projects.upsert.calls.reset();
        const original = { ...reference.image! };
        reference.begin(); reference.preview({ ...original, x: 250 });
        expect(svg.save().referenceImage?.x).toBe(original.x);
        expect(reference.display?.x).toBe(250);
        reference.cancel(); expect(reference.display).toEqual(original);
        reference.begin(); reference.finish(); expect(projects.upsert).not.toHaveBeenCalled();
        reference.begin(); reference.preview({ ...original, x: 250 }); reference.finish();
        expect(projects.upsert).toHaveBeenCalledTimes(1);
        mutations.undo(); expect(svg.referenceImage?.x).toBe(original.x);
    });
    it('preserves the image and history through many placement edits without duplicating image bytes', () => {
        const { svg, reference, mutations } = setup();
        // A 2 MB embedded source would otherwise exhaust the history budget in 32 edits.
        svg.referenceImage!.source = 'data:image/png;base64,' + 'AAAA'.repeat(512 * 1024);
        svg.snapshot(); mutations.resetBaseline(); reference.update({ locked: false });
        for(let i = 1; i <= 40; i++) reference.number('x', String(i));
        for(let i = 1; i <= 40; i++) mutations.undo();
        expect(svg.referenceImage?.x).toBe(100);
    });
    it('keeps numeric scale proportional and ignores locked, empty or nonfinite positioning', () => {
        const { reference } = setup();
        reference.number('x', '200'); expect(reference.image?.x).toBe(100);
        reference.update({ locked: false, width: 400, height: 200 });
        reference.number('width', '800'); expect(reference.image?.height).toBe(400);
        reference.number('x', ''); reference.number('x', 'NaN'); reference.number('height', '-1');
        expect(reference.image?.x).toBe(100); expect(reference.image?.height).toBe(400);
    });
    it('accepts clipboard image bytes, reveals the controls and reuses the import boundary', async () => {
        const { reference } = setup();
        const imported = spyOn(reference, 'import').and.resolveTo();
        const data = new DataTransfer(); data.setData('text/html', '<img src="https://example.com/image.png">');
        expect(reference.paste(data)).toBeFalse();
        const file = new File(['image'], 'pasted.png', { type: 'image/png' }); data.items.add(file);
        expect(reference.paste(data)).toBeTrue(); expect(reference.panelOpen).toBeTrue();
        expect(imported).toHaveBeenCalledOnceWith(file);
    });
    it('reads clipboard images on explicit request and reports unavailable or empty clipboards', async () => {
        const { reference } = setup();
        const imported = spyOn(reference, 'import').and.resolveTo();
        const read = spyOn(navigator.clipboard, 'read').and.resolveTo([
            { presentationStyle: 'unspecified', types: ['text/plain', 'image/png'], getType: async () => new Blob(['image'], { type: 'image/png' }) } as ClipboardItem,
        ]);
        await reference.pasteFromClipboard();
        expect(imported.calls.mostRecent().args[0].name).toBe('Clipboard image.png');
        expect(reference.error).toBe(''); expect(reference.busy).toBeFalse();
        imported.calls.reset(); read.and.resolveTo([]); await reference.pasteFromClipboard();
        expect(reference.error).toContain('No image found'); expect(imported).not.toHaveBeenCalled();
        read.and.rejectWith(new Error('Denied')); await reference.pasteFromClipboard();
        expect(reference.error).toContain('Ctrl/Cmd+V'); expect(reference.busy).toBeFalse();
    });
    it('does not apply a clipboard read to a different project', async () => {
        const { reference, editor } = setup();
        const imported = spyOn(reference, 'import').and.resolveTo();
        spyOn(navigator.clipboard, 'read').and.callFake(async () => {
            editor.selectedSVG = undefined;
            return [{ presentationStyle: 'unspecified', types: ['image/png'], getType: async () => new Blob(['image'], { type: 'image/png' }) } as ClipboardItem];
        });
        await reference.pasteFromClipboard(); expect(imported).not.toHaveBeenCalled();
    });
    it('imports a raster centered and locked, and leaves the existing reference unchanged on failure', async () => {
        const { reference, projects, svg, mutations } = setup();
        reference.remove(); mutations.resetBaseline(); projects.upsert.calls.reset();
        const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
        const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
        await reference.import(new File([blob], 'trace.png', { type: 'image/png' }));
        expect(reference.image).toEqual(jasmine.objectContaining({ name: 'trace.png', x: 0, y: 100, width: 800, height: 400, locked: true, opacity: .4 }));
        expect(reference.error).toBe('');
        const before = reference.image;
        await reference.import(new File(['bad'], 'bad.svg', { type: 'image/svg+xml' }));
        expect(reference.image).toBe(before); expect(reference.error).toContain('PNG');
        expect(projects.upsert).toHaveBeenCalledTimes(1);
    });
});

describe('reference controls', () => {
    it('uses the current document after undo, supports keyboard movement and proportional resizing', () => {
        const { editor, reference, mutations, projects } = setup(); reference.update({ locked: false });
        TestBed.configureTestingModule({ imports: [ReferenceOverlayComponent, ReferencePanelComponent], providers: [
            { provide: ReferenceImageService, useValue: reference }, { provide: EditorService, useValue: editor },
        ] });
        const overlay = TestBed.createComponent(ReferenceOverlayComponent);
        const artwork = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        spyOn(artwork, 'getBoundingClientRect').and.returnValue({ left: 50, top: 50, width: 400, height: 300 } as DOMRect);
        const workspace = document.createElement('div');
        spyOn(workspace, 'getBoundingClientRect').and.returnValue({ left: 0, top: 0 } as DOMRect);
        overlay.componentInstance.artwork = artwork;
        overlay.componentInstance.workspace = { element: workspace } as any;
        overlay.detectChanges();
        const move: HTMLButtonElement = overlay.nativeElement.querySelector('.move');
        move.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
        expect(reference.image?.x).toBe(110);
        mutations.undo(); expect(reference.image?.x).toBe(100);
        overlay.nativeElement.querySelector('.resize').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(reference.image?.width).toBe(601); expect(reference.image?.height).toBe(601);
        reference.begin(); reference.preview({ ...reference.image!, x: 999 });
        move.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(reference.display?.x).toBe(100);
        spyOn(move, 'setPointerCapture'); spyOn(move, 'releasePointerCapture');
        projects.upsert.calls.reset();
        move.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 20, clientY: 30, bubbles: true }));
        move.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 50, clientY: 50, bubbles: true }));
        expect(reference.image?.x).toBe(100); expect(reference.display?.x).toBe(160);
        move.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 50, clientY: 50, bubbles: true }));
        expect(reference.image?.x).toBe(160); expect(projects.upsert).toHaveBeenCalledTimes(1);
        mutations.undo(); expect(reference.image?.x).toBe(100);
        move.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, button: 0, clientX: 20, clientY: 30, bubbles: true }));
        move.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 50, clientY: 50, bubbles: true }));
        move.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 2, bubbles: true }));
        expect(reference.display?.x).toBe(100);
        const panel = TestBed.createComponent(ReferencePanelComponent); panel.detectChanges();
        expect(panel.nativeElement.textContent).toContain('Tracing reference');
        reference.update({ locked: true }); overlay.detectChanges();
        expect(overlay.nativeElement.querySelector('.move')).toBeNull();
    });
});
