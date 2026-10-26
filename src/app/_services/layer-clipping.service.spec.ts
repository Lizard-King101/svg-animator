import { NgZone, NO_ERRORS_SCHEMA } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { LayersPanelComponent } from '../_components/layers-panel/layers-panel.component';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { ElementFactory } from './element-factory.service';
import { LayerOperationsService } from './layer-operations.service';
import { LayerCommandService } from './layer-command.service';
import { DocumentMutationService } from './document-mutation.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { HistoryService } from './history.service';
import { SVG } from '../editor/objects/svg.object';
import { Shape } from '../editor/objects/elements/shape.object';
import { Group } from '../editor/objects/elements/group.object';
import { Point } from '../editor/objects/point.object';
import { arrangementBounds } from '../editor/objects/arrangement-bounds';
import { localBounds, ownMatrix } from '../editor/objects/element-bounds';

describe('clipping artwork visibility', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

    function setup() {
        const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
        const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0, 0) });
        const detail = new Shape(editor, { type: 'rectangle', position: new Point(20, 20), width: 10, height: 10 });
        const source = new Shape(editor, { type: 'ellipse', position: new Point(10, 10), width: 80, height: 60 });
        svg.elements = [detail, source]; editor.selectedSVG = svg;
        const operations = new LayerOperationsService(editor, new ElementFactory(editor));
        const animation = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences);
        animation.mode = 'edit';
        const projects = { upsert: jasmine.createSpy('upsert') };
        const mutations = new DocumentMutationService(editor, animation, new HistoryService(), projects as never);
        const commands = new LayerCommandService(editor, operations, mutations);
        svg.snapshot(); mutations.resetBaseline();
        cleanups.push(() => { animation.ngOnDestroy(); mutations.ngOnDestroy(); });
        return { editor, svg, detail, source, operations, commands, mutations, projects };
    }

    it('creates a hidden clipping source and uses the existing eye toggle in one undo step', () => {
        const { editor, svg, source, detail, commands, projects, mutations } = setup();
        commands.clipLayerWithBelow(source);
        const group = svg.elements[0] as Group;
        expect(group.clipElement).toBe(source);
        expect(source.visible).toBeFalse();
        expect(group.renderedElements).toEqual([detail]);
        expect(commands.layerVisibilityTitle(source)).toBe('Show clipping artwork; clipping stays active');
        expect(projects.upsert).toHaveBeenCalledTimes(1);
        commands.toggleLayerVisibility(new MouseEvent('click'), source);
        expect(source.visible).toBeTrue();
        expect(group.clipElement).toBe(source);
        expect(commands.layerVisibilityTitle(source)).toBe('Hide clipping artwork; clipping stays active');
        expect(commands.layerVisibilityTitle(detail)).toBe('Hide layer');
        expect(projects.upsert).toHaveBeenCalledTimes(2);
        mutations.undo();
        const restored = editor.selectedSVG!.elements[0] as Group;
        expect(restored.clipElement?.visible).toBeFalse();
        expect(restored.clipElementId).toBe(source.id);
        mutations.redo();
        expect((editor.selectedSVG!.elements[0] as Group).clipElement?.visible).toBeTrue();
        const reopened = SVG.fromSave(editor.selectedSVG!.save(), editor).elements[0] as Group;
        expect(reopened.clipElement?.visible).toBeTrue();
        expect(reopened.clipElementId).toBe(source.id);
    });

    it('renders the existing eye button with clipping feedback and preserves layer selection and focus', async () => {
        const { source, commands, editor, projects } = setup();
        commands.clipLayerWithBelow(source);
        await TestBed.configureTestingModule({ imports: [LayersPanelComponent],
            providers: [{ provide: LayerCommandService, useValue: commands }] })
            .overrideComponent(LayersPanelComponent, { set: {
                imports: [NgClass, NgFor, NgIf, FormsModule], schemas: [NO_ERRORS_SCHEMA],
            } }).compileComponents();
        const fixture = TestBed.createComponent(LayersPanelComponent);
        cleanups.push(() => fixture.destroy());
        fixture.detectChanges();
        const row: HTMLElement = fixture.nativeElement.querySelector(`[data-layer-id="${source.id}"]`);
        const eye = row.querySelector<HTMLButtonElement>('.layer-actions .layer-toggle')!;
        expect(row.classList.contains('hidden')).toBeTrue();
        expect(eye.title).toBe('Show clipping artwork; clipping stays active');
        expect(eye.getAttribute('aria-label')).toBe(`Show ${source.name}`);
        eye.focus(); eye.click(); fixture.detectChanges();
        expect(row.classList.contains('hidden')).toBeFalse();
        expect(eye.title).toBe('Hide clipping artwork; clipping stays active');
        expect(eye.getAttribute('aria-label')).toBe(`Hide ${source.name}`);
        expect(document.activeElement).toBe(eye);
        expect(editor.selectedElement).toBe(source);
        expect(projects.upsert).toHaveBeenCalledTimes(2);
    });

    it('reveals the old source on replacement, release, and ungroup without changing other layers', () => {
        const { svg, source, detail, operations } = setup();
        const group = operations.groupWithBelow(source, true)!;
        expect(operations.useAsClippingMask(source)).toBeFalse();
        expect(source.visible).toBeFalse();
        expect(operations.useAsClippingMask(detail)).toBeTrue();
        expect(source.visible).toBeTrue(); expect(detail.visible).toBeFalse();
        expect(group.clipElement).toBe(detail);
        expect(operations.releaseClippingMask(group)).toBeTrue();
        expect(detail.visible).toBeTrue(); expect(group.clipElement).toBeUndefined();
        expect(operations.releaseClippingMask(group)).toBeFalse();
        operations.useAsClippingMask(source);
        detail.visible = false;
        expect(operations.ungroup(group)).toEqual([detail, source]);
        expect(source.visible).toBeTrue(); expect(detail.visible).toBeFalse();
        expect(svg.elements).toEqual([detail, source]);
    });

    it('keeps clip geometry in transform bounds while arranging visible artwork separately', () => {
        const { svg, source, detail, operations } = setup();
        const group = operations.groupWithBelow(source, true)!;
        expect(localBounds(group)).toEqual(localBounds(source));
        expect(arrangementBounds(svg, group)).toEqual(arrangementBounds(svg, detail));
        source.visible = true;
        expect(arrangementBounds(svg, group)).toEqual(arrangementBounds(svg, source));
        group.transform.rotation = 37; group.transform.scaleX = -1.2;
        const before = ownMatrix(group);
        source.visible = false;
        expect(ownMatrix(group)).toEqual(before);
        expect(group.clipElement).toBe(source);
        expect(localBounds(group)).toEqual(localBounds(source));
    });
});
