import { TestBed } from '@angular/core/testing';
import { DrawingColorsComponent } from './drawing-colors.component';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { EditorService } from '../../_services/editor.service';
import { Color } from '../../editor/objects/color.object';

describe('Drawing colors controls', () => {
    const key = 'svg-animator.editor-preferences.v1';
    beforeEach(async () => {
        localStorage.removeItem(key);
        await TestBed.configureTestingModule({ imports: [DrawingColorsComponent], providers: [EditorService] }).compileComponents();
    });
    afterEach(() => localStorage.removeItem(key));

    it('stages a color, cancels with Escape, then applies once and restores focus', async () => {
        const fixture = TestBed.createComponent(DrawingColorsComponent); fixture.detectChanges();
        const component = fixture.componentInstance, preferences = TestBed.inject(EditorPreferencesService);
        const original = preferences.drawingPaint;
        const commit = spyOn(preferences, 'setDrawingPaint').and.callThrough();
        const fill = fixture.nativeElement.querySelector('[aria-label="New artwork fill"]') as HTMLButtonElement;
        const focus = spyOn(fill, 'focus');
        fill.click(); fixture.detectChanges(); await fixture.whenStable();
        component.setColor(new Color('#ff000080'));
        expect(preferences.drawingPaint).toEqual(original);
        fixture.nativeElement.querySelector('section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges(); expect(component.target).toBeUndefined(); expect(commit).not.toHaveBeenCalled();
        expect(focus).toHaveBeenCalled();
        fill.click(); fixture.detectChanges(); component.setColor(new Color('#ff000080')); component.apply(); fixture.detectChanges();
        expect(commit).toHaveBeenCalledTimes(1);
        expect(new EditorPreferencesService().drawingPaint.fill).toBe('#ff000080');
    });

    it('supports no paint, transparent colors, swap, and visible warnings', () => {
        const fixture = TestBed.createComponent(DrawingColorsComponent); fixture.detectChanges();
        const component = fixture.componentInstance;
        const stroke = fixture.nativeElement.querySelector('[aria-label="New artwork stroke"]') as HTMLButtonElement;
        stroke.click(); fixture.detectChanges();
        const checkbox = fixture.nativeElement.querySelector('input[type=checkbox]') as HTMLInputElement;
        checkbox.click(); component.apply(); fixture.detectChanges();
        expect(component.paint.stroke).toBeNull();
        expect(fixture.nativeElement.querySelector('[role=status]').textContent).toContain('Open paths');
        component.swap(); expect(component.paint.fill).toBeNull(); expect(component.paint.stroke).toBe('#2dd4bf');
        component.preferences.setDrawingPaint({ fill: '#ffffff00', stroke: null }); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role=status]').textContent).toContain('New artwork will be invisible');
    });

    it('discards an unfinished edit on document or tool changes', () => {
        const fixture = TestBed.createComponent(DrawingColorsComponent); fixture.detectChanges();
        const component = fixture.componentInstance, editor = TestBed.inject(EditorService);
        const button = fixture.nativeElement.querySelector('button');
        component.begin('fill', button); component.setColor(new Color('#123456'));
        editor.selectedSVG = {} as any; fixture.detectChanges(); expect(component.target).toBeUndefined();
        component.begin('fill', button); editor.tools.find(tool => tool.preferenceKey === 'paths')!.restoreSelection();
        fixture.detectChanges(); expect(component.target).toBeUndefined(); expect(component.paint.fill).toBe('#2dd4bf');
    });
});
