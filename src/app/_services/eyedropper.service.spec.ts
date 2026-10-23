import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { HistoryService } from './history.service';
import { ProjectService } from './project.service';
import { EyedropperService } from './eyedropper.service';
import { SVG } from '../editor/objects/svg.object';
import { ColorAttribute } from '../_components/attributes/color/color.component';
import { Color } from '../editor/objects/color.object';
import { decodeSamplingImage, fittedImageBounds, sampleRaster } from '../editor/objects/color-sampling';
import { EyedropperComponent } from '../_components/eyedropper/eyedropper.component';
import { PaintEditingService } from './paint-editing.service';
import { GradientPresetService } from './gradient-preset.service';
import { Shape } from '../editor/objects/elements/shape.object';
import { Point } from '../editor/objects/point.object';

function referenceSource(): string {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 1;
    const context = canvas.getContext('2d')!; context.fillStyle = '#ff0000'; context.fillRect(0, 0, 1, 1);
    context.fillStyle = '#0000ff'; context.fillRect(1, 0, 1, 1); return canvas.toDataURL();
}
function setup() {
    const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
    const svg = SVG.fromSave({ id: 'sample', name: 'Sample', width: 120, height: 60, viewBoxX: 10, viewBoxY: 20, elements: [] }, editor);
    editor.selectedSVG = svg;
    svg.referenceImage = { source: referenceSource(), x: 10, y: 20, width: 120, height: 60, visible: true, locked: true, opacity: .4, name: 'Reference' };
    const animation = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences); animation.mode = 'edit';
    const projects = jasmine.createSpyObj<ProjectService>('projects', ['get', 'upsert']);
    const mutations = new DocumentMutationService(editor, animation, new HistoryService(), projects); mutations.resetBaseline();
    const picker = new EyedropperService(editor, animation, mutations);
    const workspace = document.createElement('div'); workspace.style.cssText = 'position:fixed;left:30px;top:60px;width:500px;height:400px'; document.body.appendChild(workspace);
    const surface = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    surface.setAttribute('width', '240'); surface.setAttribute('height', '120'); surface.setAttribute('viewBox', '10 20 120 60'); surface.style.background = 'white';
    surface.innerHTML = `<image href="${svg.referenceImage.source}" x="10" y="20" width="120" height="60" opacity="0.4"/><g transform="translate(20 25)"><rect width="10" height="10" fill="#00ff00"/></g>`;
    workspace.appendChild(surface); picker.register(surface);
    const trigger = document.createElement('button'); workspace.appendChild(trigger);
    const move = (x: number, y: number) => { const p = new DOMPoint(x, y).matrixTransform(surface.getScreenCTM()!); picker.move(p.x, p.y); };
    const destroy = () => { picker.cancel(); workspace.remove(); mutations.ngOnDestroy(); animation.ngOnDestroy(); };
    return { editor, svg, animation, projects, mutations, picker, surface, workspace, trigger, move, destroy };
}

