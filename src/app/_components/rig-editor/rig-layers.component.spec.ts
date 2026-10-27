import { TestBed } from '@angular/core/testing';
import { DocumentMutationService } from '../../_services/document-mutation.service';
import { RigBindingSessionService } from '../../_services/rig-binding-session.service';
import { RigEditingService } from '../../_services/rig-editing.service';
import { RigLayersComponent } from './rig-layers.component';

describe('bone layer rename interaction', () => {
    async function setup() {
        const root = { id: 'character', name: 'Character', parentId: null, kind: 'point' };
        const bone = { id: 'hair', name: 'Hair', parentId: root.id, kind: 'length' };
        const rig = {
            editor: { selectedSVG: {} }, canEdit: true, activeId: root.id, boneId: bone.id,
            armatures: [{ id: root.id, name: root.name, bones: [root, bone] }],
            selectBone: jasmine.createSpy('selectBone'), rename: jasmine.createSpy('rename'),
            renameBone: jasmine.createSpy('renameBone').and.callFake((name: string) => bone.name = name.trim()),
        };
        const mutations = { revision: 0 };
        await TestBed.configureTestingModule({ imports: [RigLayersComponent], providers: [
            { provide: RigEditingService, useValue: rig },
            { provide: RigBindingSessionService, useValue: { pending: undefined } },
            { provide: DocumentMutationService, useValue: mutations },
        ] }).compileComponents();
        const fixture = TestBed.createComponent(RigLayersComponent);
        fixture.detectChanges();
        const row = fixture.nativeElement.querySelector('[data-bone-row="character:hair"]') as HTMLElement;
        const begin = () => {
            row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); fixture.detectChanges();
            return row.querySelector<HTMLInputElement>('input')!;
        };
        const key = (input: HTMLInputElement, key: string) => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            fixture.detectChanges();
        };
        return { fixture, rig, bone, mutations, row, begin, key };
    }

    it('shares draft-only typing, one completion, cancellation and row focus with artwork layers', async () => {
        const t = await setup();
        let input = t.begin();
        expect(document.activeElement).toBe(input);
        input.value = 'Flowing hair'; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        expect(t.bone.name).toBe('Hair');
        t.key(input, 'Enter'); input.dispatchEvent(new FocusEvent('blur'));
        expect(t.rig.renameBone).toHaveBeenCalledOnceWith('Flowing hair');
        expect(document.activeElement).toBe(t.row);
        input = t.begin(); input.value = 'Discarded'; t.key(input, 'Escape');
        input = t.begin(); input.value = ' Flowing hair '; t.key(input, 'Enter');
        expect(t.rig.renameBone).toHaveBeenCalledTimes(1);
        expect(t.bone.name).toBe('Flowing hair');
    });

    it('discards stale bone drafts when history or the active document changes', async () => {
        const t = await setup();
        let input = t.begin(); input.value = 'Old revision'; t.mutations.revision++;
        t.key(input, 'Enter');
        expect(t.rig.renameBone).not.toHaveBeenCalled();
        input = t.begin(); input.value = 'Old document'; t.rig.editor.selectedSVG = {};
        input.dispatchEvent(new FocusEvent('blur')); t.fixture.detectChanges();
        expect(t.rig.renameBone).not.toHaveBeenCalled();
        expect(t.fixture.nativeElement.querySelector('input')).toBeNull();
    });
});
