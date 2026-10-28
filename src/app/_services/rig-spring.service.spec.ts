import { NgZone } from '@angular/core';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { EditorService } from './editor.service';
import { HistoryService } from './history.service';
import { RigEditingService } from './rig-editing.service';
import { RigSpringService } from './rig-spring.service';
import { ActionCompositionService } from './action-composition.service';
import { AnimationInspectionService } from './animation-inspection.service';
import { ElementFactory } from './element-factory.service';
import { SVG } from '../editor/objects/svg.object';
import { Path } from '../editor/objects/elements/path.object';
import { Line } from '../editor/objects/line.object';
import { Point } from '../editor/objects/point.object';
import { createPathBinding } from '../editor/rig-binding';
import { springFixture, springAnimation } from '../editor/animation/spring-motion.spec-support';
import { compileRuntimeAnimation } from '../editor/animation/runtime-animation-compiler';
import { evaluateRuntimeTrack } from '../../../packages/runtime/src/evaluator';
import { validateRuntimeBundle } from '../../../packages/runtime/src';

describe('live spring authoring and posing', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
    function setup() {
        const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
        const svg = new SVG(editor, {width:200,height:200,pos:new Point(0,0)}), path = new Path(editor);
        path.lines = [new Line(editor,{type:'line',points:[new Point(0,40,'joint'),new Point(0,70,'end')]})];
        svg.elements = [path]; editor.selectedSVG = svg;
        const armature = springFixture(); armature.bindings = [createPathBinding(svg,path,'tip')];
        svg.rigs.armatures = [armature]; svg.animation = springAnimation(); svg.snapshot();
        const playback = new AnimationPlaybackService(editor,new NgZone({enableLongStackTrace:false}),preferences); playback.mode='edit';
        const projects = {upsert:jasmine.createSpy('upsert')};
        const mutations = new DocumentMutationService(editor,playback,new HistoryService(),projects as never); mutations.resetBaseline();
        const rigs = new RigEditingService(editor,playback,mutations); rigs.selectBone('rig','hair');
        playback.setMode('animate');
        const spring = new RigSpringService(rigs,playback,mutations);
        const actions = new ActionCompositionService(editor,playback,mutations,rigs);
        cleanups.push(() => {spring.ngOnDestroy();playback.ngOnDestroy();mutations.ngOnDestroy();});
        return {svg,path,editor,playback,mutations,rigs,spring,projects,actions};
    }
    function add(t: ReturnType<typeof setup>) {
        t.playback.setMode('edit'); t.spring.setEnd('tip'); t.spring.add();
        expect(t.rigs.active!.springs!.length).toBe(1);
    }
    it('saves base wind in Edit and keys scene/action gusts without persisting preview forces',()=>{
        const t=setup();add(t);t.rigs.setWind('windX',3);t.rigs.setWind('windX',3);
        expect(t.projects.upsert).toHaveBeenCalledTimes(2);
        expect(t.mutations.captureSave()!.rigs!.armatures[0].windX).toBe(3);
        t.playback.setMode('animate');t.playback.seek(.5);t.rigs.setWind('windX',8);
        const track=t.svg.animation.tracks.find(track=>track.property==='physics.windX')!;
        expect(track.keyframes.map(key=>key.value)).toEqual([3,8]);expect(t.rigs.windKeyed('windX')).toBeTrue();
        expect(t.mutations.captureSave()!.rigs!.armatures[0].windX).toBe(3);
        t.mutations.undo();expect(t.svg.animation.tracks.some(track=>track.property==='physics.windX')).toBeFalse();
        const action=t.actions.create('Gust',false,'rig')!;
        t.playback.seek(.3);t.rigs.setWind('windY',-4);
        expect(action.animation.tracks[0].property).toBe('physics.windY');
        expect(t.svg.animation.tracks.some(track=>track.property==='physics.windY')).toBeFalse();
        expect(t.mutations.captureSave()!.rigs!.armatures[0].windY).toBeUndefined();
        t.playback.setMode('edit');expect(t.rigs.active!.windY).toBeUndefined();expect(t.rigs.active!.windX).toBe(3);
    });
    it('creates and tunes persistent constraints in Edit without creating animation tracks', () => {
        const t=setup(), tracks=JSON.stringify(t.svg.animation.tracks); add(t);
        t.spring.setSetting('damping',12); t.spring.setSetting('damping',12);
        expect(t.projects.upsert).toHaveBeenCalledTimes(2);
        const saved=t.mutations.captureSave()!;
        expect(saved.rigs!.version).toBe(6); expect(saved.rigs!.armatures[0].springs![0].boneSettings!.hair.damping).toBe(12);
        expect(JSON.stringify(t.svg.animation.tracks)).toBe(tracks);
        t.mutations.undo(); expect(t.spring.settings.damping).toBe(8);
        t.mutations.redo(); expect(t.spring.settings.damping).toBe(12);
        expect(SVG.fromSave(saved,t.editor).rigs.armatures[0].springs).toEqual(t.rigs.active!.springs);
    });
    it('runs automatically in Animate and keeps solved poses out of saves on backward seeks', () => {
        const t=setup(); add(t); const base=t.mutations.captureSave()!;
        t.playback.setMode('animate'); t.playback.seek(.27341);
        const value=t.path.findPointById('end')!.x;
        expect(t.playback.rigPreviewPose('rig')!.bones[1].pose).not.toBe(0);
        expect(t.rigs.active!.bones[1].pose).toBe(0);
        t.playback.seek(1.8); t.playback.seek(.27341);
        expect(t.path.findPointById('end')!.x).toBeCloseTo(value,8);
        expect(t.mutations.captureSave()).toEqual(base);
        t.playback.setMode('edit'); expect(t.path.findPointById('end')!.x).toBeCloseTo(0,8);
    });
    it('keeps optional baking atomic and disables live physics to avoid double evaluation', async () => {
        const t=setup(); add(t); const before=t.mutations.captureSave()!;
        t.playback.setMode('animate'); t.playback.seek(.3);
        const pose=t.playback.rigPreviewPose('rig')!.bones[1].pose;
        await t.spring.bake();
        expect(t.projects.upsert).toHaveBeenCalledTimes(2);
        expect(t.rigs.active!.springs![0].enabled).toBeFalse(); expect(t.svg.animation.tracks.length).toBe(3);
        expect(t.rigs.active!.bones[1].pose).toBeCloseTo(pose,7);
        t.mutations.undo(); expect(t.mutations.captureSave()).toEqual(before);
        expect(t.playback.rigPreviewPose('rig')!.bones[1].pose).toBeCloseTo(pose,7);
    });
    it('cancels optional baking without changing the constraint or tracks', async () => {
        const t=setup(); add(t); t.playback.setMode('animate'); const before=t.mutations.captureSave();
        const work=t.spring.bake(); t.spring.cancel(); await work;
        expect(t.mutations.captureSave()).toEqual(before); expect(t.projects.upsert).toHaveBeenCalledTimes(1);
    });
    it('samples live physics in onion skins without saved keys', () => {
        const t=setup(); t.editor.selectedElement=t.path; t.playback.seek(.4);
        const inspection=new AnimationInspectionService(t.editor,t.playback,t.mutations,new ElementFactory(t.editor)); inspection.onions=true;
        const original=inspection.display!.skins.map(skin=>skin.image);
        add(t); t.playback.setMode('animate'); t.playback.seek(.4);
        expect(inspection.display!.skins.map(skin=>skin.image)).not.toEqual(original);
        expect(t.svg.animation.tracks.length).toBe(1);
    });
    it('simulates Pose interactively without letting transient geometry enter persistence', () => {
        spyOn(window,'requestAnimationFrame').and.returnValue(123);
        const t=setup(); add(t); t.rigs.workspace='pose'; t.spring.checkContext();
        const before=t.mutations.captureSave()!;
        t.rigs.previewFK('root',{poseX:40,poseY:0});
        (t.spring as any).tick(0); (t.spring as any).tick(40);
        expect(t.rigs.posePreview!.bones[1].pose).not.toBe(0);
        expect(t.mutations.captureSave()).toEqual(before);
        t.rigs.clearPosePreview(); t.spring.ngOnDestroy();
    });
    it('rejects overlapping chains and conflicting artwork channels, and removes constraints in one edit', () => {
        const t=setup(); add(t);
        const candidate={...t.rigs.active!.springs![0],id:'second',rootBoneId:'tip'};
        expect(t.rigs.setSpringConstraint(candidate)).toBeFalse(); expect(t.rigs.message).toContain('overlap');
        t.spring.remove(); expect(t.rigs.active!.springs).toBeUndefined();
        t.mutations.undo(); expect(t.rigs.active!.springs).toHaveSize(1);
        t.spring.enable(false); expect(t.rigs.active!.springs![0].enabled).toBeFalse();
    });
    it('keeps simulated angles during repeated pointer previews, commit, and cancellation', () => {
        spyOn(window,'requestAnimationFrame').and.returnValue(123);
        const t=setup(); add(t); t.rigs.workspace='pose'; t.spring.checkContext();
        (t.spring as any).tick(0);
        t.rigs.previewFK('root',{poseX:40,poseY:0}); (t.spring as any).tick(40);
        const angle=t.rigs.posePreview!.bones[1].pose;
        expect(Math.abs(angle)).toBeGreaterThan(1);
        for(let x=41;x<=48;x++) {
            t.rigs.previewFK('root',{poseX:x,poseY:0});
            expect(t.rigs.posePreview!.bones[1].pose).toBeCloseTo(angle,8);
            expect(t.rigs.physicsInput!.bones[0].poseX).toBe(x);
        }
        t.rigs.cancelPoseGesture();
        expect(t.rigs.posePreview!.bones[1].pose).toBeCloseTo(angle,8);
        expect(t.rigs.physicsInput!.bones[0].poseX).toBeUndefined();
        t.rigs.setPosePosition(48,0,'root');
        expect(t.rigs.posePreview!.bones[1].pose).toBeCloseTo(angle,8);
        expect(t.projects.upsert).toHaveBeenCalledTimes(2);
        const saved=t.mutations.captureSave()!;
        expect(saved.rigs!.armatures[0].bones[1].pose).toBe(0);
        expect(saved.rigs!.armatures[0].bones[0].poseX).toBe(48);
        t.spring.checkContext(); (t.spring as any).tick(56);
        expect(t.rigs.posePreview!.bones[1].pose).not.toBe(0);
    });
    it('authors an explicit range and independent per-bone settings with undo and persistence', () => {
        const t=setup(); t.playback.setMode('edit');
        expect(t.spring.endBoneId).toBe('hair');
        t.spring.setEnd('tip');t.spring.add();
        t.spring.setSetting('stiffness',200);
        t.spring.selectSettingsBone('tip');expect(t.spring.settings.stiffness).toBe(80);
        t.spring.setSetting('stiffness',20);t.spring.setSetting('mix',.4);
        t.spring.selectSettingsBone('hair');expect(t.spring.settings.stiffness).toBe(200);
        expect(t.rigs.active!.springs![0].boneSettings!.tip.mix).toBe(.4);
        const saved=t.mutations.captureSave()!;
        expect(SVG.fromSave(saved,t.editor).rigs.armatures[0].springs).toEqual(t.rigs.active!.springs);
        t.spring.setEnd('hair');expect(t.spring.chainBones.map(bone=>bone.id)).toEqual(['hair']);
        expect(t.rigs.active!.springs![0].boneSettings!.tip).toBeUndefined();
        t.mutations.undo();expect(t.spring.endBoneId).toBe('tip');
        expect(t.rigs.active!.springs![0].boneSettings!.tip.mix).toBe(.4);
    });

});
