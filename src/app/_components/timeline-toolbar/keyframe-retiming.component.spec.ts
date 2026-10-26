import { EventEmitter } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KeyframeRetimingComponent } from './keyframe-retiming.component';
import { TimelineEditorService } from '../../_services/timeline-editor.service';

describe('KeyframeRetimingComponent', () => {
    function setup() {
        const timeline = { retimeSelection: { count: 2, start: 0, end: 1, signature: 'keys' },
            activeAnimation: {}, animation: { revision: 0, currentTime: .5, pause: () => {}, contextChanging: new EventEmitter() },
            planSelectedKeyRetime: jasmine.createSpy('plan').and.returnValue({ updates: [] }),
            retimeSelectedKeys: jasmine.createSpy('retime').and.returnValue(true),
        };
        TestBed.configureTestingModule({ imports: [KeyframeRetimingComponent], providers: [{ provide: TimelineEditorService, useValue: timeline }] });
        const fixture = TestBed.createComponent(KeyframeRetimingComponent); fixture.detectChanges();
        const component = fixture.componentInstance;
        (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click(); fixture.detectChanges();
        return { fixture, component, timeline };
    }
    it('stages timing until submit and restores focus after one apply', () => {
        const { fixture, component, timeline } = setup();
        component.percent = 50; component.pivot = 'center'; fixture.detectChanges();
        expect(timeline.retimeSelectedKeys).not.toHaveBeenCalled();
        fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        expect(timeline.retimeSelectedKeys).toHaveBeenCalledOnceWith({ kind: 'scale', factor: .5, pivot: 'center', playhead: .5 });
        expect(component.open).toBeFalse();
        expect(document.activeElement).toBe(fixture.nativeElement.querySelector('button'));
    });
    it('cancels with Escape without applying draft values', () => {
        const { fixture, component, timeline } = setup(); component.percent = 200;
        fixture.nativeElement.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(component.open).toBeFalse(); expect(timeline.retimeSelectedKeys).not.toHaveBeenCalled();
    });
    it('discards stale selection, history and context drafts', () => {
        const { component, timeline } = setup();
        timeline.retimeSelection.signature = 'different'; component.apply('reverse');
        expect(timeline.retimeSelectedKeys).not.toHaveBeenCalled(); expect(component.open).toBeFalse();
        component.togglePanel(); timeline.animation.revision++; component.ngDoCheck(); expect(component.open).toBeFalse();
        component.togglePanel(); timeline.animation.contextChanging.emit(); expect(component.open).toBeFalse();
    });
    it('shows a preflight problem and does not apply either button through invalid state', () => {
        const { component, timeline, fixture } = setup();
        timeline.planSelectedKeyRetime.and.returnValue({ updates: [], problem: 'Collision' } as any);
        component.percent = 200; fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Collision');
        expect(fixture.nativeElement.querySelector('button[type=submit]').disabled).toBeTrue();
        component.apply('reverse'); expect(timeline.retimeSelectedKeys).not.toHaveBeenCalled();
    });
});
