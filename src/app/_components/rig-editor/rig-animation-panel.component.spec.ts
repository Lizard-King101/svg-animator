import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RigPanelComponent } from './rig-panel.component';
import { RigEditingService } from '../../_services/rig-editing.service';
import { RigBindingSessionService } from '../../_services/rig-binding-session.service';
import { EditorService } from '../../_services/editor.service';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { AnimationPlaybackService } from '../../_services/animation-playback.service';
import { DocumentMutationService } from '../../_services/document-mutation.service';
import { HistoryService } from '../../_services/history.service';
import { SVG } from '../../editor/objects/svg.object';
import { Point } from '../../editor/objects/point.object';

describe('animated pose inspector', () => {
    async function setup() {
        const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
        const svg = new SVG(editor,{width:200,height:200,pos:new Point(0,0)});
        svg.rigs.armatures = [{ id:'rig', name:'Character', bindings:[], bones:[
            { id:'target', name:'Hand target', kind:'point', parentId:null, x:20,y:30,angle:0,length:0,pose:0 },
        ] }]; editor.selectedSVG=svg; svg.snapshot();
        const playback = new AnimationPlaybackService(editor,new NgZone({enableLongStackTrace:false}),preferences);
        const projects={upsert:jasmine.createSpy('upsert')}, mutations=new DocumentMutationService(editor,playback,new HistoryService(),projects as never);
        const rig=new RigEditingService(editor,playback,mutations); rig.selectBone('rig','target'); playback.setMode('animate'); mutations.resetBaseline();
        const session={cancel:jasmine.createSpy('cancel'),showsBindingControls:false};
        await TestBed.configureTestingModule({imports:[RigPanelComponent],providers:[{provide:RigEditingService,useValue:rig},{provide:RigBindingSessionService,useValue:session}]}).compileComponents();
        const fixture=TestBed.createComponent(RigPanelComponent); fixture.detectChanges();
        const destroy=()=>{fixture.destroy();playback.ngOnDestroy();mutations.ngOnDestroy();};
        return {fixture,rig,svg,playback,mutations,projects,destroy};
    }
    it('switches to Pose, disables setup and weights, and keys a numeric target move once on blur', async () => {
        const t=await setup(); expect(t.rig.workspace).toBe('pose');
        const modeButtons: HTMLButtonElement[]=[...t.fixture.nativeElement.querySelectorAll('[aria-label="Rig workspace"] button')];
        expect(modeButtons.map(button=>button.disabled)).toEqual([true,false,true]);
        expect(t.fixture.nativeElement.querySelector('app-rig-binding-controls')).toBeNull();
        t.playback.seek(1); t.fixture.detectChanges(); const count=t.projects.upsert.calls.count();
        const input:HTMLInputElement=t.fixture.nativeElement.querySelector('[aria-label="Pose offset X"]');
        input.value='12'; input.dispatchEvent(new Event('blur')); t.fixture.detectChanges();
        expect(t.projects.upsert.calls.count()).toBe(count+1);
        expect(t.svg.animation.tracks.map(track=>track.property)).toEqual(['bones.target.poseX']);
        expect(t.rig.bone!.poseX).toBe(12);
        input.dispatchEvent(new Event('blur')); expect(t.projects.upsert.calls.count()).toBe(count+1);
        t.mutations.undo(); expect(t.svg.animation.tracks).toHaveSize(0);
        t.destroy();
    });
    it('cancels a typed offset with Escape and keys the full selected pose explicitly', async () => {
        const t=await setup(), input:HTMLInputElement=t.fixture.nativeElement.querySelector('[aria-label="Pose offset X"]');
        const count=t.projects.upsert.calls.count(); input.focus(); input.value='99';
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); t.fixture.detectChanges();
        expect(t.svg.animation.tracks).toHaveSize(0); expect(input.value).toBe('0');
        const keyButton=[...t.fixture.nativeElement.querySelectorAll('button')].find((button:any)=>button.textContent.trim()==='Key selected control') as HTMLButtonElement;
        keyButton.click(); t.fixture.detectChanges();
        expect(t.svg.animation.tracks.map(track=>track.property).sort()).toEqual(['bones.target.pose','bones.target.poseX','bones.target.poseY']);
        expect(t.projects.upsert.calls.count()).toBe(count+1);
        t.destroy();
    });
    it('exposes whole-pose commands with context and preserves one undo step on paste', async () => {
        const t = await setup();
        const button = (text: string) => [...t.fixture.nativeElement.querySelectorAll('button')].find((item:any) => item.textContent.trim() === text) as HTMLButtonElement;
        expect(button('Paste armature pose').disabled).toBeTrue();
        t.rig.setPosePosition(8,12); button('Copy armature pose').click(); t.fixture.detectChanges();
        expect(button('Paste armature pose').disabled).toBeFalse();
        t.playback.seek(1); const count = t.projects.upsert.calls.count();
        button('Paste armature pose').click(); t.fixture.detectChanges();
        expect(t.fixture.nativeElement.querySelector('[aria-label="Pose keying context"]').textContent).toContain('Scene · 1s');
        expect(t.projects.upsert.calls.count()).toBe(count + 1);
        expect(t.svg.animation.tracks.every(track => track.keyframes.some(key => key.time === 1))).toBeTrue();
        t.playback.playing = true; t.fixture.detectChanges();
        expect(button('Key armature pose').disabled).toBeTrue();
        expect(button('Copy armature pose').disabled).toBeTrue();
        expect(button('Paste armature pose').disabled).toBeTrue();
        t.playback.playing = false; t.destroy();
    });
});
