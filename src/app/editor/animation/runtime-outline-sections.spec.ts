import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { RuntimeScene } from '../../../../packages/runtime/src/scene';
import { fullOutlineSections } from '../../../../packages/runtime/src/outline';
import { createPlayer, RuntimePlayerError, validateRuntimeBundle } from '../../../../packages/runtime/src';
import { EditorService } from '../../_services/editor.service';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { SVGDisplay } from '../../_components/svg-display/svg-display.component';
import { SVG } from '../objects/svg.object';
import { Path } from '../objects/elements/path.object';
import { Point } from '../objects/point.object';
import { Line } from '../objects/line.object';
import { Color } from '../objects/color.object';
import { GradientPaint } from '../objects/paint.object';
import { buildSVGMarkup } from '../svg-markup';
import { pathOutlineContours, projectPathOutline } from '../path-outline';
import { compileRuntimeAnimation } from './runtime-animation-compiler';
import { expectRuntimeDomParity, parseFixtureSvg } from './runtime-dom-parity.spec-support';
import { ImperativeSvgRenderer } from './imperative-svg-renderer';
import { AnimationInspectionSnapshot } from './animation-inspection';

@Component({ standalone: true, imports: [SVGDisplay], template: '<svg display></svg>' })
class OutlineCanvasHost {}

