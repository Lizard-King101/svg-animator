import { TestBed } from '@angular/core/testing';
import { RigEditingService } from '../../_services/rig-editing.service';
import { RigWindComponent } from './rig-wind.component';

describe('armature wind controls',()=>{
    function setup() {
        const rig={active:{name:'Character',windX:3,windY:0},canEditWind:true,isAnimating:true,windKeyed:()=>false,setWind:jasmine.createSpy()};
        TestBed.configureTestingModule({imports:[RigWindComponent],providers:[{provide:RigEditingService,useValue:rig}]});
        const fixture=TestBed.createComponent(RigWindComponent);fixture.detectChanges();
        document.body.appendChild(fixture.nativeElement);
        return {rig,fixture,element:fixture.nativeElement as HTMLElement};
    }
    it('keys the existing force independently of field edits and disables controls during playback',()=>{
        const t=setup();t.element.querySelector<HTMLButtonElement>('[aria-label="Key Wind X"]')!.click();
        expect(t.rig.setWind).toHaveBeenCalledWith('windX',3,true);
        t.rig.canEditWind=false;t.fixture.detectChanges();
        expect(t.element.querySelector<HTMLInputElement>('[aria-label="Wind X"]')!.disabled).toBeTrue();
        expect(t.element.querySelector<HTMLButtonElement>('[aria-label="Key Wind X"]')!.disabled).toBeTrue();
    });
    it('cancels numeric drafts with Escape and commits with Enter',()=>{
        const t=setup(),input=t.element.querySelector<HTMLInputElement>('[aria-label="Wind X"]')!;
        spyOn(input,'blur').and.callFake(()=>input.dispatchEvent(new Event('blur')));
        input.value='9';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        expect(input.value).toBe('3');expect(t.rig.setWind).not.toHaveBeenCalledWith('windX',9);
        input.value='7';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
        expect(t.rig.setWind).toHaveBeenCalledWith('windX',7);
    });
});
