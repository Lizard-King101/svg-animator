import { fakeAsync, tick, TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { EditorPreferencesService } from './editor-preferences.service';
import { EditorService } from './editor.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { HistoryService } from './history.service';
import { ProjectService } from './project.service';
import { ProjectColorsService } from './project-colors.service';
import { SVG } from '../editor/objects/svg.object';
import { Shape } from '../editor/objects/elements/shape.object';
import { Group } from '../editor/objects/elements/group.object';
import { Color } from '../editor/objects/color.object';
import { createDefaultGradient } from '../editor/objects/paint.object';
import { createAnimationColorValue } from '../editor/objects/animation.object';
import { authoredColors, restoreProjectColors } from '../editor/objects/project-colors';
import { Point } from '../editor/objects/point.object';
import { ProjectExportService } from './project-export.service';
import { parseProjectJSON } from '../editor/import/project-json-import';
import { migrateDocument } from '../editor/migrations/document-migrations';
import { buildSVGMarkup } from '../editor/svg-markup';
import fixture from '../editor/migrations/fixtures/document-v7-colors.json';
import { PaintEditorComponent } from '../_components/paint-editor/paint-editor.component';

function setup() {
    const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
    const svg = SVG.fromSave({ id: 'palette', name: 'Palette', width: 100, height: 100, elements: [] }, editor);
    editor.selectedSVG = svg;
    const animation = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences);
    animation.mode = 'edit';
    const projects = jasmine.createSpyObj<ProjectService>('projects', ['get', 'upsert']);
    const mutations = new DocumentMutationService(editor, animation, new HistoryService(), projects);
    const palette = new ProjectColorsService(editor, mutations);
    mutations.resetBaseline();
    const add = () => {
        const shape = new Shape(editor, { type: 'rectangle', position: new Point(0, 0), width: 20, height: 20 });
        shape.settings.fill = new Color('#123456'); shape.settings.stroke = null;
        mutations.mutate(() => svg.elements.push(shape)); return shape;
    };
    const destroy = () => { mutations.ngOnDestroy(); animation.ngOnDestroy(); };
    return { preferences, editor, svg, animation, projects, mutations, palette, add, destroy };
}

