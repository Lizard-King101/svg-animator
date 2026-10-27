import { ElementRef } from '@angular/core';
import { Subject } from 'rxjs';
import { ActionPlacementBlockComponent, snapPlacementStart } from './action-placement-block.component';

describe('action placement gestures', () => {
    function setup() {
        const host = document.createElement('div'), button = document.createElement('button');
        spyOn(host, 'getBoundingClientRect').and.returnValue({ width: 600 } as DOMRect);
        spyOn(button, 'setPointerCapture'); spyOn(button, 'hasPointerCapture').and.returnValue(false);
        const contextChanging = new Subject<void>();
        const placement = { id: 'p', actionId: 'a', start: 1 };
        const actions = { editor: { selectedSVG: { animation: { duration: 6 } } }, placements: [placement],
            action: () => ({ name: 'Move', animation: { duration: 1 } }),
            playback: { contextChanging, pause: jasmine.createSpy(), seek: jasmine.createSpy(), currentTime: 4 },
            move: jasmine.createSpy(), retime: jasmine.createSpy() };
        const mutations = { revision: 0 };
        const component = new ActionPlacementBlockComponent(actions as never, new ElementRef(host), mutations as never);
        component.placement = placement;
        const event = (clientX: number, altKey = false) => ({ button: 0, pointerId: 1, clientX, altKey,
            currentTarget: button, stopPropagation: () => {} }) as unknown as PointerEvent;
        return { component, actions, mutations, contextChanging, event, placement };
    }
    it('snaps either edge to landmarks and never starts before zero', () => {
        expect(snapPlacementStart(1.94, 1, [3], .08)).toBe(2);
        expect(snapPlacementStart(2.94, 1, [3], .08)).toBe(3);
        expect(snapPlacementStart(-.2, 1, [0], .08)).toBe(0);
        expect(snapPlacementStart(1.234, 1, [5], .08)).toBe(1.23);
    });
    it('previews trim geometry temporarily and commits the start and trim together', () => {
        const t = setup(); t.component.begin(t.event(100), 'in'); t.component.update(t.event(125, true));
        expect(t.component.start).toBe(1.25); expect(t.component.duration).toBe(.75);
        expect(t.placement.start).toBe(1); expect(t.actions.retime).not.toHaveBeenCalled();
        t.component.finish(t.event(125, true));
        expect(t.actions.retime).toHaveBeenCalledOnceWith(t.placement, { start: 1.25, sourceStart: .25, sourceEnd: undefined });
        t.component.ngOnDestroy();
    });
    it('cancels trim drafts and supports keyboard adjustment of either edge', () => {
        const t = setup(); t.component.begin(t.event(100), 'out'); t.component.update(t.event(80, true));
        expect(t.component.duration).toBe(.8);
        t.component.key(new KeyboardEvent('keydown', { key: 'Escape' }), 'out');
        expect(t.component.duration).toBe(1); expect(t.actions.retime).not.toHaveBeenCalled();
        t.component.key(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }), 'out');
        expect(t.actions.retime).toHaveBeenCalledWith(t.placement, { start: 1, sourceStart: undefined, sourceEnd: .9 });
        t.component.ngOnDestroy();
    });
    it('keeps drafts out of the model and commits once on release, suppressing the generated click', () => {
        const t = setup(); t.component.begin(t.event(100)); t.component.update(t.event(294));
        expect(t.component.start).toBe(3); expect(t.placement.start).toBe(1); expect(t.actions.move).not.toHaveBeenCalled();
        t.component.finish(t.event(294)); t.component.preview();
        expect(t.actions.move).toHaveBeenCalledOnceWith(t.placement, 3); expect(t.actions.playback.seek).not.toHaveBeenCalled();
        t.component.ngOnDestroy();
    });
    it('supports unsnapped Alt movement and ignores other pointers', () => {
        const t = setup(); t.component.begin(t.event(100));
        t.component.update({ ...t.event(294), pointerId: 2 }); expect(t.component.start).toBe(1);
        t.component.update(t.event(294, true)); expect(t.component.start).toBeCloseTo(2.94);
        t.component.cancel(); expect(t.component.start).toBe(1); expect(t.actions.move).not.toHaveBeenCalled();
        t.component.ngOnDestroy();
    });
    it('uses the shared ruler scale rather than the visible lane width when zoomed', () => {
        const t = setup(); t.component.pixelsPerSecond = 200; t.component.padding = 28; t.component.domainStart = -1;
        t.component.begin(t.event(100)); t.component.finish(t.event(200));
        expect(t.actions.move).toHaveBeenCalledOnceWith(t.placement, 1.5);
        t.component.ngOnDestroy();
    });
    it('cancels on Escape, context change, history changes, and destruction', () => {
        for(const reason of ['escape', 'context', 'history', 'destroy']) {
            const t = setup(); t.component.begin(t.event(100)); t.component.update(t.event(200));
            if(reason === 'escape') t.component.key(new KeyboardEvent('keydown', { key: 'Escape' }));
            if(reason === 'context') t.contextChanging.next();
            if(reason === 'history') t.mutations.revision++;
            if(reason === 'destroy') t.component.ngOnDestroy();
            t.component.finish(t.event(200)); expect(t.actions.move).not.toHaveBeenCalled(); expect(t.component.start).toBe(1);
            t.component.ngOnDestroy();
        }
    });
    it('clicks preview without creating history, and keyboard arrows nudge precisely', () => {
        const t = setup(); t.component.begin(t.event(100)); t.component.finish(t.event(101)); t.component.preview();
        expect(t.actions.move).not.toHaveBeenCalled(); expect(t.actions.playback.seek).toHaveBeenCalledWith(1);
        t.component.key(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect(t.actions.move).toHaveBeenCalledWith(t.placement, 1.01);
        t.component.key(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }));
        expect(t.actions.move).toHaveBeenCalledWith(t.placement, .9); t.component.ngOnDestroy();
    });
});

