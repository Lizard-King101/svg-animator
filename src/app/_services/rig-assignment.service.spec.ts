import { NgZone } from '@angular/core';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { HistoryService } from './history.service';
import { RigEditingService } from './rig-editing.service';
import { SVG } from '../editor/objects/svg.object';
import { Path } from '../editor/objects/elements/path.object';
import { Shape } from '../editor/objects/elements/shape.object';
import { Group } from '../editor/objects/elements/group.object';
import { Point } from '../editor/objects/point.object';
import { Line } from '../editor/objects/line.object';
import { bindingWeightMode, pointWeightState } from '../editor/rig-weight-editing';
import { buildSVGMarkup } from '../editor/svg-markup';

describe('unified artwork assignment', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
    function setup() {
        const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
        const svg = new SVG(editor,{width:200,height:200,pos:new Point(0,0)}), path = new Path(editor), group = new Group(editor);
        path.lines = [new Line(editor,{type:'bezier',points:[new Point(10,0),new Point(190,0)],controlStart:new Point(50,20),controlEnd:new Point(150,20)})];
        group.elements = [path]; svg.elements = [group]; editor.selectedSVG = svg; editor.selectedElement = path; svg.snapshot();
        const playback = new AnimationPlaybackService(editor,new NgZone({enableLongStackTrace:false}),preferences); playback.mode='edit';
        const projects = {upsert:jasmine.createSpy('upsert')}, mutations = new DocumentMutationService(editor,playback,new HistoryService(),projects as never); mutations.resetBaseline();
        const rigs = new RigEditingService(editor,playback,mutations);
        cleanups.push(() => {playback.ngOnDestroy();mutations.ngOnDestroy();});
        rigs.create(); const root=rigs.bone!; rigs.editBone({x:0,y:0});
        rigs.drawBone({x:0,y:0},{x:100,y:0},'bone',root.id); const upper=rigs.bone!;
        rigs.drawBone({x:100,y:0},{x:200,y:0},'bone',upper.id); const lower=rigs.bone!;
        const ref={pathId:path.id,pointId:path.lines[0].points[0].id};
        return {editor,svg,path,group,playback,projects,mutations,rigs,root,upper,lower,ref};
    }
    it('uses native rigid bindings, initializes a second bone spatially, and unbinds in one undo step', () => {
        const t=setup(), geometry=t.path.pathPoints().map(p=>({id:p.id,x:p.x,y:p.y}));
        expect(t.rigs.assignArtworkBones(t.path,[t.upper.id])).toBeTrue();
        expect(t.rigs.active!.attachments?.length ?? 0).toBe(0);
        expect(bindingWeightMode(t.rigs.active!,t.rigs.active!.bindings)).toBe('rigid');
        expect(t.rigs.setPointWeight(t.ref,t.upper.id,.6)).toBeFalse();
        expect(t.rigs.assignArtworkBones(t.path,[t.upper.id,t.lower.id])).toBeTrue();
        expect(pointWeightState(t.rigs.active!,t.ref).weights).toEqual([{boneId:t.upper.id,weight:1}]);
        const last={pathId:t.path.id,pointId:t.path.lines[0].points[1].id};
        expect(pointWeightState(t.rigs.active!,last).weights).toEqual([{boneId:t.lower.id,weight:1}]);
        expect(t.path.pathPoints().map(p=>({id:p.id,x:p.x,y:p.y}))).toEqual(geometry);
        const before=t.svg.save(), saves=t.projects.upsert.calls.count();
        expect(t.rigs.assignArtworkBones(t.path,[])).toBeTrue();
        expect(t.rigs.active!.bindings).toEqual([]); expect(t.projects.upsert.calls.count()).toBe(saves+1);
        t.mutations.undo(); expect(t.svg.save()).toEqual(before);
    });
    it('preserves manual weights and independent handles when adding a third assigned bone at zero', () => {
        const t=setup(); t.rigs.assignArtworkBones(t.group,[t.upper.id,t.lower.id]);
        t.rigs.setPointWeight(t.ref,t.upper.id,.6);
        const handle={pathId:t.path.id,pointId:t.path.lines[0].controlStart!.id};
        t.rigs.setHandleIndependent(handle,true); t.rigs.setPointWeight(handle,t.upper.id,.3);
        expect(t.rigs.assignArtworkBones(t.group,[t.upper.id,t.lower.id,t.root.id])).toBeTrue();
        expect(pointWeightState(t.rigs.active!,t.ref).weights).toEqual([{boneId:t.upper.id,weight:.6},{boneId:t.lower.id,weight:.4}]);
        expect(pointWeightState(t.rigs.active!,handle).weights.find(w=>w.boneId===t.upper.id)!.weight).toBeCloseTo(.3);
        expect(t.rigs.active!.bindings[0].boneIds).toContain(t.root.id);
        expect(pointWeightState(t.rigs.active!,handle).weights.some(w=>w.boneId===t.root.id)).toBeFalse();
    });
    it('previews edits without writes, preserves locked values, and explicitly clears at rest', () => {
        const t=setup(); t.rigs.assignArtworkBones(t.path,[t.upper.id,t.lower.id,t.root.id]);
        const before=t.svg.save(), preview=t.rigs.previewPointWeights([t.ref],t.upper.id,.6)!;
        expect(t.svg.save()).toEqual(before); expect(preview[0].weights.find(w=>w.boneId===t.upper.id)!.weight).toBe(.6);
        t.rigs.applyWeightUpdates(preview); t.rigs.setWeightLocks([t.ref],t.upper.id,true);
        t.rigs.setPointWeight(t.ref,t.lower.id,.3);
        expect(pointWeightState(t.rigs.active!,t.ref).weights.find(w=>w.boneId===t.upper.id)!.weight).toBe(.6);
        const locked=t.svg.save(), saves=t.projects.upsert.calls.count();
        expect(t.rigs.clearPointWeights([t.ref])).toBeFalse();
        expect(t.rigs.assignArtworkBones(t.path,[t.upper.id])).toBeFalse();
        expect(t.svg.save()).toEqual(locked); expect(t.projects.upsert.calls.count()).toBe(saves);
        t.rigs.setWeightLocks([t.ref],t.upper.id,false); t.rigs.clearPointWeights([t.ref]);
        expect(pointWeightState(t.rigs.active!,t.ref).weights).toEqual([]);
        expect(t.rigs.assignArtworkBones(t.path,[t.lower.id])).toBeTrue();
        expect(t.rigs.active!.bindings[0].points.filter(p=>p.id===p.anchorId).every(p=>p.weights[0]?.boneId===t.lower.id && p.weights[0].weight===1)).toBeTrue();
    });
    it('converts an existing transform attachment at rest with one atomic undo step', () => {
        const t=setup(); t.rigs.attach(t.group,t.upper.id); t.rigs.setPose(20,t.upper.id);
        const posed=t.svg.save(); expect(t.rigs.assignArtworkBones(t.group,[t.upper.id,t.lower.id])).toBeFalse();
        expect(t.rigs.message).toContain('Reset to rest'); expect(t.svg.save()).toEqual(posed);
        t.rigs.resetPose(); const before=t.svg.save(), saves=t.projects.upsert.calls.count(), markup=buildSVGMarkup(t.svg);
        expect(t.rigs.assignArtworkBones(t.group,[t.upper.id,t.lower.id])).toBeTrue();
        expect(t.rigs.active!.attachments).toEqual([]); expect(t.rigs.active!.bindings.length).toBe(1);
        expect(buildSVGMarkup(t.svg)).toBe(markup); expect(t.projects.upsert.calls.count()).toBe(saves+1);
        t.mutations.undo(); expect(t.svg.save()).toEqual(before);
    });
    it('rejects an unsupported descendant without partially binding or changing hierarchy', () => {
        const t=setup(), shape=new Shape(t.editor,{type:'rectangle',position:new Point(20,30),width:20,height:10}); t.group.elements.push(shape); t.mutations.commit();
        const before=t.svg.save(), saves=t.projects.upsert.calls.count();
        expect(t.rigs.assignmentProblem(t.group,[t.upper.id,t.lower.id])).toContain('Convert shapes or text');
        expect(t.rigs.assignArtworkBones(t.group,[t.upper.id,t.lower.id])).toBeFalse();
        expect(t.svg.save()).toEqual(before); expect(t.projects.upsert.calls.count()).toBe(saves);
        expect(t.rigs.assignArtworkBones(t.group,[t.upper.id])).toBeTrue();
        expect(t.rigs.active!.bindings.length).toBe(0); expect(t.rigs.active!.attachments![0].elementId).toBe(t.group.id);
    });
    it('round-trips locks and static appearance while leaving legacy custom unweighted points untouched', () => {
        const t=setup(); t.rigs.bind(); t.rigs.clearPointWeights([t.ref]);
        const before=t.svg.save(), markup=buildSVGMarkup(t.svg), reopened=SVG.fromSave(JSON.parse(JSON.stringify(before)),t.editor);
        expect(reopened.rigs).toEqual(t.svg.rigs); expect(buildSVGMarkup(reopened)).toBe(markup);
        expect(bindingWeightMode(reopened.rigs.armatures[0],reopened.rigs.armatures[0].bindings)).toBe('custom');
        t.rigs.assignArtworkBones(t.path,[t.upper.id,t.lower.id]); t.rigs.setPointWeight(t.ref,t.upper.id,.6); t.rigs.setWeightLocks([t.ref],t.upper.id,true);
        const restored=SVG.fromSave(JSON.parse(JSON.stringify(t.svg.save())),t.editor);
        expect(pointWeightState(restored.rigs.armatures[0],t.ref).lockedBoneIds).toEqual([t.upper.id]);
        expect(buildSVGMarkup(restored)).toBe(buildSVGMarkup(t.svg));
    });
    it('protects a zero locked influence in an unrestricted legacy binding from bone deletion', () => {
        const t=setup(); t.rigs.boneId=t.upper.id; t.rigs.bind(); t.rigs.setWeightLocks([t.ref],t.lower.id,true);
        const before=t.svg.save(); t.rigs.boneId=t.lower.id; t.rigs.deleteBone();
        expect(t.svg.save()).toEqual(before); expect(t.rigs.message).toContain('Unbind');
    });
});