describe('Eyedropper', () => {
    it('commits a picked paint and its palette immediately so undo never removes the preceding shape', async () => {
        const t = setup();
        try {
            const shape = new Shape(t.editor, { type: 'rectangle', position: new Point(20, 25), width: 10, height: 10 });
            shape.settings.fill = new Color('#123456'); shape.settings.stroke = null;
            t.mutations.mutate(() => t.svg.elements.push(shape));
            const paint = new PaintEditingService(t.editor, t.animation, t.mutations, {} as GradientPresetService);
            t.projects.upsert.calls.reset();
            await t.picker.begin({}, t.trigger, color => paint.apply(shape, 'fill', { type: 'solid-color', color }));
            t.move(25, 30); t.picker.choose();
            expect(t.projects.upsert).toHaveBeenCalledTimes(1);
            expect(t.svg.projectColors.some(entry => entry.color === '#00ff00')).toBeTrue();
            expect(t.mutations.commit()).toBeFalse();
            t.mutations.undo();
            expect(t.svg.elements.length).toBe(1);
            expect(((t.svg.elements[0] as Shape).settings.fill as Color).serialized).toBe('#123456');
            expect(t.svg.projectColors.some(entry => entry.color === '#00ff00')).toBeFalse();
            t.mutations.redo();
            expect(((t.svg.elements[0] as Shape).settings.fill as Color).serialized).toBe('#00ff00');
        } finally { t.destroy(); }
    });
    it('samples visible artwork and original locked reference pixels under artwork, ignoring tracing opacity', async () => {
        const t = setup();
        try {
            await t.picker.begin({}, t.trigger, () => {});
            t.move(25, 30); expect(t.picker.sample()?.color.serialized).toBe('#00ff00');
            t.move(40, 40); expect(t.picker.sample()?.color.serialized).toBe('#ff9999');
            await t.picker.setSource('reference'); t.move(25, 30); expect(t.picker.sample()?.color.serialized).toBe('#ff0000');
            t.move(100, 40); expect(t.picker.sample()?.color.serialized).toBe('#0000ff');
            t.picker.cancel(); t.svg.referenceImage!.opacity = .1;
            t.mutations.commit('metadata'); t.projects.upsert.calls.reset();
            await t.picker.begin({}, t.trigger, () => {}); await t.picker.setSource('reference');
            t.move(25, 30); expect(t.picker.sample()?.color.serialized).toBe('#ff0000');
            expect(t.projects.upsert).not.toHaveBeenCalled();
        } finally { t.destroy(); }
    });
    it('maps zoom/pan and nonzero viewBox coordinates; rejects samples outside canvas and workspace', async () => {
        const t = setup();
        try {
            t.surface.style.transformOrigin = '0 0'; t.surface.style.transform = 'translate(30px, 20px) scale(1.5)';
            await t.picker.begin({}, t.trigger, () => {}); await t.picker.setSource('reference');
            t.move(100, 40); expect(t.picker.sample()?.color.serialized).toBe('#0000ff');
            t.move(5, 40); expect(t.picker.sample()).toBeUndefined();
            t.picker.move(1000, 1000); expect(t.picker.sample()).toBeUndefined();
            t.picker.choose(); expect(t.picker.active()).toBeTrue();
        } finally { t.destroy(); }
    });
    it('samples gradient compositing and excludes temporary geometry from the artwork snapshot', async () => {
        const t = setup();
        try {
            t.surface.innerHTML = '<defs><linearGradient id="g"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect x="10" y="20" width="120" height="60" fill="url(#g)"/><rect id="draft" x="10" y="20" width="120" height="60" fill="#00ff00"/>';
            t.svg.tempElements = [{ id: 'draft' }] as any;
            await t.picker.begin({}, t.trigger, () => {}); t.move(70, 40);
            const rgb = t.picker.sample()!.color.rgb;
            expect(rgb.r).toBeCloseTo(127, -1); expect(rgb.b).toBeCloseTo(128, -1); expect(rgb.g).toBe(0);
        } finally { t.destroy(); }
    });
    it('commits exactly one callback, restores focus, and keeps cancellation side-effect free', async () => {
        const t = setup();
        try {
            const apply = jasmine.createSpy('apply'); const before = t.svg.save();
            await t.picker.begin({}, t.trigger, apply); t.move(25, 30); t.picker.cancel();
            expect(apply).not.toHaveBeenCalled(); expect(t.svg.save()).toEqual(before);
            await t.picker.begin({}, t.trigger, apply); t.move(25, 30); t.picker.choose(); t.picker.choose();
            expect(apply).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(t.trigger);
        } finally { t.destroy(); }
    });
    it('cancels on owner destruction, document/history/mode/tool/time changes and stale async completion', async () => {
        const t = setup();
        try {
            const owner = {}, apply = jasmine.createSpy('apply');
            const pending = t.picker.begin(owner, t.trigger, apply); t.picker.cancelOwner(owner); await pending; expect(t.picker.active()).toBeFalse();
            for(const change of [() => t.editor.selectedSVG = undefined, () => t.mutations.mutate(() => t.svg.name = 'Changed', 'metadata'),
                () => t.animation.mode = 'animate', () => t.animation.seek(1), () => t.editor.selectedTool = undefined]) {
                t.editor.selectedSVG = t.svg; t.animation.mode = 'edit'; t.animation.seek(0); t.editor.selectedTool = t.editor.tools[0];
                await t.picker.begin(owner, t.trigger, apply); change(); t.picker.validate(); expect(t.picker.active()).toBeFalse();
            }
            expect(apply).not.toHaveBeenCalled();
        } finally { t.destroy(); }
    });
    it('rejects transparent pixels and image letterboxing, retaining partial alpha', async () => {
        const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 1;
        const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ff000080'; ctx.fillRect(0, 0, 1, 1);
        const image = await decodeSamplingImage(canvas.toDataURL());
        const bounds = fittedImageBounds({ x: 10, y: 20, width: 100, height: 100 }, 2, 1);
        expect(bounds).toEqual({ x: 10, y: 45, width: 100, height: 50 });
        expect(sampleRaster({ image, bounds }, { x: 20, y: 60 })?.color.serialized).toBe('#ff000080');
        expect(sampleRaster({ image, bounds }, { x: 80, y: 60 })).toBeUndefined();
        expect(sampleRaster({ image, bounds }, { x: 20, y: 30 })).toBeUndefined();
    });
    it('routes sampled values through the shared color accessor without duplicate no-op events', async () => {
        const t = setup();
        try {
            const component = new ColorAttribute(t.picker), changed = jasmine.createSpy('changed'); component.registerOnChange(changed);
            component.writeValue(new Color('#00ff00'));
            await t.picker.begin(component, t.trigger, color => { component.writeValue(color); component.onChange(color); });
            component.ngOnDestroy(); expect(t.picker.active()).toBeFalse();
            const begin = spyOn(t.picker, 'begin').and.callFake(async (_owner, _trigger, apply) => apply(new Color('#00ff00')));
            component.pickColor({ stopPropagation() {}, currentTarget: t.trigger } as any); expect(begin).toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
            begin.and.callFake(async (_owner, _trigger, apply) => apply(new Color('#ff000080')));
            component.pickColor({ stopPropagation() {}, currentTarget: t.trigger } as any); expect(changed).toHaveBeenCalledTimes(1);
            expect(component.color.serialized).toBe('#ff000080');
        } finally { t.destroy(); }
    });
    it('offers keyboard focus, source switching, cancellation and a click barrier above the editor', async () => {
        const t = setup();
        try {
            await TestBed.configureTestingModule({ imports: [EyedropperComponent], providers: [{ provide: EyedropperService, useValue: t.picker }] }).compileComponents();
            const fixture = TestBed.createComponent(EyedropperComponent); fixture.detectChanges();
            await t.picker.begin({}, t.trigger, () => {}); fixture.detectChanges();
            const root = fixture.nativeElement as HTMLElement, dialog = root.querySelector('[role=dialog]')!;
            expect(root.querySelectorAll('button').length).toBe(3);
            const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); dialog.dispatchEvent(escape);
            expect(escape.defaultPrevented).toBeTrue(); expect(t.picker.active()).toBeFalse();
        } finally { t.destroy(); }
    });
    it('does not let a pending paint commit cancel sampling, and ignores superseded decoding', async () => {
        const t = setup();
        try {
            t.svg.name = 'Pending change'; t.mutations.schedule();
            const first = jasmine.createSpy('first'), second = jasmine.createSpy('second');
            const a = t.picker.begin({}, t.trigger, first), b = t.picker.begin({}, t.trigger, second);
            await Promise.all([a, b]);
            expect(t.projects.upsert).toHaveBeenCalledTimes(1); expect(t.picker.validate()).toBeTrue();
            t.move(25, 30); t.picker.choose(); expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledTimes(1);
        } finally { t.destroy(); }
    });
});
