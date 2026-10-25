import { IKTargetComponent } from './ik-target.component';
import { Armature, TwoBoneIKConstraint } from '../../editor/objects/armature';

describe('persistent IK target gestures', () => {
    function setup() {
        const constraint: TwoBoneIKConstraint = {id:'ik',name:'Left leg',type:'two-bone-ik',enabled:true,upperBoneId:'upper',lowerBoneId:'lower',targetBoneId:'foot',bend:1};
        const active: Armature = {id:'rig',name:'Character',bindings:[],constraints:[constraint],bones:[
            {id:'upper',name:'Thigh',parentId:null,x:0,y:0,angle:0,length:50,pose:0},
            {id:'lower',name:'Shin',parentId:'upper',x:50,y:0,angle:0,length:40,pose:0},
            {id:'foot',name:'Foot L',kind:'point',parentId:null,x:300,y:200,angle:0,length:0,pose:0},
        ]};
        const rig = {editor:{selectedSVG:{id:'document',canvasBounds:{x:10,y:20,width:100,height:100}},activeTool:{}},
            active,displayedRig:active,activeId:'rig',boneId:'lower',bone:active.bones[1],activeIKConstraint:constraint as TwoBoneIKConstraint | undefined,
            ikChain:{upper:active.bones[0],lower:active.bones[1]},ikTargetPosition:{x:300,y:200},ikEndpoint:{x:90,y:0},
            posePreview:undefined as Armature | undefined,clearPosePreview:jasmine.createSpy('clearPosePreview'),visible:true,canEdit:true,workspace:'pose',poseMethod:'fk',problem:undefined,
            previewIK:jasmine.createSpy('previewIK').and.returnValue(active),setIKTarget:jasmine.createSpy('setIKTarget')};
        const mutations={revision:0}, session={pending:undefined as object | undefined};
        const component=new IKTargetComponent(rig as never,mutations as never,session as never);
        component.artwork={getBoundingClientRect:()=>({left:100,top:200,width:200,height:200})} as SVGElement;
        component.workspace={element:{getBoundingClientRect:()=>({left:50,top:100,width:400,height:400})}} as never;
        const capture=document.createElement('button');
        spyOn(capture,'setPointerCapture'); spyOn(capture,'hasPointerCapture').and.returnValue(false);
        const event=(clientX:number,clientY=100,pointerId=1)=>({button:0,pointerId,clientX,clientY,currentTarget:capture,preventDefault:()=>{},stopPropagation:()=>{}} as unknown as PointerEvent);
        return {component,rig,mutations,session,constraint,event};
    }

    it('displays the actual foot control even when the chain cannot reach it', () => {
        const t=setup();
        expect(t.component.enabled).toBeTrue();
        expect(t.component.targetLabel).toBe('Move IK target Foot L');
        expect(t.component.target).toEqual({x:630,y:460,end:{x:210,y:60}});
        t.constraint.enabled=false;
        expect(t.component.target).toBeUndefined();
    });

    it('previews a target-point move in canvas coordinates and commits once on release', () => {
        const t=setup(); t.component.begin(t.event(100)); t.component.move(t.event(120));
        expect(t.rig.previewIK).toHaveBeenCalledWith({x:310,y:200});
        expect(t.rig.ikTargetPosition).toEqual({x:300,y:200});
        expect(t.rig.setIKTarget).not.toHaveBeenCalled();
        t.component.end(t.event(120));
        expect(t.rig.setIKTarget).toHaveBeenCalledOnceWith({x:310,y:200});
        expect(t.rig.clearPosePreview).toHaveBeenCalled();
        t.component.end(t.event(120));
        expect(t.rig.setIKTarget).toHaveBeenCalledTimes(1);
    });

    it('uses the foot position, not the solved endpoint, for keyboard nudges', () => {
        const t=setup();
        t.component.key(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true}));
        expect(t.rig.setIKTarget).toHaveBeenCalledOnceWith({x:290,y:200});
        t.component.key(new KeyboardEvent('keydown',{key:'ArrowDown'}));
        expect(t.rig.setIKTarget).toHaveBeenCalledWith({x:300,y:201});
    });

    it('does not commit clicks, movements back to the origin, or other pointers', () => {
        const t=setup(); t.component.begin(t.event(100)); t.component.move(t.event(120,100,2));
        expect(t.rig.previewIK).not.toHaveBeenCalled();
        t.component.end(t.event(101));
        expect(t.rig.setIKTarget).not.toHaveBeenCalled();
        t.component.begin(t.event(100)); t.component.move(t.event(120)); t.component.end(t.event(100));
        expect(t.rig.setIKTarget).not.toHaveBeenCalled();
        expect(t.rig.clearPosePreview).toHaveBeenCalled();
    });

    it('cancels drafts on history, constraint, selection, mode, binding, focus, and Escape changes', () => {
        for(const reason of ['history','constraint','selection','mode','binding','focus','escape','disabled']) {
            const t=setup(); t.component.begin(t.event(100)); t.component.move(t.event(120));
            if(reason==='history') t.mutations.revision++;
            if(reason==='constraint') t.rig.activeIKConstraint={...t.constraint,id:'another'};
            if(reason==='selection') t.rig.boneId='foot';
            if(reason==='mode') t.rig.workspace='rest';
            if(reason==='binding') t.session.pending={};
            if(reason==='focus') t.component.cancel();
            if(reason==='escape') t.component.key(new KeyboardEvent('keydown',{key:'Escape'}));
            if(reason==='disabled') t.constraint.enabled=false;
            t.component.end(t.event(120));
            expect(t.rig.setIKTarget).withContext(reason).not.toHaveBeenCalled();
            expect(t.rig.clearPosePreview).withContext(reason).toHaveBeenCalled();
        }
    });
});
