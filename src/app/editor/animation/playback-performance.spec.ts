import { LatestFrame } from '../latest-frame';
import { PlaybackDiagnostics } from './playback-diagnostics';
import { PlaybackTimelineView } from './playback-timeline-view';
import { RenderNodeCache } from './render-node-cache';

describe('playback performance lifetimes', () => {
    it('coalesces pointer previews, flushes the release position, and drops cancelled samples', () => {
        let callback: FrameRequestCallback | undefined;
        const request = spyOn(window, 'requestAnimationFrame').and.callFake(value => { callback = value; return 1; });
        spyOn(window, 'cancelAnimationFrame');
        const consume = jasmine.createSpy('preview'), frame = new LatestFrame<number>(consume);
        frame.queue(1); frame.queue(2); frame.queue(3);
        expect(request).toHaveBeenCalledTimes(1); expect(consume).not.toHaveBeenCalled();
        callback!(16); expect(consume).toHaveBeenCalledOnceWith(3);
        frame.queue(4); frame.queue(5); frame.flush();
        expect(consume).toHaveBeenCalledWith(5);
        frame.queue(6); frame.cancel(); callback!(32);
        expect(consume.calls.count()).toBe(2);
    });
    it('keeps diagnostics opt-in and bounded, and reports missed refresh opportunities', () => {
        const diagnostics = new PlaybackDiagnostics();
        const sample = { time: 0, evaluation: 1, rigs: 2, render: 3, total: 6, interval: 10 };
        diagnostics.record(sample); expect(diagnostics.report().samples).toBe(0);
        diagnostics.start(10);
        for(let index = 0; index < 2000; index++) diagnostics.record(sample);
        diagnostics.record({ ...sample, interval: 30 });
        const report = diagnostics.report();
        expect(report.samples).toBe(1800); expect(report.total.p95).toBe(6);
        expect(report.refreshInterval).toBe(10); expect(report.missedRefreshes).toBe(2);
        diagnostics.stop(); diagnostics.record(sample); expect(diagnostics.report()).toEqual(report);
    });
    it('refreshes cached render roles after same-ID DOM replacement, including empty lookups', () => {
        const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        root.innerHTML = '<g id="art"><path data-render-role="fill"/></g>';
        const node = root.firstElementChild as SVGElement, cache = new RenderNodeCache(root);
        try {
            const first = cache.paint(node, 'fill'); expect(cache.paint(node, 'fill')).toBe(first);
            expect(cache.query(node, '.extra')).toEqual([]);
            node.innerHTML = '<path data-render-role="fill" class="extra"/>';
            expect(cache.paint(node, 'fill')[0]).not.toBe(first[0]);
            expect(cache.query(node, '.extra').length).toBe(1);
        } finally { cache.destroy(); }
    });
    it('refreshes timeline references after remount and reads changed zoom without rebuilding', () => {
        const doc = document.implementation.createHTMLDocument();
        doc.body.innerHTML = '<div class="animation-playhead" data-pixels-per-second="100"></div><input class="timeline-current-time">';
        const view = new PlaybackTimelineView(doc);
        try {
            view.update(1);
            const old = doc.querySelector('div')!;
            expect(old.style.left).toBe('128px');
            old.dataset['pixelsPerSecond'] = '200'; view.update(1); expect(old.style.left).toBe('228px');
            doc.body.innerHTML = '<div class="animation-playhead" data-domain-start="2"></div><input class="timeline-current-time">';
            view.update(3);
            expect(doc.querySelector('div')!.style.left).toBe('148px');
            expect(doc.querySelector('input')!.value).toBe('3');
        } finally { view.destroy(); }
    });
});