describe('outline rendering parity', () => {
    function fixture() {
        const editor = new EditorService(new EditorPreferencesService());
        const svg = new SVG(editor, { width: 300, height: 300, pos: new Point(0, 0) }), path = new Path(editor);
        const points = [new Point(10, 10), new Point(110, 10), new Point(110, 110), new Point(10, 110)];
        path.lines = points.slice(0, -1).map((point, index) => new Line(editor, { type: 'line', points: [point, points[index + 1]] }));
        path.closed = true; path.settings.fill_enabled = true; path.settings.fill = new Color('#aabbcc'); path.settings.stroke = new Color('#102030'); path.settings.stroke_width = 8;
        path.lines[0].points[1].cornerRadius = 10;
        path.outlineSections = fullOutlineSections(pathOutlineContours(path));
        path.outlineSections[0].fullContour = false;
        path.outlineSections[0].start.t = .2; path.outlineSections[0].end.t = .8;
        path.outlineSections[0].startTaper = { length: .2, tipWidth: 0 }; path.outlineSections[0].endTaper = { length: .1, tipWidth: .4 };
        svg.elements = [path]; editor.selectedSVG = svg;
        return { svg, path, editor };
    }
    function outline(root: ParentNode): SVGPathElement { return root.querySelector('[data-render-role~="outline"]')!; }

    it('projects the same outline in static export and portable playback, leaving fill geometry complete', () => {
        const { svg, path } = fixture(), result = compileRuntimeAnimation(svg.save());
        expect(result.bundle.requiredCapabilities).toContain('render.outline-sections-v1');
        expect(result.bundle.artwork.targets[0].path!.outlineSections).toEqual(path.outlineSections);
        const root = parseFixtureSvg(buildSVGMarkup(svg, { runtime: { signature: result.bundle.artwork.signature } }));
        expect(outline(root).getAttribute('d')).toBe(projectPathOutline(path).strokeData);
        expect(root.querySelector('[data-render-role~="fill"]')!.getAttribute('d')).toBe(path.raw);
        const scene = new RuntimeScene(root, result.bundle.artwork.targets); scene.render();
        expect(outline(root).getAttribute('d')).toBe(projectPathOutline(path).strokeData);
        expect(buildSVGMarkup(svg)).not.toContain('data-render-role');
    });

    it('uses original fill geometry for inside/outside alignment and keeps gradient coordinates stable', () => {
        const { svg, path } = fixture();
        path.settings.stroke = { type: 'linear-gradient', id: 'stroke-gradient', units: 'objectBoundingBox', spreadMethod: 'pad', coordinates: { x1: 0, y1: 0, x2: 1, y2: 1 }, stops: [{ id: 'red', offset: 0, color: new Color('#ff0000'), opacity: 1 }, { id: 'blue', offset: 1, color: new Color('#0000ff'), opacity: 1 }] } satisfies GradientPaint;
        for(const alignment of ['inside', 'outside'] as const) {
            path.settings.stroke_alignment = alignment;
            const result = compileRuntimeAnimation(svg.save()), root = parseFixtureSvg(buildSVGMarkup(svg, { runtime: { signature: result.bundle.artwork.signature } }));
            const effect = root.querySelector(alignment === 'inside' ? 'clipPath path' : 'mask path');
            expect(effect!.getAttribute('d')).toBe(path.raw);
            expect(outline(root).getAttribute('fill')).toBe(`url(#outline-paint-${path.id})`);
            const gradient = root.querySelector(`[id="outline-paint-${path.id}"]`)!;
            expect(gradient.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
            expect(gradient.getAttribute('gradientTransform')).toBe('matrix(100 0 0 100 10 10)');
            new RuntimeScene(root, result.bundle.artwork.targets).render();
            expect(gradient.getAttribute('gradientTransform')).toBe('matrix(100 0 0 100 10 10)');
        }
    });

    it('matches animated geometry, width, dashes and draw progress in imperative and portable rendering', () => {
        const { svg, path } = fixture(); path.settings.stroke_dasharray = [12, 7];
        svg.animation.duration = 2;
        svg.animation.tracks = [
            [`path.points.${path.lines[1].points[1].id}.x`, 110, 160], ['settings.stroke_width', 8, 14],
            ['settings.stroke_dashoffset', 0, 12], ['path.drawProgress', 0, 1],
        ].map(([property, a, b], index) => ({ id: `track-${index}`, targetId: path.id, property: String(property), valueType: 'number' as const, keyframes: [{ id: `a-${index}`, time: 0, value: Number(a) }, { id: `b-${index}`, time: 2, value: Number(b) }] }));
        expectRuntimeDomParity(svg.save(), [0, .5, 1, 2]);
    });

    it('matches zero-length painted round dashes in canvas projection and portable playback', () => {
        const { svg, path } = fixture(); path.settings.stroke_dasharray = [0, 10]; path.settings.line_cap = 'round';
        svg.animation.duration = 1; svg.animation.tracks = [{ id: 'dots', targetId: path.id, property: 'path.drawProgress', valueType: 'number', keyframes: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 1, value: 1 }] }];
        expectRuntimeDomParity(svg.save(), [0, .25, .75, 1]);
        expect(projectPathOutline(path).strokeData).not.toBe('');
    });

    it('refuses excessive authored dash density at zero reveal and pauses safely if animation crosses the limit', () => {
        const { svg, path } = fixture(); path.drawProgress = 0; path.settings.stroke_dasharray = [.000001, .000001];
        expect(compileRuntimeAnimation(svg.save()).diagnostics.some(diagnostic => diagnostic.message.includes('20,000'))).toBeTrue();
        path.settings.stroke_dasharray = [1, 1]; svg.animation.duration = 1;
        svg.animation.tracks = [{ id: 'stretch', targetId: path.id, property: `path.points.${path.lines[1].points[1].id}.x`, valueType: 'number', keyframes: [{ id: 'a', time: 0, value: 110 }, { id: 'b', time: 1, value: 1000000 }] }];
        const result = compileRuntimeAnimation(svg.save()), root = parseFixtureSvg(buildSVGMarkup(svg, { runtime: { signature: result.bundle.artwork.signature } }));
        const player = createPlayer(root, result.bundle), error = jasmine.createSpy('error'); player.on('error', error);
        const before = root.outerHTML;
        expect(() => player.seek(1)).toThrowError(RuntimePlayerError);
        expect(player.state).toBe('paused'); expect(player.time).toBe(0); expect(error).toHaveBeenCalledTimes(1);
        expect(root.outerHTML).toBe(before); player.destroy();
    });

    it('round trips explicit hidden outlines without hiding the fill and rejects invalid runtime metadata', () => {
        const { svg, path } = fixture(); path.outlineSections = [];
        const reopened = SVG.fromSave(svg.save(), { ID: 'reopened' } as never), reopenedPath = reopened.elements[0] as Path;
        expect(reopenedPath.outlineSections).toEqual([]);
        const result = compileRuntimeAnimation(reopened.save()), root = parseFixtureSvg(buildSVGMarkup(reopened, { runtime: { signature: result.bundle.artwork.signature } }));
        expect(outline(root).getAttribute('d')).toBe('');
        expect(root.querySelector('[data-render-role~="fill"]')!.getAttribute('fill')).toBe('#aabbcc');
        result.bundle.requiredCapabilities = result.bundle.requiredCapabilities.filter(capability => capability !== 'render.outline-sections-v1');
        expect(() => validateRuntimeBundle(result.bundle)).toThrowError(RuntimePlayerError);
    });

    it('uses the shared projection in the rendered canvas, including an empty outline', async () => {
        const { editor, path } = fixture();
        await TestBed.configureTestingModule({ imports: [OutlineCanvasHost], providers: [{ provide: EditorService, useValue: editor }] }).compileComponents();
        const component = TestBed.createComponent(OutlineCanvasHost);
        component.detectChanges();
        expect(outline(component.nativeElement).getAttribute('d')).toBe(projectPathOutline(path).strokeData);
        path.outlineSections = []; component.detectChanges();
        expect(outline(component.nativeElement).getAttribute('d')).toBe('');
        expect(component.nativeElement.querySelector('[data-render-role~="fill"]').getAttribute('d')).toBe(path.raw);
        component.destroy();
    });

    it('updates derived outline geometry for a rig deformation marked dirty by the editor evaluator', () => {
        const { svg, path } = fixture(), result = compileRuntimeAnimation(svg.save());
        const root = parseFixtureSvg(buildSVGMarkup(svg, { runtime: { signature: result.bundle.artwork.signature } })), renderer = new ImperativeSvgRenderer(svg, root);
        const before = outline(root).getAttribute('d'); path.lines[1].points[1].x += 30;
        renderer.markDirty(path); renderer.flush();
        expect(outline(root).getAttribute('d')).not.toBe(before);
        expect(outline(root).getAttribute('d')).toBe(projectPathOutline(path).strokeData);
    });

    it('includes the same projected sections in detached onion samples without touching the active path', () => {
        const { svg, path } = fixture(); svg.animation.duration = 1;
        svg.animation.tracks = [{ id: 'draw', targetId: path.id, property: 'path.drawProgress', valueType: 'number', keyframes: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 1, value: 1 }] }];
        const before = svg.save(), detached = SVG.fromSave(before, { ID: 'onion' } as never);
        const skins = new AnimationInspectionSnapshot(detached).skins(.5, .25, [path.id]);
        expect(skins.length).toBe(4);
        for(const skin of skins) {
            const root = parseFixtureSvg(decodeURIComponent(skin.image.split(',')[1]));
            const sampled = detached.elements[0] as Path; sampled.drawProgress = skin.time;
            const outlinePath = root.querySelector(`[id="${path.id}"] > path:last-child`)!;
            expect(outlinePath.getAttribute('d')).toBe(projectPathOutline(sampled).strokeData);
        }
        expect(svg.save()).toEqual(before);
    });

    it('preserves older portable inferred closure while protecting newly explicit open contours', () => {
        const { svg, path, editor } = fixture(); path.outlineSections = undefined; path.closed = false;
        path.lines.push(new Line(editor, { type: 'line', points: [path.lines[path.lines.length - 1].points[1], new Point(10, 10)] }));
        const result = compileRuntimeAnimation(svg.save());
        expect(result.bundle.artwork.targets[0].path!.explicitClosure).toBeTrue();
        expect(result.bundle.requiredCapabilities).toContain('render.outline-sections-v1');
        const root = parseFixtureSvg(buildSVGMarkup(svg, { runtime: { signature: result.bundle.artwork.signature } }));
        new RuntimeScene(root, result.bundle.artwork.targets).render();
        expect(root.querySelector(`[id="${path.id}"]`)!.getAttribute('d')!.endsWith('Z')).toBeFalse();
        delete result.bundle.artwork.targets[0].path!.explicitClosure;
        new RuntimeScene(root, result.bundle.artwork.targets).render();
        expect(root.querySelector(`[id="${path.id}"]`)!.getAttribute('d')!.endsWith('Z')).toBeTrue();
    });
});
