import { ChangeDetectorRef, ElementRef, NgZone } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { faAngleDown, faAngleRight, faChevronLeft, faChevronRight, faDiamond } from '@fortawesome/free-solid-svg-icons';
import { TimelineRowComponent } from '../_components/timeline-row/timeline-row.component';
import { Armature } from '../editor/objects/armature';
import { SVG } from '../editor/objects/svg.object';
import { Shape } from '../editor/objects/elements/shape.object';
import { Point } from '../editor/objects/point.object';
import { AnimationTrack } from '../editor/objects/animation.object';
import { ActionCompositionService } from './action-composition.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { findOrphanedAnimationTracks } from './animation-track-cleanup.service';
import { DocumentMutationService } from './document-mutation.service';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { HistoryService } from './history.service';
import { PaintEditingService } from './paint-editing.service';
import { RigEditingService } from './rig-editing.service';
import { RigPropertyTimelineRow, semanticPartnerProperty, TimelineEditingService } from './timeline-editing.service';
import { TimelineEditorService } from './timeline-editor.service';

function fixtureRig(): Armature {
    return { id: 'character', name: 'Character', bindings: [], bones: [
        { id: 'root', name: 'Root', parentId: null, kind: 'point', x: 0, y: 0, angle: 0, length: 0, pose: 0 },
        { id: 'upper', name: 'Thigh', parentId: 'root', x: 0, y: 0, angle: 0, length: 50, pose: 0 },
        { id: 'lower', name: 'Shin', parentId: 'upper', x: 50, y: 0, angle: 0, length: 40, pose: 0 },
        { id: 'foot', name: 'Foot', parentId: 'root', kind: 'point', x: 75, y: 15, angle: 0, length: 0, pose: 0 },
    ], constraints: [{ id: 'ik', name: 'Leg', type: 'two-bone-ik', enabled: true, upperBoneId: 'upper', lowerBoneId: 'lower', targetBoneId: 'foot', bend: 1 }] };
}
function setup() {
    const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
    const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0,0) });
    const shape = new Shape(editor, { type: 'rectangle', position: new Point(0,0) });
    svg.elements = [shape]; svg.rigs.armatures = [fixtureRig()]; svg.animation.duration = 4;
    editor.selectedSVG = svg; editor.selectedElement = shape; svg.snapshot();
    const zone = new NgZone({ enableLongStackTrace: false }), playback = new AnimationPlaybackService(editor, zone, preferences);
    const projects = { upsert: jasmine.createSpy('upsert') };
    const mutations = new DocumentMutationService(editor, playback, new HistoryService(), projects as never);
    const rig = new RigEditingService(editor, playback, mutations); rig.selectBone('character', 'foot');
    playback.setMode('animate'); rig.workspace = 'pose'; mutations.resetBaseline();
    const timeline = new TimelineEditorService(editor, playback, new ElementRef(document.createElement('div')), preferences,
        new TimelineEditingService(), zone, mutations, { markForCheck: () => {} } as ChangeDetectorRef, {} as PaintEditingService, rig);
    timeline.expandedLayerIds = new Set(['character', 'character:root', 'character:upper', 'character:lower', 'character:foot']);
    const subscription = timeline.animationChange.subscribe(() => mutations.commit('animation'));
    const row = (boneId = 'foot', field = 'poseX') => timeline.rows.find((row): row is RigPropertyTimelineRow => row.type === 'rig-property' && row.bone.id === boneId && row.property.property.endsWith('.' + field))!;
    const actions = new ActionCompositionService(editor, playback, mutations, rig);
    const destroy = () => { subscription.unsubscribe(); timeline.ngOnDestroy(); playback.ngOnDestroy(); mutations.ngOnDestroy(); };
    return { editor, svg, shape, rig, playback, mutations, projects, timeline, row, actions, destroy };
}
function pointer(clientX: number, capture: HTMLElement, type = 'pointermove'): PointerEvent {
    return { pointerId: 1, button: 0, clientX, currentTarget: capture, type, preventDefault() {}, stopPropagation() {} } as unknown as PointerEvent;
}
function track(property: string, id = property): AnimationTrack {
    return { id, targetId: 'character', property, valueType: 'number', keyframes: [{ id: id + '-0', time: 0, value: 0 }, { id: id + '-1', time: 1, value: 20 }] };
}

