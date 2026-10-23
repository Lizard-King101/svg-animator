import { TestBed } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { faRightLeft, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { DrawingColorsComponent } from './drawing-colors.component';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { EditorService } from '../../_services/editor.service';
import { Color } from '../../editor/objects/color.object';

describe('Drawing colors controls', () => {
    const key = 'svg-animator.editor-preferences.v1';
    beforeEach(async () => {
        localStorage.removeItem(key);
        await TestBed.configureTestingModule({ imports: [DrawingColorsComponent], providers: [EditorService] }).compileComponents();
        TestBed.inject(FaIconLibrary).addIcons(faRightLeft, faTriangleExclamation);
    });
    afterEach(() => localStorage.removeItem(key));

    function create() {
        const fixture = TestBed.createComponent(DrawingColorsComponent);
        document.body.appendChild(fixture.nativeElement);
        fixture.detectChanges();
        return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
    }

    it('stages a color in a focused popover, cancels with Escape, then applies once and restores focus', async () => {
        const { fixture, component, root } = create();
        const preferences = TestBed.inject(EditorPreferencesService);
        const original = preferences.drawingPaint;
        const commit = spyOn(preferences, 'setDrawingPaint').and.callThrough();
        const fill = root.querySelector('[aria-label="New artwork fill"]') as HTMLButtonElement;
        const focus = spyOn(fill, 'focus');
        fill.click(); fixture.detectChanges(); await fixture.whenStable();
        const popover = root.querySelector('[role=dialog]') as HTMLElement;
        expect(popover).toBeTruthy(); expect(document.activeElement).toBe(popover);
        expect(fill.getAttribute('aria-expanded')).toBe('true');
        component.setColor(new Color('#ff000080'));
        expect(preferences.drawingPaint).toEqual(original);
        popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges(); expect(component.target).toBeUndefined(); expect(commit).not.toHaveBeenCalled();
        expect(root.querySelector('[role=dialog]')).toBeNull(); expect(focus).toHaveBeenCalled();
        fill.click(); fixture.detectChanges(); component.setColor(new Color('#ff000080')); component.apply(); fixture.detectChanges();
        expect(commit).toHaveBeenCalledTimes(1);
        expect(new EditorPreferencesService().drawingPaint.fill).toBe('#ff000080');
        fixture.nativeElement.remove();
    });

    it('discards the draft on an outside press but keeps it for presses inside the popover', () => {
        const { fixture, component, root } = create();
        (root.querySelector('[aria-label="New artwork stroke"]') as HTMLButtonElement).click(); fixture.detectChanges();
        component.setColor(new Color('#123456'));
        root.querySelector('[role=dialog]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        expect(component.target).toBe('stroke');
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); fixture.detectChanges();
        expect(component.target).toBeUndefined(); expect(component.paint.stroke).toBe('#2dd4bf');
        fixture.nativeElement.remove();
    });

    it('sets the default stroke width from the bar without a draft', () => {
        const { fixture, component, root } = create();
        const input = root.querySelector('[aria-label="New artwork stroke width"]') as HTMLInputElement;
        input.value = '4.5'; input.dispatchEvent(new Event('input')); fixture.detectChanges();
        expect(component.paint.strokeWidth).toBe(4.5);
        expect(new EditorPreferencesService().drawingPaint.strokeWidth).toBe(4.5);
        input.value = ''; input.dispatchEvent(new Event('input'));
        expect(component.paint.strokeWidth).toBe(4.5);
        fixture.nativeElement.remove();
    });

    it('supports no paint, swap, and visible warnings including a zero stroke width', () => {
        const { fixture, component, root } = create();
        const warning = () => root.querySelector('fa-icon.warning')?.getAttribute('aria-label') ?? '';
        (root.querySelector('[aria-label="New artwork stroke"]') as HTMLButtonElement).click(); fixture.detectChanges();
        (root.querySelector('input[type=checkbox]') as HTMLInputElement).click(); component.apply(); fixture.detectChanges();
        expect(component.paint.stroke).toBeNull();
        expect(warning()).toContain('Open paths');
        component.swap(); fixture.detectChanges();
        expect(component.paint.fill).toBeNull(); expect(component.paint.stroke).toBe('#2dd4bf'); expect(warning()).toBe('');
        component.preferences.setDrawingPaint({ strokeWidth: 0 }); fixture.detectChanges();
        expect(warning()).toContain('New artwork will be invisible');
        component.preferences.setDrawingPaint({ fill: '#ffffff00', stroke: '#000000', strokeWidth: 1 }); fixture.detectChanges();
        expect(warning()).toBe('');
        (root.querySelector('[aria-label="New artwork fill"]') as HTMLButtonElement).click();
        component.preferences.setDrawingPaint({ stroke: null }); fixture.detectChanges();
        expect(root.querySelector('[role=dialog] [role=status]')?.textContent).toContain('New artwork will be invisible');
        fixture.nativeElement.remove();
    });

    it('discards an unfinished edit on document or tool changes', () => {
        const { fixture, component } = create();
        const editor = TestBed.inject(EditorService);
        const button = fixture.nativeElement.querySelector('button');
        component.begin('fill', button); component.setColor(new Color('#123456'));
        editor.selectedSVG = {} as any; fixture.detectChanges(); expect(component.target).toBeUndefined();
        component.begin('fill', button); editor.tools.find(tool => tool.preferenceKey === 'paths')!.restoreSelection();
        fixture.detectChanges(); expect(component.target).toBeUndefined(); expect(component.paint.fill).toBe('#2dd4bf');
        fixture.nativeElement.remove();
    });
});
