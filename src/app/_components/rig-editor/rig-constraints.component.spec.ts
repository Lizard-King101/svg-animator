import { TestBed } from '@angular/core/testing';
import { RigConstraintsComponent } from './rig-constraints.component';
import { RigEditingService } from '../../_services/rig-editing.service';
import { TwoBoneIKConstraint } from '../../editor/objects/armature';

describe('IK constraint inspector', () => {
    function setup(linked = true) {
        const constraint: TwoBoneIKConstraint = {id:'ik',name:'Left leg',type:'two-bone-ik',enabled:true,upperBoneId:'upper',lowerBoneId:'lower',targetBoneId:'foot',bend:1};
        const bones=[{id:'upper',name:'Thigh',kind:'bone',parentId:null,x:0,y:0,angle:0,length:50,pose:0},{id:'lower',name:'Shin',kind:'bone',parentId:'upper',x:50,y:0,angle:0,length:40,pose:0},{id:'foot',name:'Foot L',kind:'point',parentId:null,x:90,y:0,angle:0,length:0,pose:0}];
        const rig={editor:{selectedSVG:{id:'document'}},activeId:'rig',boneId:'foot',bone:bones[2],workspace:'pose',poseMethod:'fk',
            active:{bones,constraints:linked ? [constraint] : []},activeIKConstraint:linked ? constraint : undefined,
            selectedIKConstraints:linked ? [constraint] : [],ikChain:{upper:bones[0],lower:bones[1]},ikTargetCandidates:[bones[2]],
            createIKConstraint:jasmine.createSpy(),selectBone:jasmine.createSpy(),selectIKConstraint:jasmine.createSpy(),
            updateIKConstraint:jasmine.createSpy().and.callFake((_id:string,changes:Partial<TwoBoneIKConstraint>)=>Object.assign(constraint,changes)),
            matchIKTarget:jasmine.createSpy(),removeIKConstraint:jasmine.createSpy(),moveJoint:jasmine.createSpy(),isJointConnected:jasmine.createSpy().and.returnValue(true),
            ikPick:undefined as object | undefined,beginIKTargetPick:jasmine.createSpy(),pickIKTarget:jasmine.createSpy(),cancelIKTargetPick:jasmine.createSpy()};
        TestBed.configureTestingModule({imports:[RigConstraintsComponent],providers:[{provide:RigEditingService,useValue:rig}]});
        const fixture=TestBed.createComponent(RigConstraintsComponent); fixture.detectChanges();
        const host=fixture.nativeElement as HTMLElement;
        const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(item=>item.textContent?.trim()===text)!;
        return {fixture,host,rig,constraint,button};
    }

    it('shows the named chain and target relationship when the foot control is selected', () => {
        const t=setup();
        expect((t.host.querySelector('[aria-label="IK constraint name"]') as HTMLInputElement).value).toBe('Left leg');
        expect(t.host.textContent).toContain('Thigh → Shin');
        expect((t.host.querySelector('[aria-label="IK target point"]') as HTMLSelectElement).value).toBe('foot');
        t.button('Thigh → Shin').click();
        expect(t.rig.selectBone).toHaveBeenCalledOnceWith('rig','lower');
        t.button('Select target').click();
        expect(t.rig.selectBone).toHaveBeenCalledWith('rig','foot');
    });

    it('adds IK by picking a target bone, creating one at the tip, or cancelling', () => {
        const t=setup(false);
        t.button('Add IK…').click(); expect(t.rig.beginIKTargetPick).toHaveBeenCalledTimes(1);
        t.rig.ikPick={lowerBoneId:'lower'}; t.fixture.detectChanges();
        expect(t.host.textContent).toContain('Pick the target for Thigh → Shin');
        t.button('New target at Shin’s tip').click(); expect(t.rig.pickIKTarget).toHaveBeenCalledOnceWith();
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); expect(t.rig.cancelIKTargetPick).toHaveBeenCalledTimes(1);
        t.button('Cancel').click(); expect(t.rig.cancelIKTargetPick).toHaveBeenCalledTimes(2);
        t.fixture.destroy(); expect(t.rig.cancelIKTargetPick).toHaveBeenCalledTimes(3);
    });

    it('commits renamed constraints on blur and cancels Escape without an extra mutation', () => {
        const t=setup(), input=t.host.querySelector('[aria-label="IK constraint name"]') as HTMLInputElement;
        input.value='  Planted foot  '; input.dispatchEvent(new Event('blur'));
        expect(t.rig.updateIKConstraint).toHaveBeenCalledOnceWith('ik',{name:'Planted foot'});
        t.fixture.detectChanges();
        input.value='Discard me'; input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); input.dispatchEvent(new Event('blur'));
        expect(input.value).toBe('Planted foot');
        expect(t.rig.updateIKConstraint).toHaveBeenCalledTimes(1);
    });

    it('explains a drifted joint, repairs it in one click and lists every constraint', () => {
        const t=setup(); t.rig.active.bones[1].x=47; t.fixture.detectChanges();
        expect(t.host.textContent).toContain('Shin must start at Thigh');
        t.button('Reconnect joint').click(); expect(t.rig.moveJoint).toHaveBeenCalledOnceWith('lower');
        const row=t.host.querySelector('[aria-label="Select Left leg, Needs fix"]') as HTMLButtonElement;
        expect(row.textContent).toContain('Thigh → Shin → Foot L');
        row.click(); expect(t.rig.selectBone).toHaveBeenCalledWith('rig','lower'); expect(t.rig.selectIKConstraint).toHaveBeenCalledWith('ik');
    });

    it('offers to snap a bone onto its parent tip when that is all IK needs', () => {
        const t=setup(false); Object.assign(t.rig,{ikChain:undefined,bone:t.rig.active.bones[1],boneId:'lower'}); t.rig.active.bones[1].x=53;
        t.rig.isJointConnected.and.returnValue(false); t.fixture.detectChanges();
        expect(t.host.textContent).toContain('Shin starts 3.0 units from Thigh’s tip');
        t.button('Snap to Thigh’s tip').click(); expect(t.rig.moveJoint).toHaveBeenCalledOnceWith('lower');
    });

    it('routes enable, bend, match, and removal through the constraint commands', () => {
        const t=setup(), checkbox=t.host.querySelector('[aria-label="Enable IK constraint"]') as HTMLInputElement;
        checkbox.checked=false; checkbox.dispatchEvent(new Event('change')); t.fixture.detectChanges();
        expect(t.rig.updateIKConstraint).toHaveBeenCalledWith('ik',{enabled:false});
        t.button('Flip bend').click();
        expect(t.rig.updateIKConstraint).toHaveBeenCalledWith('ik',{bend:-1});
        t.button('Match target to tip').click();
        expect(t.rig.matchIKTarget).toHaveBeenCalledOnceWith('ik');
        t.button('Remove constraint').click();
        expect(t.rig.removeIKConstraint).toHaveBeenCalledOnceWith('ik');
    });
});
