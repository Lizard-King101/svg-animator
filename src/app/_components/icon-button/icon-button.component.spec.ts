import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { faRepeat } from '@fortawesome/free-solid-svg-icons';
import { IconButtonComponent } from './icon-button.component';

describe('IconButtonComponent', () => {
    it('exposes names, toggle state, focus tooltips and disabled commands', fakeAsync(() => {
        const fixture = TestBed.createComponent(IconButtonComponent);
        fixture.componentRef.setInput('icon', faRepeat); fixture.componentRef.setInput('label', 'Loop');
        fixture.componentRef.setInput('tooltip', 'Loop and preview helpers'); fixture.componentRef.setInput('pressed', true);
        fixture.detectChanges();
        const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
        const activated = jasmine.createSpy('activated'); fixture.componentInstance.activated.subscribe(activated);
        expect(button.getAttribute('aria-label')).toBe('Loop'); expect(button.getAttribute('aria-pressed')).toBe('true');
        button.focus();
        // Native focus events may be suppressed in an unfocused headless Karma document.
        if(!document.hasFocus()) button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        tick(300); fixture.detectChanges();
        expect(document.querySelector('[role=tooltip]')?.textContent).toContain('Loop and preview helpers');
        button.click(); expect(activated).toHaveBeenCalledTimes(1);
        button.blur(); button.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); tick(300);
        fixture.componentRef.setInput('disabled', true); fixture.detectChanges(); button.click();
        expect(activated).toHaveBeenCalledTimes(1); fixture.destroy(); tick(300);
        expect(document.querySelector('[role=tooltip]')).toBeNull();
    }));
});