describe('bone timeline and reusable actions', () => {
    it('projects real rig hierarchy independently of artwork and pairs target position curves', () => {
        const t = setup();
        expect(t.timeline.rows.filter(row => row.type === 'bone').map(row => [row.bone.id, row.depth])).toEqual([['root',1],['upper',2],['lower',3],['foot',2]]);
        expect(t.svg.elements).toEqual([t.shape]);
        expect(semanticPartnerProperty('bones.foot.poseX')).toBe('bones.foot.poseY');
        t.timeline.toggleRow(t.timeline.rows.find(row => row.type === 'bone' && row.bone.id === 'upper')!);
        expect(t.timeline.rows.some(row => row.type === 'bone' && row.bone.id === 'lower')).toBeFalse();
        expect(t.timeline.rows.some(row => row.type === 'bone' && row.bone.id === 'foot')).toBeTrue();
        t.destroy();
    });
    it('selects a bone without creating artwork and edits its numeric tracks with one undo', () => {
        const t = setup(), row = t.row();
        t.timeline.selectTimelineRow(row);
        expect(t.editor.selectedElements).toEqual([]); expect(t.rig.boneId).toBe('foot');
        t.playback.seek(1); const count = t.projects.upsert.calls.count();
        t.timeline.setPropertyValue(row, 30);
        expect(t.projects.upsert.calls.count()).toBe(count + 1);
        expect(t.svg.animation.tracks[0].property).toBe('bones.foot.poseX');
        expect(t.svg.animation.tracks[0].keyframes.map(key => key.value)).toEqual([0,30]);
        expect(t.rig.bone!.poseX).toBe(30);
        t.mutations.undo(); expect(t.svg.animation.tracks).toHaveSize(0);
        t.destroy();
    });
    it('keys and graphs IK targets but keeps solver-controlled bone fields read-only', () => {
        const t = setup();
        const controlled = t.row('lower', 'pose'); t.timeline.toggleKey(controlled);
        expect(t.svg.animation.tracks).toHaveSize(0); expect(t.timeline.rowDisabledReason(controlled)).toContain('Foot');
        t.timeline.toggleKey(t.row()); t.timeline.toggleKey(t.row('foot', 'poseY'));
        expect(t.svg.animation.tracks).toHaveSize(2);
        t.timeline.selectTimelineRow(t.row());
        expect(t.timeline.graphTracks().map(item => item.axis)).toEqual(['x','y']);
        expect(t.timeline.hasKeyAtTime(t.row())).toBeTrue();
        t.timeline.toggleKey(t.row()); expect(t.timeline.hasKeyAtTime(t.row())).toBeFalse();
        t.destroy();
    });
    it('copies a target to another bone and preserves multiple bone identities when pasting a sequence', () => {
        const t = setup();
        t.svg.animation.tracks = [track('bones.foot.poseX')]; t.playback.invalidate();
        t.timeline.selectedKeyframeIds = new Set(t.svg.animation.tracks[0].keyframes.map(key => key.id));
        t.timeline.copySelectedKeyframes(); t.timeline.selectTimelineRow(t.row('root')); t.playback.seek(2);
        expect(t.timeline.pasteKeyframes()).toBeTrue();
        expect(t.svg.animation.tracks.find(track => track.property === 'bones.root.poseX')!.keyframes.map(key => key.time)).toEqual([2,3]);
        t.timeline.selectedKeyframeIds = new Set(t.svg.animation.tracks.flatMap(track => track.keyframes.map(key => key.id)));
        t.timeline.copySelectedKeyframes(); t.playback.seek(0); t.timeline.selectTimelineRow(t.row());
        t.timeline.pasteKeyframes();
        expect(t.svg.animation.tracks.map(track => track.property)).toEqual(['bones.foot.poseX','bones.root.poseX']);
        t.destroy();
    });
    it('discards numeric drag drafts on Escape, pointer cancellation and scope change', fakeAsync(() => {
        for(const reason of ['escape', 'pointer', 'scope']) {
            const t = setup(), input = document.createElement('input');
            t.playback.seek(1); const count = t.projects.upsert.calls.count();
            t.timeline.beginNumberDrag(t.row(), pointer(10,input)); t.timeline.updateNumberDrag(pointer(40,input)); tick(20);
            expect(t.svg.animation.tracks.length).toBeGreaterThan(0);
            if(reason === 'escape') t.timeline.handleTimelineShortcut(new KeyboardEvent('keydown', {key:'Escape'}));
            if(reason === 'pointer') t.timeline.endNumberDrag(pointer(40,input,'pointercancel'));
            if(reason === 'scope') t.playback.seek(2);
            expect(t.svg.animation.tracks).withContext(reason).toHaveSize(0);
            expect(t.projects.upsert.calls.count()).withContext(reason).toBe(count);
            expect(t.rig.bone!.poseX ?? 0).toBe(0);
            t.destroy();
        }
    }));
    it('does not leave zero-value keys after dragging a numeric field back to its original value', fakeAsync(() => {
        const t = setup(), input = document.createElement('input'), count = t.projects.upsert.calls.count();
        t.timeline.beginNumberDrag(t.row(), pointer(10,input));
        t.timeline.updateNumberDrag(pointer(40,input)); tick(20);
        t.timeline.updateNumberDrag(pointer(10,input)); tick(20);
        t.timeline.endNumberDrag(pointer(10,input,'pointerup'));
        expect(t.svg.animation.tracks).toHaveSize(0); expect(t.projects.upsert.calls.count()).toBe(count);
        t.destroy();
    }));
    it('extracts rig channels explicitly while preserving artwork keys and reuses the action with trims and loops', () => {
        const t = setup();
        t.svg.animation.tracks = [track('bones.foot.poseX'), { ...track('transform.translateX', 'art'), targetId: t.shape.id }];
        t.playback.invalidate(); t.mutations.commit('animation');
        const action = t.actions.create('Step', true, 'rig')!;
        expect(action.targetIds).toEqual(['character']); expect(action.animation.tracks).toHaveSize(1);
        expect(t.svg.animation.tracks.map(track => track.targetId)).toEqual([t.shape.id]);
        expect(t.playback.allowsTarget('character')).toBeTrue(); expect(t.playback.allowsTarget(t.shape.id)).toBeFalse();
        t.timeline.setPropertyValue(t.row('root'), 4);
        expect(action.animation.tracks.map(track => track.property)).toContain('bones.root.poseX');
        t.playback.editAction(); const placement = t.actions.place(action.id, 1)!;
        t.actions.retime(placement, { sourceEnd: 1, rate: 2, repeat: 2 });
        expect(t.actions.duration(placement)).toBe(1);
        t.playback.seek(1.25); expect(t.rig.active!.bones.find(bone => bone.id === 'foot')!.poseX).toBeCloseTo(10);
        t.playback.seek(1.75); expect(t.rig.active!.bones.find(bone => bone.id === 'foot')!.poseX).toBeCloseTo(10);
        t.playback.seek(2); expect(t.rig.active!.bones.find(bone => bone.id === 'foot')!.poseX ?? 0).toBe(0);
        t.destroy();
    });
    it('keeps valid rig source keys during orphan repair and identifies missing bones', () => {
        const t = setup(), action = t.actions.create('Step', false, 'rig')!;
        t.svg.animation.tracks = [track('bones.foot.poseX')];
        action.animation.tracks = [track('bones.root.pose','source'), track('bones.missing.pose','missing')];
        expect(findOrphanedAnimationTracks(t.svg).map(track => track.id)).toEqual(['missing']);
        t.destroy();
    });
    it('renders numeric and key controls for target rows and locks driven rows', async () => {
        const t = setup();
        await TestBed.configureTestingModule({ imports: [TimelineRowComponent], providers: [{ provide: TimelineEditorService, useValue: t.timeline }] }).compileComponents();
        TestBed.inject(FaIconLibrary).addIcons(faAngleDown,faAngleRight,faChevronLeft,faChevronRight,faDiamond);
        const fixture = TestBed.createComponent(TimelineRowComponent); fixture.componentRef.setInput('row',t.row()); fixture.detectChanges();
        const input: HTMLInputElement = fixture.nativeElement.querySelector('input[type=number]');
        expect(input.disabled).toBeFalse();
        fixture.nativeElement.querySelector('.key-toggle').click(); fixture.detectChanges();
        expect(t.svg.animation.tracks[0].property).toBe('bones.foot.poseX');
        fixture.componentRef.setInput('row', t.row('lower','pose')); fixture.detectChanges();
        await fixture.whenStable(); fixture.detectChanges();
        expect((fixture.nativeElement.querySelector('input') as HTMLInputElement).disabled).toBeTrue();
        expect(fixture.nativeElement.querySelector('.key-toggle').title).toContain('Foot');
        fixture.destroy(); t.destroy();
    });
});
