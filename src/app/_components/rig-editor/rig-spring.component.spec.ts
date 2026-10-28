import { TestBed } from '@angular/core/testing';
import { DEFAULT_SPRING_SETTINGS } from '../../../../packages/runtime/src/rig/spring-chain';
import { RigSpringService } from '../../_services/rig-spring.service';
import { RigSpringComponent } from './rig-spring.component';

describe('live spring constraint controls', () => {
    function setup(existing=true) {
        const service={settings:{...DEFAULT_SPRING_SETTINGS},problem:'',chainLabel:'Hair → Tip',constraint:existing?{enabled:true}:undefined,
            endOptions:[{id:'hair',name:'Hair'},{id:'tip',name:'Tip'}],chainBones:[{id:'hair',name:'Hair'},{id:'tip',name:'Tip'}],endBoneId:'tip',startName:'Hair',setEnd:jasmine.createSpy(),selectSettingsBone:jasmine.createSpy(),
            busy:false,message:'',rig:{boneId:'hair',canEdit:true,isAnimating:false,workspace:'rest'},checkContext:jasmine.createSpy(),
            add:jasmine.createSpy(),remove:jasmine.createSpy(),reset:jasmine.createSpy(),bake:jasmine.createSpy(),cancel:jasmine.createSpy(),enable:jasmine.createSpy(),setSetting:jasmine.createSpy(),bakeProblem:''};
        TestBed.configureTestingModule({imports:[RigSpringComponent]});
        TestBed.overrideComponent(RigSpringComponent,{set:{providers:[{provide:RigSpringService,useValue:service}]}});
        const fixture=TestBed.createComponent(RigSpringComponent); fixture.detectChanges();
        return {fixture,service,element:fixture.nativeElement as HTMLElement};
    }
    it('offers creation in Edit with no Animate or bake prerequisite',()=>{
        const t=setup(false),button=t.element.querySelector('button')!;
        expect(button.textContent).toContain('Add spring physics');button.click();expect(t.service.add).toHaveBeenCalledTimes(1);
        expect(t.element.textContent).not.toContain('Bake');
    });
    it('presents saved settings in Edit and keeps optional baking behind a disclosure in Animate',()=>{
        const t=setup(); expect(t.element.textContent).toContain('Saved with the rig');
        expect(t.element.querySelector('details')).toBeNull();
        t.service.rig.canEdit=false;t.service.rig.isAnimating=true;t.fixture.detectChanges();
        expect(t.element.querySelector('details')!.open).toBeFalse();
        expect(t.element.querySelector<HTMLInputElement>('[aria-label="Spring Stiffness"]')!.disabled).toBeTrue();
        expect(t.element.textContent).toContain('no keys or baking required');
    });
    it('restores a numeric draft on Escape instead of saving it',()=>{
        const t=setup(),input=t.element.querySelector<HTMLInputElement>('[aria-label="Spring Stiffness"]')!;
        input.value='200';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        expect(input.value).toBe('80');expect(t.service.setSetting).not.toHaveBeenCalled();
    });
    it('offers an explicit end and a per-bone settings selector with accessible labels',()=>{
        const t=setup(), end=t.element.querySelector<HTMLSelectElement>('[aria-label="Physics end bone"]')!;
        end.value='hair';end.dispatchEvent(new Event('change'));expect(t.service.setEnd).toHaveBeenCalledWith('hair');
        const bone=t.element.querySelector<HTMLSelectElement>('[aria-label="Physics settings bone"]')!;
        bone.value='tip';bone.dispatchEvent(new Event('change'));expect(t.service.selectSettingsBone).toHaveBeenCalledWith('tip');
        t.service.rig.canEdit=false;t.fixture.detectChanges();expect(end.disabled).toBeTrue();expect(bone.disabled).toBeFalse();
    });

});
