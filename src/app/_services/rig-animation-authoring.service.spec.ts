import { linkLoopSeam, loopEndpoints } from '../editor/animation/loop-seam';
import { NgZone } from '@angular/core';
import { AnimationPlaybackService } from './animation-playback.service';
import { ActionCompositionService } from './action-composition.service';
import { DocumentMutationService } from './document-mutation.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { EditorService } from './editor.service';
import { HistoryService } from './history.service';
import { RigEditingService } from './rig-editing.service';
import { SVG } from '../editor/objects/svg.object';
import { Path } from '../editor/objects/elements/path.object';
import { Line } from '../editor/objects/line.object';
import { Point } from '../editor/objects/point.object';
import { createPathBinding } from '../editor/rig-binding';
import { createDocumentEnvelope, migrateDocument } from '../editor/migrations/document-migrations';
import { AnimationInspectionSnapshot } from '../editor/animation/animation-inspection';
import { AnimationGestureService } from './animation-gesture.service';

describe('rig timeline authoring and reversible playback', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
    function setup(ik = false) {
        const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
        const svg = new SVG(editor, {width:200,height:200,pos:new Point(0,0)});
        const path = new Path(editor);
        path.lines = [new Line(editor,{type:'bezier',points:[new Point(40,0,'joint'),new Point(80,0,'tip')],controlStart:new Point(50,5),controlEnd:new Point(70,5)})];
        svg.elements = [path]; editor.selectedSVG = svg; editor.selectedElement = path;
        svg.rigs.armatures = [{id:'rig',name:'Leg',bones:[
            {id:'root',name:'Root',kind:'point',parentId:null,x:0,y:0,angle:0,length:0,pose:0},
            {id:'upper',name:'Upper',parentId:'root',x:0,y:0,angle:0,length:40,pose:0},
            {id:'lower',name:'Lower',parentId:'upper',x:40,y:0,angle:0,length:40,pose:0},
            {id:'foot',name:'Foot',kind:'point',parentId:'root',x:80,y:0,angle:0,length:0,pose:0},
        ],bindings:[createPathBinding(svg,path,'lower')],...(ik ? {constraintsActive:false,constraints:[{id:'ik',name:'Leg IK',type:'two-bone-ik',upperBoneId:'upper',lowerBoneId:'lower',targetBoneId:'foot',enabled:true,bend:1}]} : {})}];
        svg.animation.duration = 4; svg.snapshot();
        const playback = new AnimationPlaybackService(editor,new NgZone({enableLongStackTrace:false}),preferences); playback.mode = 'edit';
        const projects = {upsert:jasmine.createSpy('upsert')};
        const mutations = new DocumentMutationService(editor,playback,new HistoryService(),projects as never); mutations.resetBaseline();
        const rigs = new RigEditingService(editor,playback,mutations); rigs.selectBone('rig','upper');
        playback.setMode('animate'); rigs.workspace = 'pose';
        const actions = new ActionCompositionService(editor,playback,mutations,rigs);
        cleanups.push(() => { playback.ngOnDestroy(); mutations.ngOnDestroy(); });
        return {editor,svg,path,playback,projects,mutations,rigs,actions};
    }
    it('updates both linked rig poses in one mutation while leaving the rest setup unchanged', () => {
        const t=setup(); t.playback.seek(1); t.rigs.setPose(40);
        const channel=t.svg.animation.tracks[0];
        t.mutations.mutate(()=>linkLoopSeam(channel,0,1,'start',false),'animation');
        const saves=t.projects.upsert.calls.count(); t.rigs.setPose(25);
        expect(loopEndpoints(channel)!.start.value).toBe(25); expect(loopEndpoints(channel)!.end.value).toBe(25);
        expect(t.projects.upsert.calls.count()).toBe(saves+1);
        expect(t.mutations.captureSave()!.rigs!.armatures[0].bones[1].pose).toBe(0);
        t.mutations.undo(); expect(loopEndpoints(t.playback.activeAnimation!.tracks[0])!.start.value).toBe(0);
    });
    it('keys the complete authored IK pose once, preserves setup, and supports undo/redo', () => {
        const t = setup(true);
        t.rigs.boneId = 'foot'; t.playback.seek(1); t.rigs.setIKTarget({x:40,y:40});
        const setupRig = JSON.stringify(t.mutations.captureSave()!.rigs);
        const count = t.projects.upsert.calls.count();
        // Selecting a driven bone does not prevent the whole-armature command.
        t.rigs.boneId = 'upper';
        expect(t.rigs.canKeySelectedPose).toBeFalse(); expect(t.rigs.canKeyArmaturePose).toBeTrue();
        t.rigs.keyArmaturePose();
        expect(t.projects.upsert.calls.count()).toBe(count + 1);
        expect(t.svg.animation.tracks.map(track=>track.property).sort()).toEqual([
            'bones.foot.pose','bones.foot.poseX','bones.foot.poseY','bones.root.pose','bones.root.poseX','bones.root.poseY',
        ]);
        expect(JSON.stringify(t.mutations.captureSave()!.rigs)).toBe(setupRig);
        t.rigs.keyArmaturePose(); expect(t.projects.upsert.calls.count()).toBe(count + 1);
        t.mutations.undo(); expect(t.svg.animation.tracks.length).toBe(2);
        t.mutations.redo(); expect(t.svg.animation.tracks.length).toBe(6);
        const restoredPath = t.svg.elements[0] as Path;
        expect(restoredPath.findPointById('tip')!.x).toBeCloseTo(40);
        expect(restoredPath.findPointById('tip')!.y).toBeCloseTo(40);
    });
    it('copies sampled FK controls without saving and pastes a complete independent pose at the playhead', () => {
        const t = setup(); t.playback.seek(1); t.rigs.setPose(60);
        t.playback.seek(.5); const count = t.projects.upsert.calls.count();
        t.rigs.copyPose(); expect(t.projects.upsert.calls.count()).toBe(count);
        t.playback.seek(2); t.rigs.setPose(10);
        const beforePaste = t.projects.upsert.calls.count();
        t.rigs.pastePose();
        expect(t.rigs.bone!.pose).toBeCloseTo(30);
        expect(t.svg.animation.tracks.length).toBe(12);
        expect(t.svg.animation.tracks.every(track => track.keyframes.some(key => key.time === 2))).toBeTrue();
        expect(t.projects.upsert.calls.count()).toBe(beforePaste + 1);
        t.mutations.undo(); expect(t.rigs.bone!.pose).toBe(10);
        t.mutations.redo(); expect(t.rigs.bone!.pose).toBeCloseTo(30);
        // Clipboard values survive later edits and history replacement.
        t.playback.seek(3); t.rigs.pastePose(); expect(t.rigs.bone!.pose).toBeCloseTo(30);
    });
    it('pastes into a rig action without writing scene keys and rejects an unrelated action', () => {
        const t = setup(true); t.rigs.boneId = 'foot'; t.playback.seek(1); t.rigs.setPosePosition(-20,30); t.rigs.copyPose();
        const scene = JSON.stringify(t.svg.animation.tracks);
        const action = t.actions.create('Contact',false,'rig')!; t.playback.seek(.5); t.rigs.pastePose();
        expect(action.animation.tracks.length).toBe(6);
        expect(JSON.stringify(t.svg.animation.tracks)).toBe(scene);
        expect(t.rigs.active!.bones.find(bone=>bone.id==='foot')!.poseY).toBe(30);
        t.playback.editAction();
        const unrelated = t.actions.create('Artwork',false,'selection')!;
        const count = t.projects.upsert.calls.count(); t.rigs.pastePose(); t.rigs.keyArmaturePose();
        expect(unrelated.animation.tracks).toEqual([]);
        expect(t.projects.upsert.calls.count()).toBe(count);
        expect(t.rigs.pastePoseProblem).toContain('includes this rig');
    });
    it('rejects stale or foreign pose clipboards and playback without a partial write', () => {
        const t = setup(); t.rigs.copyPose(); const count = t.projects.upsert.calls.count();
        t.rigs.active!.bones[1].parentId = null;
        t.rigs.pastePose(); expect(t.rigs.message).toContain('skeleton');
        t.rigs.active!.bones[1].parentId = 'root';
        t.svg.id = 'other-document'; t.rigs.pastePose(); expect(t.rigs.message).toContain('same armature and project');
        expect(t.svg.animation.tracks).toEqual([]); expect(t.projects.upsert.calls.count()).toBe(count);
        t.playback.playing = true; t.rigs.keyArmaturePose(); t.rigs.copyPose();
        expect(t.svg.animation.tracks).toEqual([]); t.playback.playing = false;
    });
    it('preflights every control before keying and preserves the copied pose after a rejected paste', () => {
        const t = setup(); t.rigs.copyPose();
        t.playback.upsertKeyframe(t.path,'transform.translateX','number',10); t.mutations.commit('animation');
        const before = JSON.stringify(t.mutations.captureSave()), count = t.projects.upsert.calls.count();
        t.rigs.keyArmaturePose(); t.rigs.pastePose();
        expect(JSON.stringify(t.mutations.captureSave())).toBe(before);
        expect(t.projects.upsert.calls.count()).toBe(count);
        expect(t.rigs.message).toContain('bound path transform changed');
        expect(t.rigs.copiedPoseLabel).toContain('4 controls');
    });
    it('keys FK in one undo step while saving setup geometry and absent offsets exactly', () => {
        const t = setup(), base = JSON.stringify(t.mutations.captureSave());
        t.playback.seek(1); t.rigs.setPose(90);
        expect(t.projects.upsert).toHaveBeenCalledTimes(1);
        expect(t.svg.animation.tracks[0].keyframes.map(key => [key.time,key.value])).toEqual([[0,0],[1,90]]);
        expect(t.path.findPointById('tip')!.y).toBeCloseTo(80);
        const save = t.mutations.captureSave()!;
        expect(save.rigs!.armatures[0].bones[1].pose).toBe(0);
        expect(save.rigs!.armatures[0].bones[1].poseX).toBeUndefined();
        expect(t.path.findPointById('tip')!.y).toBeCloseTo(80);
        t.mutations.undo();
        expect(JSON.stringify(t.mutations.captureSave())).toBe(base);
        t.mutations.redo(); expect(t.rigs.bone!.pose).toBe(90);
        t.playback.setMode('edit'); expect(t.rigs.bone!.pose).toBe(0);
        expect((t.svg.elements[0] as Path).findPointById('tip')!.x).toBeCloseTo(80);
    });
    it('keys persistent target coordinates together and never stores solved angles', () => {
        const t = setup(true); t.rigs.boneId = 'foot'; t.playback.seek(1);
        t.rigs.setIKTarget({x:40,y:40});
        expect(t.rigs.message).toBe('');
        expect(t.projects.upsert).toHaveBeenCalledTimes(1);
        expect(t.svg.animation.tracks.map(track => track.property).sort()).toEqual(['bones.foot.poseX','bones.foot.poseY']);
        for(const time of [1,.5,0,.75,1]) {
            t.playback.seek(time);
            expect(t.path.findPointById('tip')!.x).toBeCloseTo(80-40*time);
            expect(t.path.findPointById('tip')!.y).toBeCloseTo(40*time);
            expect(t.rigs.active!.bones[1].pose).toBe(0);
        }
        const reopened = migrateDocument(createDocumentEnvelope(t.mutations.captureSave()!));
        expect(reopened.status).toBe('ok');
        if(reopened.status !== 'ok') return;
        expect(reopened.value.data.rigs!.armatures[0].constraintsActive).toBeFalse();
        expect(reopened.value.data.rigs!.armatures[0].bones[3].poseX).toBeUndefined();
        t.playback.setMode('edit'); expect(t.path.findPointById('tip')!.x).toBeCloseTo(80);
    });
    it('discards live posing before seeking and changing action context', () => {
        const t = setup(); t.playback.seek(1); t.rigs.setPose(90); t.playback.seek(.5);
        t.rigs.previewFK('upper',{pose:15}); expect(t.rigs.posePreview).toBeDefined();
        t.playback.seek(1); expect(t.rigs.posePreview).toBeUndefined();
        expect(t.path.findPointById('tip')!.y).toBeCloseTo(80);
        t.rigs.previewFK('upper',{pose:15});
        t.actions.create('Leg action',false,'rig');
        expect(t.rigs.posePreview).toBeUndefined(); expect(t.path.findPointById('tip')!.x).toBeCloseTo(80);
        expect(t.svg.animation.tracks.length).toBe(1);
    });
    it('records Quick IK as FK channels and rejects driven bone keys', () => {
        const free = setup(); free.rigs.boneId = 'lower'; free.playback.seek(1); free.rigs.setIKTarget({x:40,y:40});
        expect(free.svg.animation.tracks.every(track => track.property.endsWith('.pose'))).toBeTrue();
        expect(free.path.findPointById('tip')!.y).toBeCloseTo(40);
        const linked = setup(true); linked.playback.seek(1); linked.rigs.setPose(45);
        expect(linked.svg.animation.tracks.length).toBe(0); expect(linked.rigs.message).toContain('follows');
    });
    it('extracts reusable rig actions, repeats placements, and edits only their scoped channels', () => {
        const t = setup(); t.playback.seek(1); t.rigs.setPose(90);
        const action = t.actions.create('Bend',true,'rig')!;
        expect(action.targetIds).toEqual(['rig']); expect(t.svg.animation.tracks.length).toBe(0);
        t.playback.seek(.5); t.rigs.setPose(30);
        expect(action.animation.tracks[0].keyframes.length).toBe(3);
        t.playback.editAction(); const placement = t.actions.place(action.id,1)!;
        t.actions.retime(placement,{sourceStart:0,sourceEnd:1,rate:2,repeat:2});
        t.playback.seek(1.25); expect(t.rigs.bone!.pose).toBeCloseTo(30);
        t.playback.seek(1.75); expect(t.rigs.bone!.pose).toBeCloseTo(30);
        t.playback.seek(.5); expect(t.rigs.bone!.pose).toBe(0);
        const artAction = t.actions.create('Art only',false,'selection')!; expect(artAction).toBeDefined();
        t.rigs.setPose(75); expect(artAction.animation.tracks.length).toBe(0); expect(t.rigs.canPose).toBeFalse();
    });
    it('samples detached rig previews without changing the live pose or persisted setup', () => {
        const t = setup(); t.playback.seek(1); t.rigs.setPose(90); t.playback.seek(.5);
        const copy = SVG.fromSave(t.svg.save(),t.editor); t.playback.restoreSamplingBase(copy);
        expect(copy.rigs.armatures[0].bones[1].pose).toBe(0);
        expect((copy.elements[0] as Path).findPointById('tip')!.x).toBeCloseTo(80);
        expect(t.rigs.bone!.pose).toBe(45);
        const sampling = new AnimationInspectionSnapshot(copy); sampling.origins(1,[t.path.id]);
        expect(t.rigs.bone!.pose).toBe(45);
    });
    it('blocks competing artwork geometry channels before first bone key and allows paint', () => {
        const t = setup(); t.playback.upsertKeyframe(t.path,'transform.translateX','number',0);
        t.rigs.setPose(30); expect(t.rigs.message).toContain('controls');
        expect(t.svg.animation.tracks.length).toBe(1);
        t.playback.removeKeyframeAtCurrentTime(t.path,'transform.translateX');
        t.rigs.setPose(30); t.playback.upsertKeyframe(t.path,'opacity','number',.5);
        expect(t.svg.animation.tracks.length).toBe(2);
        t.playback.upsertKeyframe(t.path,'transform.translateY','number',10);
        expect(t.svg.animation.tracks.length).toBe(2); expect(t.playback.contextMessage).toContain('controls');
    });
    it('rebuilds action gap baselines after setup pose changes in Edit mode', () => {
        const t = setup(); t.playback.seek(1); t.rigs.setPose(90);
        const action = t.actions.create('Bend',true,'rig')!;
        t.playback.editAction(); t.actions.place(action.id,1); t.playback.seek(.5);
        expect(t.rigs.bone!.pose).toBe(0);
        t.playback.setMode('edit'); t.rigs.setPose(20);
        t.playback.setMode('animate'); t.playback.seek(.5);
        expect(t.rigs.bone!.pose).toBe(20);
        t.playback.seek(1.5); expect(t.rigs.bone!.pose).toBe(45);
        t.playback.seek(.5); expect(t.rigs.bone!.pose).toBe(20);
    });
    it('discards a rejected artwork transform gesture without committing the draft', () => {
        const t = setup(); t.playback.seek(1); t.rigs.setPose(30);
        const baseline = JSON.stringify(t.mutations.captureSave()); t.projects.upsert.calls.reset();
        const gesture = new AnimationGestureService(t.editor,t.playback); gesture.begin();
        t.path.transform.translateX = 20; gesture.end(); t.mutations.commit();
        expect(t.playback.contextMessage).toContain('controls');
        expect(t.path.transform.translateX).toBe(0);
        expect(JSON.stringify(t.mutations.captureSave())).toBe(baseline);
        expect(t.projects.upsert).not.toHaveBeenCalled();
    });
    it('does not overwrite manually changed bound points when timeline keying or previewing', () => {
        const t = setup(); t.path.findPointById('tip')!.y = 12;
        t.playback.upsertTargetKeyframe('rig','bones.upper.pose','number',30);
        expect(t.svg.animation.tracks.length).toBe(0);
        expect(t.playback.contextMessage).toContain('Bound points were edited');
        expect(t.path.findPointById('tip')!.y).toBe(12);
        t.svg.animation.tracks.push({id:'stale',targetId:'rig',property:'bones.upper.pose',valueType:'number',keyframes:[{id:'key',time:0,value:30}]});
        t.playback.invalidate(); t.playback.seek(1);
        expect(t.path.findPointById('tip')!.y).toBe(12);
        expect(t.rigs.bone!.pose).toBe(0);
    });
});
