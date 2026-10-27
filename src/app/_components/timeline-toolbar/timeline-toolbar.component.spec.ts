import { EventEmitter } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { faPlay, faStop, faChevronLeft, faChevronRight, faMinus, faPlus, faArrowsLeftRight } from '@fortawesome/free-solid-svg-icons';
import { TimelineToolbarComponent } from './timeline-toolbar.component';
import { TimelineEditorService } from '../../_services/timeline-editor.service';
import { AnimationInspectionService } from '../../_services/animation-inspection.service';
import { DocumentMutationService } from '../../_services/document-mutation.service';

describe('TimelineToolbarComponent progressive controls', () => {
    function setup() {
        const animation = { contextChanging: new EventEmitter<'seek' | 'playback' | void>(), loop: false,
            previewSpeeds: [1], speed: 1, currentTime: 0, duration: 2, workArea: {start: 0, end: 2}, revision: 0 };
        const timeline = { animation, selectedKeyframeIds: new Set(), surfaceMode: 'timeline', easingOptions: [],
            adjacentPoseTime: () => undefined, rows: [], retimeSelection: { count: 0, start: 0, end: 0 },
            graphTracks: () => [], setLoop: jasmine.createSpy('setLoop').and.callFake((loop: boolean) => animation.loop = loop),
        };
        const inspection = { get loopGhosts() { return animation.loop; }, onions: false, motionTrails: false, step: .1 };
        TestBed.configureTestingModule({ imports: [TimelineToolbarComponent], providers: [
            { provide: TimelineEditorService, useValue: timeline }, { provide: AnimationInspectionService, useValue: inspection },
            { provide: DocumentMutationService, useValue: {} },
        ] });
        TestBed.inject(FaIconLibrary).addIcons(faPlay, faStop, faChevronLeft, faChevronRight, faMinus, faPlus, faArrowsLeftRight);
        const fixture = TestBed.createComponent(TimelineToolbarComponent); fixture.detectChanges();
        const button = (name: string): HTMLButtonElement => fixture.nativeElement.querySelector(`button[aria-label="${name}"]`);
        return { fixture, timeline, animation, inspection, button };
    }
    it('retains graph property options across renders and selects a different channel', () => {
        const { fixture, timeline } = setup();
        Object.assign(timeline, {
            surfaceMode: 'graph', selectedGraphProperty: 'transform.translateX',
            graphTrackOptions: () => [
                { property: 'transform.translateX', label: 'X' },
                { property: 'transform.translateY', label: 'Y' },
            ],
            selectGraphProperty: jasmine.createSpy('selectGraphProperty'),
        });
        fixture.detectChanges();
        const select: HTMLSelectElement = fixture.nativeElement.querySelector('select[title="Speed graph property"]');
        const options = Array.from(select.options);
        fixture.detectChanges();
        expect(select.options[0]).toBe(options[0]);
        expect(select.options[1]).toBe(options[1]);
        select.value = select.options[1].value;
        select.dispatchEvent(new Event('change'));
        expect((timeline as any).selectGraphProperty).toHaveBeenCalledOnceWith('transform.translateY');
        fixture.destroy();
    });
    it('keeps onion skins visible and independently toggleable with Loop on or off', () => {
        const { fixture, button, timeline, inspection, animation } = setup();
        button('Loop').click(); fixture.detectChanges();
        expect(timeline.setLoop).toHaveBeenCalledOnceWith(true);
        expect(button('Loop').getAttribute('aria-pressed')).toBe('true');
        expect(button('Onion skins').getAttribute('aria-pressed')).toBe('false');
        button('Onion skins').click(); fixture.detectChanges();
        expect(inspection.onions).toBeTrue();
        expect(button('Onion skins').getAttribute('aria-pressed')).toBe('true');
        expect(animation.loop).toBeTrue();
        button('Onion skins').click(); fixture.detectChanges();
        expect(inspection.onions).toBeFalse();
        expect(animation.loop).toBeTrue();
        button('Onion skins').click();
        button('Loop').click(); fixture.detectChanges();
        expect(inspection.onions).toBeTrue();
        expect(button('Onion skins').getAttribute('aria-pressed')).toBe('true');
        button('Onion skins').click(); fixture.detectChanges();
        expect(inspection.onions).toBeFalse();
        expect(animation.loop).toBeFalse();
        fixture.destroy();
    });
    it('opens one detail panel, restores focus on Escape, and closes it when context changes', () => {
        const { fixture, button, animation } = setup();
        expect(fixture.nativeElement.querySelector('#timeline-view-options')).toBeNull();
        button('View options').click(); fixture.detectChanges();
        const input = fixture.nativeElement.querySelector('#timeline-view-options input'); input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#timeline-view-options')).toBeNull();
        expect(document.activeElement).toBe(button('View options'));
        button('View options').click(); button('Loop tools').click(); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#timeline-view-options')).toBeNull();
        expect(fixture.nativeElement.querySelector('#timeline-loop-tools')).not.toBeNull();
        animation.contextChanging.emit(); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#timeline-loop-tools')).toBeNull();
        fixture.destroy();
    });
});