describe('Project colors', () => {
    it('refreshes an unchanged OnPush paint editor when another surface changes the palette', async () => {
        const t = setup();
        try {
            await TestBed.configureTestingModule({ imports: [PaintEditorComponent], providers: [{ provide: ProjectColorsService, useValue: t.palette }] }).compileComponents();
            const fixture = TestBed.createComponent(PaintEditorComponent);
            fixture.componentRef.setInput('paint', new Color('#ffffff')); fixture.detectChanges();
            t.palette.remember('#abcdef'); await fixture.whenStable(); fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('app-project-colors button')?.getAttribute('aria-label')).toBe('Use #abcdef');
            t.mutations.undo(); await fixture.whenStable(); fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('app-project-colors button')).toBeNull();
        } finally { t.destroy(); }
    });
    it('collects a new color in the artwork commit, retains it after deletion, and undoes/redoes both together', () => {
        const t = setup();
        try {
            const shape = t.add(); expect(t.projects.upsert).toHaveBeenCalledTimes(1);
            expect(t.palette.colors).toEqual([{ color: '#123456' }]);
            t.mutations.undo(); expect(t.svg.elements.length).toBe(0); expect(t.palette.colors).toEqual([]);
            t.mutations.redo(); expect(t.palette.colors).toEqual([{ color: '#123456' }]);
            t.mutations.mutate(() => t.svg.elements = []); expect(t.palette.colors).toEqual([{ color: '#123456' }]);
            t.mutations.undo(); expect(t.svg.elements[0].id).toBe(shape.id);
        } finally { t.destroy(); }
    });
    it('collects hidden/locked nested paints, stop opacity, text colors and structured color keyframes, deduplicating alpha-aware values', () => {
        const t = setup();
        try {
            const shape = t.add(), group = new Group(t.editor); shape.visible = false; shape.locked = true;
            const gradient = createDefaultGradient('g'); gradient.stops[0].color = new Color('#123456'); gradient.stops[0].opacity = .5;
            gradient.stops[1].color = new Color('#123456'); shape.settings.fill = gradient;
            group.elements = [shape]; t.svg.elements = [group];
            t.svg.animation.tracks = [{ id: 'track', targetId: shape.id, property: 'settings.fill', valueType: 'color', keyframes: [
                { id: 'a', time: 0, value: '#123456', easing: { type: 'linear' } },
                { id: 'b', time: 1, value: createAnimationColorValue(new Color('#ff000080')), easing: { type: 'linear' } },
            ] }];
            t.mutations.commit();
            expect(new Set(t.palette.colors.map(item => item.color))).toEqual(new Set(['#123456', '#12345680', '#ff000080']));
            const save = t.svg.save(); save.elements.push({ type: 'text', id: 'text', settings: { color: '#abc' } } as any);
            expect([...authoredColors(save).values()]).toContain('#aabbcc');
            expect(restoreProjectColors([{ color: '#fff' }, { color: '#ffffffff' }, { color: '#ffffff00' }])).toEqual([{ color: '#ffffff' }, { color: '#ffffff00' }]);
        } finally { t.destroy(); }
    });
    it('retains an old loaded color when its last object is deleted before any palette was saved', () => {
        const t = setup();
        try {
            t.add(); t.svg.projectColors = []; t.svg.snapshot(); t.mutations.resetBaseline();
            expect(t.palette.colors.map(item => item.color)).toContain('#123456');
            t.mutations.mutate(() => t.svg.elements = []);
            expect(t.svg.projectColors).toEqual([{ color: '#123456' }]);
        } finally { t.destroy(); }
    });
    it('records only the final coalesced color and no change for a no-op commit', fakeAsync(() => {
        const t = setup();
        try {
            const shape = t.add(); t.projects.upsert.calls.reset();
            shape.settings.fill = new Color('#ff0000'); t.mutations.schedule();
            shape.settings.fill = new Color('#00ff00'); t.mutations.schedule();
            expect(t.palette.colors.map(item => item.color)).not.toContain('#ff0000');
            tick(251); expect(t.projects.upsert).toHaveBeenCalledTimes(1);
            expect(t.palette.colors.map(item => item.color)).toEqual(['#00ff00', '#123456']);
            expect(t.mutations.commit()).toBeFalse(); expect(t.projects.upsert).toHaveBeenCalledTimes(1);
        } finally { t.destroy(); }
    }));
    it('does not collect interpolated playback colors and respects project switches', () => {
        const t = setup();
        try {
            const shape = t.add();
            t.animation.setMode('animate'); t.animation.seek(0); t.animation.setAnimatedPropertyValue(shape, 'settings.fill', 'color', new Color('#000000'));
            t.animation.seek(1); t.animation.setAnimatedPropertyValue(shape, 'settings.fill', 'color', new Color('#ffffff'));
            t.mutations.commit('animation'); t.animation.seek(.5);
            t.mutations.mutate(() => t.svg.name = 'Renamed', 'metadata');
            expect(t.palette.colors.map(item => item.color)).not.toContain('#808080');
            t.editor.selectedSVG = SVG.fromSave({ id: 'other', name: 'Other', width: 10, height: 10, elements: [] }, t.editor);
            t.mutations.resetBaseline(); expect(t.palette.colors).toEqual([]);
            t.palette.remember('#abc'); expect(t.palette.colors).toEqual([{ color: '#aabbcc' }]);
            t.editor.selectedSVG = t.svg; t.mutations.resetBaseline(); expect(t.palette.colors.map(item => item.color)).not.toContain('#aabbcc');
        } finally { t.destroy(); }
    });
    it('names, pins and reorders favorites without duplicating or recoloring artwork; round-trips project JSON', () => {
        const t = setup();
        try {
            const shape = t.add(), original = shape.save();
            t.palette.remember('#abcdef'); t.palette.rename('#123456', 'Ink'); t.palette.pin('#123456', true);
            expect(t.palette.colors[0]).toEqual({ color: '#123456', name: 'Ink', pinned: true });
            t.palette.remember('#abcdef'); expect(t.svg.projectColors.length).toBe(2); expect(shape.save()).toEqual(original);
            const json = new ProjectExportService().build({ name: t.svg.name!, svgData: t.svg.save() }).content as string;
            const restored = SVG.fromSave(parseProjectJSON(json).document, t.editor);
            expect(restored.projectColors).toEqual(t.svg.projectColors);
            expect(buildSVGMarkup(restored)).not.toContain('Ink');
            t.mutations.undo(); t.mutations.redo(); expect(t.svg.projectColors).toEqual(restored.projectColors);
        } finally { t.destroy(); }
    });
    it('migrates v6 and v7 and rejects malformed project palettes', () => {
        const current = migrateDocument(fixture); expect(current.status).toBe('ok');
        if(current.status === 'ok') expect(current.migrated).toBeTrue();
        const previous = migrateDocument({ ...fixture, version: 6, data: { ...fixture.data, projectColors: undefined } });
        expect(previous.status).toBe('ok'); if(previous.status === 'ok') { expect(previous.migrated).toBeTrue(); expect(previous.value.version).toBe(14); }
        for(const projectColors of [[{ color: 'not a color' }], [{ color: '#123456', pinned: 'yes' }], [{ color: '#123456', name: 'x'.repeat(81) }]]) {
            expect(() => parseProjectJSON(JSON.stringify({ ...fixture, data: { ...fixture.data, projectColors } }))).toThrow();
        }
    });
});
