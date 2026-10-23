import { TestBed } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { faRightLeft } from '@fortawesome/free-solid-svg-icons';
import { ProjectColorsComponent } from './project-colors.component';
import { ProjectColorsService } from '../../_services/project-colors.service';
import { PaintEditorComponent } from '../paint-editor/paint-editor.component';
import { DrawingColorsComponent } from '../drawing-colors/drawing-colors.component';
import { EditorService } from '../../_services/editor.service';
import { Color } from '../../editor/objects/color.object';
import { createDefaultGradient } from '../../editor/objects/paint.object';

describe('Shared project palette controls', () => {
    const palette = { available: true, colors: [{ color: '#12345680', name: 'Shadow', pinned: true }],
        rename: jasmine.createSpy('rename'), pin: jasmine.createSpy('pin'), remember: jasmine.createSpy('remember') };
    beforeEach(async () => {
        palette.rename.calls.reset(); palette.pin.calls.reset(); palette.remember.calls.reset();
        await TestBed.configureTestingModule({ imports: [ProjectColorsComponent, PaintEditorComponent, DrawingColorsComponent],
            providers: [EditorService, { provide: ProjectColorsService, useValue: palette }] }).compileComponents();
        TestBed.inject(FaIconLibrary).addIcons(faRightLeft);
    });
    afterEach(() => localStorage.removeItem('svg-animator.editor-preferences.v1'));
    it('applies the same palette value to solid paint and the selected gradient stop', () => {
        const fixture = TestBed.createComponent(PaintEditorComponent), component = fixture.componentInstance;
        fixture.componentRef.setInput('paint', new Color('#ffffff')); fixture.detectChanges();
        const emit = spyOn(component.paintChange, 'emit');
        fixture.nativeElement.querySelector('app-project-colors button.swatch').click();
        expect(emit).toHaveBeenCalledWith({ type: 'solid-color', color: jasmine.any(Color) });
        const change = emit.calls.mostRecent().args[0]; if(change?.type === 'solid-color') expect(change.color.serialized).toBe('#12345680');
        const gradient = createDefaultGradient('gradient'); fixture.componentRef.setInput('paint', gradient); fixture.detectChanges();
        component.selectStop(gradient.stops[1]); fixture.detectChanges();
        fixture.nativeElement.querySelector('app-project-colors button.swatch').click();
        expect(emit).toHaveBeenCalledWith({ type: 'stop', stopId: gradient.stops[1].id, field: 'color', value: jasmine.any(Color) });
        expect(palette.remember).not.toHaveBeenCalled(); // The artwork mutation owns collection.
    });
    it('previews swatches in drawing edits until Apply; cancellation does not collect a choice', () => {
        const fixture = TestBed.createComponent(DrawingColorsComponent); fixture.detectChanges();
        const component = fixture.componentInstance, before = component.paint;
        fixture.nativeElement.querySelector('[aria-label="New artwork fill"]').click(); fixture.detectChanges();
        fixture.nativeElement.querySelector('app-project-colors button.swatch').click(); fixture.detectChanges();
        expect(component.draft.serialized).toBe('#12345680'); expect(component.paint).toEqual(before);
        component.cancel(); fixture.detectChanges();
        expect(component.paint).toEqual(before); expect(palette.remember).not.toHaveBeenCalled();
        fixture.nativeElement.querySelector('[aria-label="New artwork fill"]').click(); fixture.detectChanges();
        fixture.nativeElement.querySelector('app-project-colors button.swatch').click(); component.apply();
        expect(component.paint.fill).toBe('#12345680'); expect(palette.remember).toHaveBeenCalledOnceWith('#12345680');
    });
    it('exposes alpha and pin state, commits names on blur and cancels name drafts with Escape', () => {
        const fixture = TestBed.createComponent(ProjectColorsComponent); fixture.componentRef.setInput('manage', true); fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector('button.swatch')?.getAttribute('aria-label')).toContain('50% opacity');
        const input = root.querySelector('input')!;
        input.value = 'Discard'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(input.value).toBe('Shadow'); expect(palette.rename).not.toHaveBeenCalled();
        input.value = 'Ink'; input.dispatchEvent(new Event('blur')); expect(palette.rename).toHaveBeenCalledWith('#12345680', 'Ink');
        (root.querySelector('[aria-label="Unpin Shadow"]') as HTMLButtonElement).click();
        expect(palette.pin).toHaveBeenCalledOnceWith('#12345680', false);
    });
});
