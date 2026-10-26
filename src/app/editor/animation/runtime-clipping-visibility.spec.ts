import { createPlayer, RuntimePlayerError, validateRuntimeBundle } from '../../../../packages/runtime/src';
import { RuntimeScene } from '../../../../packages/runtime/src/scene';
import { fullOutlineSections } from '../../../../packages/runtime/src/outline';
import { EditorService } from '../../_services/editor.service';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { SVG } from '../objects/svg.object';
import { Path } from '../objects/elements/path.object';
import { Shape } from '../objects/elements/shape.object';
import { Group } from '../objects/elements/group.object';
import { Point } from '../objects/point.object';
import { Line } from '../objects/line.object';
import { Color } from '../objects/color.object';
import { buildSVGMarkup } from '../svg-markup';
import { pathOutlineContours } from '../path-outline';
import { compileRuntimeAnimation } from './runtime-animation-compiler';
import { expectRuntimeDomParity, parseFixtureSvg } from './runtime-dom-parity.spec-support';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SVGDisplay } from '../../_components/svg-display/svg-display.component';
import { GradientPaint } from '../objects/paint.object';

@Component({ standalone: true, imports: [SVGDisplay], template: '<svg display></svg>' })
class ClippingCanvasHost {}

describe('visible clipping source playback', () => {
    function fixture() {
        const editor = new EditorService(new EditorPreferencesService());
        const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0, 0) });
        const source = new Path(editor), group = new Group(editor), content = new Shape(editor, { type: 'ellipse', position: new Point(0, 0) });
        const points = [new Point(10, 10), new Point(110, 10), new Point(110, 90), new Point(10, 90)];
        source.lines = points.slice(0, -1).map((point, index) => new Line(editor, { type: 'line', points: [point, points[index + 1]] }));
        source.closed = true; source.visible = false; source.settings.fill_enabled = true;
        source.settings.fill = new Color('#ffffff'); source.settings.stroke = new Color('#302040'); source.settings.stroke_width = 8;
        source.outlineSections = fullOutlineSections(pathOutlineContours(source));
        source.outlineSections[0].fullContour = false; source.outlineSections[0].end = { segmentId: source.lines[0].id, t: 1 };
        source.outlineSections[0].startTaper = { length: .2, tipWidth: 0 };
        content.position = new Point(40, 20); content.settings.width = 50; content.settings.height = 100;
        content.settings.fill = new Color('#206080');
        group.elements = [source, content]; group.clipElementId = source.id; svg.elements = [group]; editor.selectedSVG = svg;
        return { svg, source, group, content, editor };
    }
    function projection(root: ParentNode, id: string, kind: string): SVGElement {
        return root.querySelector(`[data-render-target="${id}"][data-render-projection="${kind}"]`)!;
    }

    it('advertises explicit visibility semantics and keeps hidden sources in group origin geometry', () => {
        const { svg, source, group } = fixture();
        const hidden = compileRuntimeAnimation(svg.save()).bundle;
        source.visible = true;
        const visible = compileRuntimeAnimation(svg.save()).bundle;
        expect(hidden.requiredCapabilities).toContain('render.visible-clipping-v1');
        expect(hidden.artwork.targets.find(target => target.id === group.id)!.clipping!.sourceVisibility).toBeTrue();
        expect(hidden.artwork.targets.find(target => target.id === group.id)!.geometry).toEqual(visible.artwork.targets.find(target => target.id === group.id)!.geometry);
        hidden.requiredCapabilities = hidden.requiredCapabilities.filter(capability => capability !== 'render.visible-clipping-v1');
        expect(() => validateRuntimeBundle(hidden)).toThrowError(RuntimePlayerError, /visible-clipping/);
    });

    it('animates hidden clip geometry and toggles only its paint while matching editor playback', () => {
        const { svg, source } = fixture();
        svg.animation.duration = 1;
        svg.animation.tracks = [
            { id: 'visible', targetId: source.id, property: 'visible', valueType: 'boolean', keyframes: [{ id: 'off', time: 0, value: false }, { id: 'on', time: 1, value: true }] },
            ...([['transform.translateX', 0, 20], [`path.points.${source.lines[0].points[1].id}.y`, 10, 30], ['opacity', .4, .8], ['path.drawProgress', 0, 1], ['settings.stroke_width', 8, 12]] as const).map(([property, start, end], index) => ({
                id: `number-${index}`, targetId: source.id, property, valueType: 'number' as const, keyframes: [{ id: `a-${index}`, time: 0, value: start }, { id: `b-${index}`, time: 1, value: end }],
            })),
        ];
        expectRuntimeDomParity(svg.save(), [0, .5, 1], ({ time, runtimeRoot }) => {
            const clip = projection(runtimeRoot, source.id, 'clip');
            const fill = projection(runtimeRoot, source.id, 'fill'), stroke = projection(runtimeRoot, source.id, 'stroke');
            expect(clip).not.toBeNull(); expect(fill).not.toBeNull(); expect(stroke).not.toBeNull();
            expect(clip.style.display).not.toBe('none'); expect(clip.getAttribute('opacity')).toBeNull();
            expect(fill.style.display).toBe(time === 1 ? '' : 'none'); expect(stroke.style.display).toBe(time === 1 ? '' : 'none');
            expect(clip.getAttribute('transform')).toBe(fill.getAttribute('transform'));
            const geometry = clip.tagName.toLowerCase() === 'path' ? clip : clip.querySelector('path')!;
            expect(geometry.getAttribute('d')!.replace(/,/g, ' ').replace(/\s+/g, ' ')).toContain(time === 1 ? '110 30' : time === .5 ? '110 20' : '110 10');
            expect(geometry.hasAttribute('pathLength')).toBeFalse();
        });
    });

    it('updates projected native shapes and keeps the source outline outside its own clip', () => {
        const { svg, content, group, editor } = fixture();
        const eye = new Shape(editor, { type: 'ellipse', position: new Point(0, 0) }); eye.position = new Point(10, 10); eye.settings.width = 100; eye.settings.height = 80; eye.visible = true;
        eye.settings.fill = new Color('#ffffff'); eye.settings.stroke = new Color('#000000'); eye.settings.stroke_alignment = 'outside';
        group.elements = [eye, content]; group.clipElementId = eye.id;
        svg.animation.duration = 1;
        svg.animation.tracks = [{ id: 'width', targetId: eye.id, property: 'geometry.width', valueType: 'number', keyframes: [{ id: 'a', time: 0, value: 100 }, { id: 'b', time: 1, value: 150 }] }];
        expectRuntimeDomParity(svg.save(), [0, .5, 1], ({ runtimeRoot }) => {
            const stroke = projection(runtimeRoot, eye.id, 'stroke');
            expect(stroke.parentElement!.hasAttribute('clip-path')).toBeFalse();
            expect(stroke.closest(`[clip-path="url(#clip-${group.id})"]`)).toBeNull();
        });
    });

    it('preserves legacy bundle semantics with an unprojected clipping source', () => {
        const { svg, source } = fixture(), bundle = compileRuntimeAnimation(svg.save()).bundle;
        bundle.artwork.targets.forEach(target => { if(target.clipping) delete target.clipping.sourceVisibility; });
        bundle.requiredCapabilities = bundle.requiredCapabilities.filter(capability => capability !== 'render.visible-clipping-v1');
        expect(() => validateRuntimeBundle(bundle)).not.toThrow();
        const root = parseFixtureSvg(`<svg xmlns="http://www.w3.org/2000/svg"><clipPath id="legacy"><path id="${source.id}" d="M0 0"/></clipPath></svg>`);
        new RuntimeScene(root, bundle.artwork.targets).render();
        expect((root.querySelector(`[id="${source.id}"]`) as SVGElement).style.display).toBe('none');
    });

    it('restores all projection attributes when the portable player is destroyed', () => {
        const { svg, source } = fixture(), result = compileRuntimeAnimation(svg.save());
        const root = parseFixtureSvg(buildSVGMarkup(svg, { runtime: { signature: result.bundle.artwork.signature } }));
        const before = root.outerHTML;
        const player = createPlayer(root, result.bundle);
        expect(projection(root, source.id, 'clip').style.display).not.toBe('none');
        player.destroy(); expect(root.outerHTML).toBe(before);
    });

    it('places the visible fill behind clipped artwork and its tapered outline above in the canvas', async () => {
        const { editor, source, group } = fixture();
        await TestBed.configureTestingModule({ imports: [ClippingCanvasHost], providers: [{ provide: EditorService, useValue: editor }] }).compileComponents();
        const component = TestBed.createComponent(ClippingCanvasHost); component.detectChanges();
        const root = component.nativeElement as HTMLElement;
        expect(projection(root, source.id, 'clip').style.display).not.toBe('none');
        expect(projection(root, source.id, 'fill').style.display).toBe('none');
        source.visible = true; component.detectChanges();
        const fill = projection(root, source.id, 'fill'), stroke = projection(root, source.id, 'stroke');
        const clipped = root.querySelector(`[clip-path="url(#clip-${group.id})"]`)!;
        expect(fill.style.display).not.toBe('none'); expect(stroke.style.display).not.toBe('none');
        expect(fill.compareDocumentPosition(clipped) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(clipped.compareDocumentPosition(stroke) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(stroke.querySelector('[data-render-role~="outline"]')).not.toBeNull();
        expect(stroke.closest(`[clip-path="url(#clip-${group.id})"]`)).toBeNull();
        component.destroy();
    });

    it('resolves projected gradient aliases and sibling dash masks while geometry changes', () => {
        const { svg, source } = fixture(); source.visible = true; source.settings.stroke_alignment = 'outside';
        source.settings.stroke = { type: 'linear-gradient', id: 'outline-gradient', units: 'objectBoundingBox', spreadMethod: 'pad', coordinates: { x1: 0, x2: 1, y1: 0, y2: 1 }, stops: [{ id: 'red', offset: 0, color: new Color('#ff0000'), opacity: 1 }, { id: 'blue', offset: 1, color: new Color('#0000ff'), opacity: 1 }] } satisfies GradientPaint;
        svg.animation.duration = 1;
        svg.animation.tracks = [{ id: 'geometry', targetId: source.id, property: `path.points.${source.lines[0].points[1].id}.x`, valueType: 'number', keyframes: [{ id: 'a', time: 0, value: 110 }, { id: 'b', time: 1, value: 140 }] }];
        expectRuntimeDomParity(svg.save(), [0, 1], ({ runtimeRoot }) => {
            const stroke = projection(runtimeRoot, source.id, 'stroke'), gradient = stroke.querySelector('linearGradient')!;
            expect(stroke.querySelector('[data-render-role~="outline"]')!.getAttribute('fill')).toBe(`url(#${gradient.id})`);
        });
        source.outlineSections = undefined; source.settings.stroke_dasharray = [8, 5];
        svg.animation.tracks.push({ id: 'draw', targetId: source.id, property: 'path.drawProgress', valueType: 'number', keyframes: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 1, value: 1 }] });
        expectRuntimeDomParity(svg.save(), [.5, 1], ({ time, runtimeRoot }) => {
            const clip = projection(runtimeRoot, source.id, 'clip');
            const effect = runtimeRoot.querySelector(`[data-render-target="stroke-outside-${source.id}"] [data-render-role~="geometry-effect"]`)!;
            const reveal = runtimeRoot.querySelector(`[data-render-target="stroke-draw-${source.id}"] [data-render-role~="reveal"]`)!;
            expect(effect.getAttribute('d')).toBe(clip.getAttribute('d'));
            expect(reveal.getAttribute('d')).toBe(clip.getAttribute('d'));
            expect(Number(reveal.getAttribute('stroke-dashoffset'))).toBe(1 - time);
        });
    });

    it('keeps a hidden group source active while honoring visibility of its children', () => {
        const { svg, source, group, content, editor } = fixture();
        const sourceGroup = new Group(editor), hiddenChild = new Shape(editor, { type: 'rectangle', position: new Point(130, 10), width: 20, height: 30 });
        source.visible = true; hiddenChild.visible = false; sourceGroup.visible = false;
        sourceGroup.elements = [source, hiddenChild]; group.elements = [sourceGroup, content]; group.clipElementId = sourceGroup.id;
        svg.animation.duration = 1;
        svg.animation.tracks = [{ id: 'group-visible', targetId: sourceGroup.id, property: 'visible', valueType: 'boolean', keyframes: [{ id: 'off', time: 0, value: false }, { id: 'on', time: 1, value: true }] }];
        expectRuntimeDomParity(svg.save(), [0, 1], ({ time, runtimeRoot }) => {
            expect(projection(runtimeRoot, sourceGroup.id, 'clip').style.display).not.toBe('none');
            expect(projection(runtimeRoot, sourceGroup.id, 'fill').style.display).toBe(time ? '' : 'none');
            expect(projection(runtimeRoot, source.id, 'clip-child').style.display).not.toBe('none');
            expect(projection(runtimeRoot, hiddenChild.id, 'clip-child').style.display).toBe('none');
            const ids = [...runtimeRoot.querySelectorAll('[id]')].map(node => node.id);
            expect(new Set(ids).size).toBe(ids.length);
        });
    });
});
