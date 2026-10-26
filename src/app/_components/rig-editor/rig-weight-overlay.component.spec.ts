import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RigWeightOverlayComponent, clusterWeightPoints } from './rig-weight-overlay.component';
import { RigEditingService } from '../../_services/rig-editing.service';
import { RigBindingSessionService } from '../../_services/rig-binding-session.service';
import { DocumentMutationService } from '../../_services/document-mutation.service';
import { WeightPointRef } from '../../editor/objects/armature';
import { WeightUpdate } from '../../editor/rig-weight-commands';

describe('weight overlay gestures', () => {
    const created: RigWeightOverlayComponent[] = [];
    afterEach(() => created.splice(0).forEach(component => component.ngOnDestroy()));
    function setup() {
        const host = document.createElement('div');
        const source = {id:'rig',bones:[],bindings:[]};
        const rig = { visible:true,canEdit:true,workspace:'weights',activeId:'rig',boneId:'a',bone:{name:'Thigh'},problem:undefined,
            editor:{selectedSVG:{id:'document',width:100,height:100,zoom:2,pos:{x:50,y:50},canvasBounds:{x:0,y:0,width:100,height:100}},activeTool:{}},
            applyWeightUpdates:jasmine.createSpy('applyWeightUpdates').and.returnValue(true), setPointWeight:jasmine.createSpy('setPointWeight').and.returnValue(true) };
        const session = { weightRig:source,pending:undefined as object|undefined,scopeKey:'document:rig:scope:a',paintMode:'add',weightDisplay:'mix' as 'mix'|'heat',color:(_id:string)=>'hsl(0 0% 50%)',setPaintMode:jasmine.createSpy('setPaintMode'),stepBrushSize:jasmine.createSpy('stepBrushSize'),stepBrushStrength:jasmine.createSpy('stepBrushStrength'),brushRadius:20,brushStrength:.25,brushValue:1,pointRef:undefined,
            selectedRefs:[] as WeightPointRef[], selectionKey:'', previewUpdates:[] as readonly WeightUpdate[], previewKind:undefined as string|undefined,
            selectPoint:jasmine.createSpy('selectPoint'),selectPoints:jasmine.createSpy('selectPoints'),clearSelection:jasmine.createSpy('clearSelection'),selectAll:jasmine.createSpy('selectAll'),
            isSelected:(ref:WeightPointRef)=>session.selectedRefs.some(item=>item.pathId===ref.pathId&&item.pointId===ref.pointId),
            setBrushPreview:(updates:readonly WeightUpdate[])=>{session.previewUpdates=updates;session.previewKind='brush';},
            cancelPreview:(_kind?:string)=>{session.previewUpdates=[];session.previewKind=undefined;} };
        const mutations = {revision:0};
        const component = new RigWeightOverlayComponent(rig as never,session as never,mutations as never,new ElementRef(host)); created.push(component);
        let width=200;
        component.artwork={getBoundingClientRect:()=>({left:50,top:100,width,height:200})} as SVGElement;
        component.workspace={element:{getBoundingClientRect:()=>({left:50,top:100,width:400,height:400})}} as never;
        const projected = { id:'path:p',pathId:'path',pointId:'p',ownerKey:'path:p',ownerPathId:'path',ownerPointId:'p',x:100,y:100,handle:false,inherited:false,anchor:{x:100,y:100},label:'Point 1',pathName:'Leg',weights:[{boneId:'a',weight:.5},{boneId:'b',weight:.5}],boneIds:['a','b'],lockedBoneIds:[] as string[],editable:true,color:'red',percent:50 };
        const pointGetter = spyOnProperty(component,'points').and.returnValue([projected]);
        const capture=document.createElement('button'); host.append(capture);
        spyOn(capture,'setPointerCapture'); spyOn(capture,'hasPointerCapture').and.returnValue(false);
        const event=(x=150,y=200,pointerId=1)=>({button:0,pointerId,clientX:x,clientY:y,currentTarget:capture,preventDefault:()=>{},stopPropagation:()=>{}} as unknown as PointerEvent);
        return {component,rig,session,mutations,event,projected,pointGetter,capture,host,zoom:()=>{width=300;rig.editor.selectedSVG.zoom=3;}};
    }
    it('routes 1–5 and bracket shortcuts to the brush before artwork shortcuts, outside text fields', () => {
        const t=setup(), later=jasmine.createSpy('later'), input=document.createElement('input'); document.addEventListener('keydown',later); document.body.append(input, t.host);
        const press=(key:string,init:KeyboardEventInit={},target:EventTarget=document.body)=>{ const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...init}); target.dispatchEvent(event); return event; };
        expect(press('3').defaultPrevented).toBeTrue(); expect(t.session.setPaintMode).toHaveBeenCalledOnceWith('subtract');
        press(']',{code:'BracketRight'}); expect(t.session.stepBrushSize).toHaveBeenCalledOnceWith(1);
        press('{',{code:'BracketLeft',shiftKey:true}); expect(t.session.stepBrushStrength).toHaveBeenCalledOnceWith(-1);
        expect(later).not.toHaveBeenCalled();
        press('2',{},input); press('1',{ctrlKey:true}); expect(t.session.setPaintMode).toHaveBeenCalledTimes(1);
        t.component.ngOnDestroy(); press('4'); expect(t.session.setPaintMode).toHaveBeenCalledTimes(1);
        document.removeEventListener('keydown',later); input.remove(); t.host.remove();
    });
    it('keeps drafts local and commits one normalized update on release', () => {
        const t=setup(); t.component.begin(t.event()); t.component.move(t.event(155));
        expect(t.rig.applyWeightUpdates).not.toHaveBeenCalled();
        expect(t.projected.weights[0].weight).toBe(.5);
        t.component.end(t.event(155));
        expect(t.session.previewUpdates.length).toBe(0);
        expect(t.rig.applyWeightUpdates).toHaveBeenCalledOnceWith([{pathId:'path',pointId:'p',weights:[{boneId:'a',weight:.75},{boneId:'b',weight:.25}]}]);
        t.component.end(t.event()); expect(t.rig.applyWeightUpdates).toHaveBeenCalledTimes(1);
    });
    it('routes inherited-handle brush contact through its anchor owner', () => {
        const t=setup(); t.pointGetter.and.returnValue([{...t.projected,handle:true,inherited:true}]);
        t.component.begin(t.event()); t.component.end(t.event());
        expect(t.rig.applyWeightUpdates.calls.mostRecent().args[0][0]).toEqual(jasmine.objectContaining({pathId:'path',pointId:'p'}));
    });
    it('paints independent handles and passes shared owner references', () => {
        const t=setup(); t.pointGetter.and.returnValue([{...t.projected,handle:true,ownerPathId:'other',ownerPointId:'owner',ownerKey:'other:owner'}]);
        t.component.begin(t.event()); t.component.end(t.event());
        expect(t.rig.applyWeightUpdates.calls.mostRecent().args[0][0]).toEqual(jasmine.objectContaining({pathId:'other',pointId:'owner'}));
    });
    it('cancels without writes on Escape, blur, history, scope, mode, tool, zoom, or bone picking', () => {
        for(const reason of ['escape','blur','history','scope','selection','mode','tool','zoom','picking','rig']) {
            const t=setup(); t.component.begin(t.event());
            if(reason==='escape') t.component.key(new KeyboardEvent('keydown',{key:'Escape'}));
            if(reason==='blur') t.component.blur();
            if(reason==='history') t.mutations.revision++;
            if(reason==='scope') t.session.scopeKey+='new';
            if(reason==='selection') t.session.selectionKey='changed';
            if(reason==='mode') t.rig.workspace='pose';
            if(reason==='tool') t.rig.editor.activeTool={};
            if(reason==='zoom') t.zoom();
            if(reason==='picking') t.session.pending={};
            if(reason==='rig') t.rig.activeId='other';
            t.component.end(t.event());
            expect(t.rig.applyWeightUpdates).withContext(reason).not.toHaveBeenCalled();
        }
    });
    it('ignores other pointers and no-op strokes', () => {
        const t=setup(); t.component.begin(t.event(300,300)); t.component.move(t.event(150,200,2)); t.component.end(t.event(300,300));
        expect(t.rig.applyWeightUpdates).not.toHaveBeenCalled();
    });
    it('groups coincident points by weight owner without merging independent owners', () => {
        const t=setup(); const clusters=clusterWeightPoints([t.projected,{...t.projected,id:'path:handle',pointId:'handle',inherited:true,handle:true}, {...t.projected,id:'other:q',pathId:'other',pointId:'q',ownerKey:'other:q',ownerPathId:'other',ownerPointId:'q'}]);
        expect(clusters.length).toBe(1); expect(clusters[0].groups.map(group=>group.length)).toEqual([2,1]);
        t.session.paintMode='select'; t.component.choose({stopPropagation:()=>{},currentTarget:t.capture} as never,clusters[0]);
        expect(t.component.popover?.groups.length).toBe(2);
        t.component.selectMember(clusters[0].groups[1][0]);
        expect(t.session.selectPoint).toHaveBeenCalledWith({pathId:'other',pointId:'q'},false);
        t.component.closePopover(); expect(t.component.popover).toBeUndefined();
    });
    it('provides keyboard painting and separate numeric editing for an overlapping owner', () => {
        const t=setup(), cluster=clusterWeightPoints([t.projected])[0];
        t.component.pointKey(new KeyboardEvent('keydown',{key:' '}),cluster);
        expect(t.rig.applyWeightUpdates).toHaveBeenCalledTimes(1);
        const input=document.createElement('input'); input.type='number'; input.value='25';
        t.component.groupWeight(t.projected,{target:input} as unknown as Event);
        expect(t.rig.setPointWeight).toHaveBeenCalledOnceWith({pathId:'path',pointId:'p'},'a',.25);
    });
    it('suppresses a cancelled stroke click but allows the next independent click and keyboard selection', () => {
        const t=setup(), cluster=clusterWeightPoints([t.projected])[0], click={stopPropagation:()=>{},currentTarget:t.capture} as never;
        t.component.begin(t.event()); t.component.key(new KeyboardEvent('keydown',{key:'Escape'}));
        t.component.choose(click,cluster); expect(t.session.selectPoint).not.toHaveBeenCalled();
        t.session.paintMode='select'; t.component.pointDown(t.event(),cluster); t.component.choose(click,cluster);
        expect(t.session.selectPoint).toHaveBeenCalledTimes(1);
        t.session.paintMode='add'; t.component.begin(t.event()); t.component.cancel(); t.session.paintMode='select';
        t.component.pointKey(new KeyboardEvent('keydown',{key:'Enter'}),cluster); t.component.choose(click,cluster);
        expect(t.session.selectPoint).toHaveBeenCalledTimes(2);
    });
    it('focuses the overlap dialog only after its controls render, once per opening', () => {
        const t=setup(), cluster=clusterWeightPoints([t.projected,{...t.projected,id:'other:q',ownerKey:'other:q'}])[0];
        t.session.paintMode='select'; t.component.choose({stopPropagation:()=>{},currentTarget:t.capture} as never,cluster);
        t.component.ngAfterViewChecked();
        const panel=document.createElement('section'); panel.className='overlap-popover';
        const close=document.createElement('button'); panel.append(close); t.host.append(panel);
        const focus=spyOn(close,'focus');
        t.component.ngAfterViewChecked(); expect(focus).toHaveBeenCalledTimes(1);
        t.component.ngAfterViewChecked(); expect(focus).toHaveBeenCalledTimes(1);
        t.component.closePopover(); t.component.ngAfterViewChecked(); expect(focus).toHaveBeenCalledTimes(1);
    });
    it('dismisses an overlap dialog when another point is chosen without restoring focus to the old trigger', () => {
        const t=setup(), cluster=clusterWeightPoints([t.projected,{...t.projected,id:'other:q',ownerKey:'other:q'}])[0];
        t.session.paintMode='select'; t.component.choose({stopPropagation:()=>{},currentTarget:t.capture} as never,cluster);
        const focus=spyOn(t.capture,'focus');
        t.component.choose({stopPropagation:()=>{},currentTarget:document.createElement('button')} as never,clusterWeightPoints([{...t.projected,pointId:'next'}])[0]);
        expect(t.component.popover).toBeUndefined(); expect(focus).not.toHaveBeenCalled();
        expect(t.session.selectPoint).toHaveBeenCalledWith({pathId:'path',pointId:'next'},false);
    });
    it('dismisses popovers when tools or canvas projection change', () => {
        for(const reason of ['tool','zoom']) {
            const t=setup(), cluster=clusterWeightPoints([t.projected,{...t.projected,id:'other:q',ownerKey:'other:q'}])[0];
            t.session.paintMode='select'; t.component.choose({stopPropagation:()=>{},currentTarget:t.capture} as never,cluster);
            if(reason==='tool') t.rig.editor.activeTool={}; else t.zoom();
            t.component.ngDoCheck(); expect(t.component.popover).withContext(reason).toBeUndefined();
        }
    });
    it('paints rendered pointer drags and clicks when focus moves between markers and the painting surface', () => {
        const t=setup();
        TestBed.configureTestingModule({imports:[RigWeightOverlayComponent],providers:[
            {provide:RigEditingService,useValue:t.rig},{provide:RigBindingSessionService,useValue:t.session},{provide:DocumentMutationService,useValue:t.mutations},
        ]});
        const fixture=TestBed.createComponent(RigWeightOverlayComponent), component=fixture.componentInstance;
        component.artwork=t.component.artwork; component.workspace=t.component.workspace;
        spyOnProperty(component,'points').and.returnValue([t.projected]);
        fixture.detectChanges();
        const surface=fixture.nativeElement.querySelector('.paint-surface') as HTMLElement, marker=fixture.nativeElement.querySelector('.weight-point') as HTMLElement;
        for(const control of [surface,marker]) { spyOn(control,'setPointerCapture'); spyOn(control,'hasPointerCapture').and.returnValue(false); }
        const dispatch=(target:HTMLElement,type:string,x:number)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:200}));
        marker.focus(); expect(document.activeElement).toBe(marker);
        dispatch(surface,'pointerdown',120); fixture.detectChanges();
        expect(document.activeElement).toBe(surface);
        dispatch(surface,'pointermove',180); fixture.detectChanges();
        dispatch(surface,'pointerup',180); fixture.detectChanges();
        expect(t.rig.applyWeightUpdates).toHaveBeenCalledOnceWith([{pathId:'path',pointId:'p',weights:[{boneId:'a',weight:.75},{boneId:'b',weight:.25}]}]);
        dispatch(marker,'pointerdown',150); fixture.detectChanges();
        expect(document.activeElement).toBe(marker);
        dispatch(marker,'pointerup',150); fixture.detectChanges();
        expect(t.rig.applyWeightUpdates).toHaveBeenCalledTimes(2);
        fixture.destroy(); TestBed.resetTestingModule();
    });
    it('limits painting to selected owners while leaving rigid owners untouched', () => {
        const t=setup();
        t.session.selectedRefs=[{pathId:'path',pointId:'p'}];
        t.pointGetter.and.returnValue([t.projected,{...t.projected,id:'q',pointId:'q',ownerPointId:'q',ownerKey:'q'},{...t.projected,id:'rigid',pointId:'rigid',ownerPointId:'rigid',ownerKey:'rigid',editable:false}]);
        t.component.begin(t.event()); t.component.end(t.event());
        expect(t.rig.applyWeightUpdates.calls.mostRecent().args[0].map((entry:WeightUpdate)=>entry.pointId)).toEqual(['p']);
        t.rig.applyWeightUpdates.calls.reset(); t.session.selectedRefs=[];
        t.component.begin(t.event()); t.component.end(t.event());
        expect(t.rig.applyWeightUpdates.calls.mostRecent().args[0].map((entry:WeightUpdate)=>entry.pointId)).toEqual(['p','q']);
    });
    it('selects marquee points only on completion, unions with Shift, and cancels without changing selection', () => {
        const t=setup(); t.session.paintMode='select';
        t.pointGetter.and.returnValue([t.projected,{...t.projected,id:'other',pointId:'other',ownerPointId:'other',ownerKey:'other',x:300}]);
        t.component.begin(t.event(100,150)); t.component.move(t.event(200,250));
        expect(t.component.marquee).toEqual({x:50,y:50,width:100,height:100});
        expect(t.session.selectPoints).not.toHaveBeenCalled();
        t.component.end(t.event(200,250));
        expect(t.session.selectPoints).toHaveBeenCalledOnceWith([{pathId:'path',pointId:'p'}],false);
        const shift={...t.event(100,150),shiftKey:true} as PointerEvent;
        t.component.begin(shift); t.component.end(t.event(200,250));
        expect(t.session.selectPoints).toHaveBeenCalledWith([{pathId:'path',pointId:'p'}],true);
        t.component.begin(t.event(100,150)); t.component.move(t.event(200,250)); t.component.blur(); t.component.end(t.event(200,250));
        expect(t.session.selectPoints).toHaveBeenCalledTimes(2);
        expect(t.rig.applyWeightUpdates).not.toHaveBeenCalled();
    });
    it('shows canonical shared-owner selection on every marker, including inherited handles', () => {
        const t=setup(), shared={...t.projected,id:'handle',pointId:'handle',handle:true,inherited:true,x:120};
        t.session.isSelected=ref=>ref.pointId==='p'||ref.pointId==='handle';
        const clusters=clusterWeightPoints([t.projected,shared]);
        expect(clusters.map(cluster=>t.component.selected(cluster))).toEqual([true,true]);
        t.component.choose({stopPropagation:()=>{},currentTarget:t.capture,shiftKey:true} as never,clusters[1]);
        expect(t.session.selectPoint).toHaveBeenCalledWith({pathId:'path',pointId:'handle'},true);
    });
    it('renders Shift selection, scoped keyboard selection, and multi-group popover controls', () => {
        const t=setup(); t.session.paintMode='select';
        const other={...t.projected,id:'other:q',pathId:'other',pointId:'q',ownerKey:'other:q',ownerPathId:'other',ownerPointId:'q'};
        TestBed.configureTestingModule({imports:[RigWeightOverlayComponent],providers:[
            {provide:RigEditingService,useValue:t.rig},{provide:RigBindingSessionService,useValue:t.session},{provide:DocumentMutationService,useValue:t.mutations},
        ]});
        const fixture=TestBed.createComponent(RigWeightOverlayComponent), component=fixture.componentInstance;
        component.artwork=t.component.artwork; component.workspace=t.component.workspace;
        spyOnProperty(component,'points').and.returnValue([t.projected,other]); fixture.detectChanges();
        const marker=fixture.nativeElement.querySelector('.weight-point') as HTMLElement;
        marker.click(); fixture.detectChanges();
        const groupButtons=fixture.nativeElement.querySelectorAll('.group-selection') as NodeListOf<HTMLButtonElement>;
        expect(groupButtons.length).toBe(2);
        groupButtons[1].click(); fixture.detectChanges();
        expect(t.session.selectPoint).toHaveBeenCalledWith({pathId:'other',pointId:'q'},true);
        expect(fixture.nativeElement.querySelector('.overlap-popover')).not.toBeNull();
        groupButtons[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); fixture.detectChanges();
        expect(document.activeElement).toBe(marker);
        marker.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true,cancelable:true}));
        expect(t.session.selectAll).toHaveBeenCalledTimes(1);
        const input=document.createElement('input'); fixture.nativeElement.append(input);
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true}));
        expect(t.session.selectAll).toHaveBeenCalledTimes(1);
        fixture.destroy(); TestBed.resetTestingModule();
    });
    it('keeps rendered overlap dialogs within a narrow workspace and rejects locked numeric changes', () => {
        const t=setup(); t.session.paintMode='select';
        const cluster=clusterWeightPoints([t.projected,{...t.projected,id:'other:q',ownerKey:'other:q'}])[0];
        t.component.choose({stopPropagation:()=>{},currentTarget:t.capture} as never,cluster);
        const panel=document.createElement('section'); panel.className='overlap-popover'; t.host.append(panel);
        spyOn(panel,'getBoundingClientRect').and.returnValue({width:180,height:200} as DOMRect);
        t.component.workspace={element:{getBoundingClientRect:()=>({left:0,top:0,width:200,height:240})}} as never;
        t.component.ngAfterViewChecked();
        expect(parseFloat(panel.style.left)).toBeLessThanOrEqual(12);
        expect(parseFloat(panel.style.top)).toBeLessThanOrEqual(32);
        const input=document.createElement('input'); input.type='number'; input.value='25';
        t.component.groupWeight({...t.projected,lockedBoneIds:['a']},{target:input} as unknown as Event);
        expect(t.rig.setPointWeight).not.toHaveBeenCalled(); expect(input.value).toBe('50');
    });
});
