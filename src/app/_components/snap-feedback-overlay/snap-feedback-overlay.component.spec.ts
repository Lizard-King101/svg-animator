import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MoveSnapFeedback } from '../../editor/objects/snapping.object';
import { SnapFeedbackOverlayComponent, projectMoveSnapFeedback, projectPointSnapFeedback, projectEdgeRotationFeedback } from './snap-feedback-overlay.component';

const target = { x: 100, y: 120, width: 80, height: 40 };
const feedback: MoveSnapFeedback = {
    bounds: { x: 60, y: 120, width: 40, height: 20 },
    matches: [
        { feature: 'end', correction: 3, candidate: { id: 'x', axis: 'x', value: 100, source: 'geometry', label: 'Left · Reference', extent: [120, 160], target } },
        { feature: 'start', correction: 3, candidate: { id: 'y', axis: 'y', value: 120, source: 'geometry', label: 'Top · Reference', extent: [100, 180], target } },
    ],
};
@Component({
    standalone: true, imports: [SnapFeedbackOverlayComponent],
    template: `<svg><g snapFeedbackOverlay [display]="display" /></svg>`,
})
class Host {
    display = projectMoveSnapFeedback(feedback, { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 }, { x: 0, y: 0, width: 600, height: 400 });
}

describe('move snap feedback', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('renders contact symbols and highlights the two aligned edges in workspace pixels', () => {
        const fixture = TestBed.createComponent(Host), matrix = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }, viewport = { x: 24, y: 24, width: 400, height: 300 };
        for(const kind of ['tangent', 'perpendicular'] as const) {
            fixture.componentInstance.display = projectPointSnapFeedback({ target: {
                id: 'contact', point: { x: 100, y: 120 }, kind, label: kind,
            } }, matrix, viewport)!;
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('.snap-marker').tagName).toBe('path');
            expect(fixture.nativeElement.querySelector('text').textContent).toBe(kind);
        }
        fixture.componentInstance.display = projectEdgeRotationFeedback({
            moving: { id: 'a', label: 'Moving', start: { x: 100, y: 100 }, end: { x: 180, y: 100 } },
            reference: { id: 'b', label: 'Reference', start: { x: 100, y: 200 }, end: { x: 180, y: 200 } },
        }, matrix, viewport); fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('.snap-line').length).toBe(2);
        expect(fixture.componentInstance.display.lines[0]).toEqual({ x1: 200, y1: 200, x2: 360, y2: 200 });
        expect(fixture.nativeElement.querySelector('text').textContent).toBe('Parallel · Reference');
    });

    it('distinguishes sliding path snaps from discrete intersection targets', () => {
        const fixture = TestBed.createComponent(Host);
        for(const kind of ['path', 'intersection'] as const) {
            fixture.componentInstance.display = projectPointSnapFeedback({ target: {
                id: 'point', point: { x: 100, y: 120 }, kind, label: kind,
            } }, { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }, { x: 24, y: 24, width: 400, height: 300 })!;
            fixture.detectChanges();
            const marker: SVGElement = fixture.nativeElement.querySelector('.snap-marker');
            expect(marker.tagName).toBe(kind === 'path' ? 'rect' : 'path');
            expect(marker.parentElement!.getAttribute('transform')).toBe('translate(200 240)');
            expect(marker.getAttribute(kind === 'path' ? 'width' : 'd')).toBe(kind === 'path' ? '10' : 'M -6 -6 L 6 6 M -6 6 L 6 -6');
        }
    });

    it('uses fixed-size anchor circles and midpoint diamonds with clamped labels for path points', () => {
        const fixture = TestBed.createComponent(Host);
        for(const kind of ['anchor', 'midpoint'] as const) for(const zoom of [.5, 1, 2]) {
            fixture.componentInstance.display = projectPointSnapFeedback({ target: {
                id: 'point', point: { x: 100, y: 120 }, kind, label: `${kind} · Reference`,
            } }, { a: zoom, b: 0, c: 0, d: zoom, e: 30, f: 40 }, { x: 24, y: 24, width: 400, height: 300 })!;
            fixture.detectChanges();
            const marker: SVGElement = fixture.nativeElement.querySelector('.snap-marker');
            expect(marker.tagName).toBe(kind === 'anchor' ? 'circle' : 'polygon');
            expect(marker.parentElement!.getAttribute('transform')).toBe(`translate(${100 * zoom + 30} ${120 * zoom + 40})`);
            expect(marker.getAttribute(kind === 'anchor' ? 'r' : 'points')).toBe(kind === 'anchor' ? '6' : '0,-7 7,0 0,7 -7,0');
            expect(fixture.componentInstance.display.labels[0].y).toBeGreaterThanOrEqual(30);
        }
    });

    it('projects targets and lines but retains screen-pixel padding and readable labels at zoom', () => {
        const display = new Host().display;
        expect(display.targets).toEqual([{ x: 300, y: 290, width: 160, height: 80 }]);
        expect(display.lines[0]).toEqual({ x1: 300, x2: 300, y1: 280, y2: 380 });
        expect(display.lines[1]).toEqual({ y1: 290, y2: 290, x1: 210, x2: 470 });
        expect(display.labels[0].text).toBe('Right → Left · Reference');
        expect(display.labels[1].y - display.labels[0].y).toBe(26);
        for(const label of display.labels) {
            expect(label.x + label.width).toBeLessThanOrEqual(594);
            expect(label.y + 22).toBeLessThanOrEqual(394);
        }
    });

    it('keeps labels inside the workspace when targets extend past the artboard', () => {
        const display = projectMoveSnapFeedback(feedback, { a: .25, b: 0, c: 0, d: .25, e: -200, f: 700 }, { x: 0, y: 0, width: 250, height: 180 });
        expect(display.labels[0].x).toBe(6);
        expect(display.labels[0].y).toBe(122);
        expect(display.labels[1].y + 22).toBeLessThanOrEqual(174);
    });

    it('renders only passive feedback above the editor controls', () => {
        const fixture = TestBed.createComponent(Host); fixture.detectChanges();
        const host: SVGGElement = fixture.nativeElement.querySelector('g[snapFeedbackOverlay]');
        expect(host.getAttribute('pointer-events')).toBe('none');
        expect(getComputedStyle(host).pointerEvents).toBe('none');
        expect(host.querySelectorAll('.snap-target').length).toBe(1);
        expect(host.querySelectorAll('.snap-line').length).toBe(2);
        expect(host.querySelectorAll('[data-transform-handle], [tabindex], button').length).toBe(0);
    });
});
