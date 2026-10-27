import { EventEmitter } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActionCompositionComponent } from './action-composition.component';
import { ActionCompositionService } from '../../_services/action-composition.service';

describe('ActionCompositionComponent creation disclosure', () => {
    it('keeps context visible and cancels an unsaved name with Escape or a context switch', () => {
        const actions = { actions: [], playback: { contextChanging: new EventEmitter(), currentTime: 0 },
            editor: { selectedElements: [] }, canCreate: () => false, create: jasmine.createSpy('create') };
        TestBed.configureTestingModule({ imports: [ActionCompositionComponent], providers: [{ provide: ActionCompositionService, useValue: actions }] });
        const fixture = TestBed.createComponent(ActionCompositionComponent); fixture.detectChanges();
        const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('button[aria-controls]');
        expect(fixture.nativeElement.querySelector('[aria-label="Animation editing context"]')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('[aria-label="New action name"]')).toBeNull();
        toggle.click(); fixture.detectChanges(); fixture.componentInstance.name = 'Draft';
        fixture.nativeElement.querySelector('[aria-label="New action name"]').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
        fixture.detectChanges(); expect(fixture.componentInstance.name).toBe(''); expect(document.activeElement).toBe(toggle);
        expect(actions.create).not.toHaveBeenCalled();
        toggle.click(); fixture.detectChanges(); actions.playback.contextChanging.emit(); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[aria-label="New action name"]')).toBeNull(); fixture.destroy();
    });
});
