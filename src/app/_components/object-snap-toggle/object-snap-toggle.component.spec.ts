import { TestBed } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { faMagnet } from '@fortawesome/free-solid-svg-icons';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { ObjectSnapToggleComponent } from './object-snap-toggle.component';

describe('object snap toggle', () => {
    afterEach(() => TestBed.resetTestingModule());
    it('exposes a focusable pressed toggle that updates only editor preferences', () => {
        const preferences = { objectSnapping: true, setObjectSnapping: jasmine.createSpy('setObjectSnapping').and.callFake((enabled: boolean) => preferences.objectSnapping = enabled) };
        TestBed.configureTestingModule({ providers: [{ provide: EditorPreferencesService, useValue: preferences }] });
        TestBed.inject(FaIconLibrary).addIcons(faMagnet);
        const fixture = TestBed.createComponent(ObjectSnapToggleComponent); fixture.detectChanges();
        const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(button.tabIndex).toBe(0); expect(button.title).toContain('Alt');
        button.click(); fixture.detectChanges();
        expect(preferences.setObjectSnapping).toHaveBeenCalledOnceWith(false);
        expect(button.getAttribute('aria-pressed')).toBe('false');
        button.click(); fixture.detectChanges();
        expect(button.getAttribute('aria-pressed')).toBe('true');
    });
});
