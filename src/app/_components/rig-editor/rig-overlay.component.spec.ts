import { TestBed } from '@angular/core/testing';
import { RigOverlayComponent } from './rig-overlay.component';
import { RigEditingService } from '../../_services/rig-editing.service';
import { RigBindingSessionService } from '../../_services/rig-binding-session.service';
import { BoneDrawingService } from '../../_services/bone-drawing.service';
import { DocumentMutationService } from '../../_services/document-mutation.service';

describe('rig overlay view projection', () => {
    it('moves bones in the same change-detection pass as pan/zoom without measuring stale artwork layout', async () => {
        const bone = { id: 'a', name: 'Arm', parentId: null, x: 10, y: 20, length: 50, angle: 0, pose: 0 };
        const active = { id: 'rig', name: 'Rig', bones: [bone], bindings: [] };
        const svg = { width: 200, height: 100, zoom: 1, pos: { x: 30, y: 40 }, canvasBounds: { x: 0, y: 0, width: 200, height: 100 } };
        const rig = { visible: true, active, displayedRig: active, workspace: 'rest', boneId: 'a', editor: { selectedSVG: svg } };
        await TestBed.configureTestingModule({ imports: [RigOverlayComponent], providers: [
            { provide: RigEditingService, useValue: rig }, { provide: RigBindingSessionService, useValue: { validate() {} } },
            { provide: BoneDrawingService, useValue: { validate() {} } }, { provide: DocumentMutationService, useValue: {} },
        ] }).compileComponents();
        const fixture = TestBed.createComponent(RigOverlayComponent);
        const layout = jasmine.createSpy('artwork layout').and.throwError('Overlay must not read stale layout');
        fixture.componentRef.setInput('artwork', { getBoundingClientRect: layout });
        fixture.componentRef.setInput('workspace', { element: { getBoundingClientRect: layout } });
        const bones = spyOnProperty(fixture.componentInstance, 'bones').and.callThrough();
        try {
            fixture.detectChanges();
            const tip = fixture.nativeElement.querySelector('.bone-tip') as HTMLElement;
            expect(tip.style.left).toBe('90px'); expect(tip.style.top).toBe('60px');
            svg.pos.x += 55; svg.pos.y -= 15; fixture.detectChanges();
            expect(tip.style.left).toBe('145px'); expect(tip.style.top).toBe('45px');
            svg.zoom = 2; fixture.detectChanges();
            expect(tip.style.left).toBe('105px'); expect(tip.style.top).toBe('15px');
            expect(layout).not.toHaveBeenCalled();
            // One projection per template evaluation, reused by polygons and tip buttons.
            expect(bones.calls.count()).toBeLessThanOrEqual(6);
        } finally { fixture.destroy(); }
    });
});
