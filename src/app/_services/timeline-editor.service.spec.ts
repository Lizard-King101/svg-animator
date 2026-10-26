import { linkLoopSeam } from '../editor/animation/loop-seam';
import { ChangeDetectorRef, ElementRef, EventEmitter, NgZone } from "@angular/core";
import { fakeAsync, tick } from "@angular/core/testing";
import { AnimationPlaybackService } from "./animation-playback.service";
import { DocumentMutationService } from "./document-mutation.service";
import { EditorPreferencesService } from "./editor-preferences.service";
import { EditorService } from "./editor.service";
import { PaintEditingService } from "./paint-editing.service";
import { TimelineEditingService, PropertyTimelineRow } from "./timeline-editing.service";
import { TimelineEditorService } from "./timeline-editor.service";
import { evaluateTrack, applyEasingPresetToKeyframe, ANIMATABLE_PROPERTIES, AnimationTrack } from "../editor/objects/animation.object";
import { Shape } from "../editor/objects/elements/shape.object";
import { Group } from "../editor/objects/elements/group.object";
import { Point } from "../editor/objects/point.object";
import { SVG } from "../editor/objects/svg.object";

describe("TimelineEditorService scale and viewport policy", () => {
    it('retimes selected scale channels together with stable identities and one completion', () => {
        const { timeline, shape } = setup();
        const tracks = matchingScaleTracks(shape); timeline.editor.selectedSVG!.animation.tracks = tracks;
        tracks.forEach(track => track.keyframes.forEach(key => timeline.selectedKeyframeIds.add(key.id)));
        const first = tracks[0].keyframes[0], commit = jasmine.createSpy('commit');
        timeline.animationChange.subscribe(commit);
        expect(timeline.retimeSelectedKeys({ kind: 'scale', factor: 2, pivot: 'start', playhead: 0 })).toBeTrue();
        expect(tracks.map(track => track.keyframes.map(key => key.time))).toEqual([[0, 2], [0, 2]]);
        expect(tracks[0].keyframes[0]).toBe(first); expect(commit).toHaveBeenCalledTimes(1);
        expect(timeline.retimeSelectedKeys({ kind: 'scale', factor: 1, pivot: 'start', playhead: 0 })).toBeFalse();
        expect(commit).toHaveBeenCalledTimes(1); expect(timeline.selectedKeyframeIds.size).toBe(4);
        timeline.ngOnDestroy();
    });

    it('retimes the active action without touching scene keys and rejects linked boundaries', () => {
        const { timeline, shape } = setup();
        const scene = matchingScaleTracks(shape); timeline.editor.selectedSVG!.animation.tracks = scene;
        const tracks: AnimationTrack[] = matchingScaleTracks(shape);
        Object.defineProperty(timeline.animation, 'activeAnimation', { value: { ...timeline.editor.selectedSVG!.animation, tracks } });
        tracks[0].keyframes.forEach(key => timeline.selectedKeyframeIds.add(key.id));
        const commit = jasmine.createSpy('commit'); timeline.animationChange.subscribe(commit);
        expect(timeline.retimeSelectedKeys({ kind: 'reverse' })).toBeTrue();
        expect(tracks[0].keyframes.map(key => key.id)).toEqual(['0-1', '0-0']);
        expect(scene[0].keyframes.map(key => key.id)).toEqual(['0-0', '0-1']);
        tracks[0].loopSeam = { startKeyId: '0-1', endKeyId: '0-0', smooth: false };
        expect(timeline.retimeSelectedKeys({ kind: 'reverse' })).toBeFalse();
        expect(commit).toHaveBeenCalledTimes(1); expect(timeline.animation.contextMessage).toContain('Unlink');
        timeline.ngOnDestroy();
    });

    it('finds animated channels inside collapsed groups without changing saved expansion', () => {
        const { timeline, shape } = setup();
        const group = new Group(timeline.editor); group.name = 'Character'; group.elements = [shape]; shape.name = 'Hand';
        timeline.editor.selectedSVG!.elements = [group];
        timeline.editor.selectedSVG!.animation.tracks = matchingScaleTracks(shape);
        timeline.setRowFilters('hand', false, true);
        expect(timeline.rows.map(row => timeline.rowLabel(row))).toEqual(['Character', 'Hand', 'Scale']);
        expect(timeline.expandedLayerIds.size).toBe(0);
        timeline.setRowFilters('', false, false);
        expect(timeline.rows.map(row => timeline.rowLabel(row))).toEqual(['Character']);
        timeline.ngOnDestroy();
    });

    it('clears key selection when filtering and never deletes newly hidden keys', () => {
        const { timeline, shape } = setup();
        const tracks = matchingScaleTracks(shape); timeline.editor.selectedSVG!.animation.tracks = tracks;
        timeline.editor.selectedElements = [shape];
        timeline.selectedKeyframeIds.add('0-0');
        timeline.setRowFilters('', true, true);
        expect(timeline.selectedKeyframeIds.size).toBe(0);
        timeline.selectedKeyframeIds.add('0-0');
        timeline.editor.selectedElements = [];
        expect(timeline.deleteSelectedKeyframes()).toBeFalse();
        expect(tracks[0].keyframes.length).toBe(2);
        expect(timeline.rows.length).toBe(0);
        timeline.ngOnDestroy();
    });

    it('navigates selected channels before selected artwork and respects editable focus', () => {
        const { timeline, shape } = setup();
        const tracks = matchingScaleTracks(shape); tracks[1].keyframes[1].time = 1.5;
        timeline.editor.selectedSVG!.animation.tracks = tracks;
        timeline.editor.selectedElements = [shape];
        timeline.animation.seek = jasmine.createSpy('seek'); timeline.animation.pause = jasmine.createSpy('pause');
        timeline.selectedKeyframeIds.add('1-0');
        expect(timeline.adjacentPoseTime(1)).toBe(1.5);
        const input = document.createElement('input'); document.body.append(input);
        input.addEventListener('keydown', event => timeline.handleTimelineShortcut(event));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true }));
        expect(timeline.animation.seek).not.toHaveBeenCalled(); input.remove();
        const shortcut = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, cancelable: true });
        timeline.handleTimelineShortcut(shortcut);
        expect(timeline.animation.seek).toHaveBeenCalledWith(1.5);
        expect(shortcut.defaultPrevented).toBeTrue();
        timeline.selectedKeyframeIds.clear();
        expect(timeline.adjacentPoseTime(1)).toBe(1);
        timeline.animation.currentTime = 1;
        expect(timeline.adjacentPoseTime(-1)).toBe(0);
        timeline.ngOnDestroy();
    });

    it('fits keys, work area and duration using viewport width and resets stale horizontal scroll', fakeAsync(() => {
        const { timeline, shape } = setup();
        const host = (timeline as any).host.nativeElement as HTMLElement;
        const viewport = document.createElement('div'); viewport.className = 'timeline-table'; host.append(viewport);
        Object.defineProperty(viewport, 'clientWidth', { value: 960 });
        Object.defineProperty(viewport, 'scrollLeft', { value: 0, writable: true });
        timeline.editor.selectedSVG!.animation.tracks = matchingScaleTracks(shape);
        timeline.selectedKeyframeIds.add('0-0'); timeline.selectedKeyframeIds.add('0-1');
        timeline.fitSelectedKeys(); tick(17);
        expect(timeline.pixelsPerSecond).toBe(544);
        (timeline.animation as any).workArea = { start: .5, end: 1.5 };
        timeline.fitWorkArea(); tick(17); expect(viewport.scrollLeft).toBe(272);
        timeline.fitTimeline(); tick(17); expect(viewport.scrollLeft).toBe(0);
        timeline.ngOnDestroy();
    }));

    it('reveals a selected descendant and its ancestors without editing animation', fakeAsync(() => {
        const { timeline, shape } = setup();
        const group = new Group(timeline.editor); group.elements = [shape];
        timeline.editor.selectedSVG!.elements = [group]; timeline.editor.selectedElements = [shape];
        const viewport = document.createElement('div'); viewport.className = 'timeline-table';
        Object.defineProperty(viewport, 'scrollTop', { value: 0, writable: true });
        (timeline as any).host.nativeElement.append(viewport);
        const before = JSON.stringify(timeline.activeAnimation);
        timeline.setRowFilters('missing', false, true); expect(timeline.rows).toEqual([]);
        timeline.revealSelection(); tick(17);
        expect(timeline.filteringRows).toBeFalse();
        expect(timeline.expandedLayerIds.has(group.id)).toBeTrue();
        expect(timeline.expandedLayerIds.has(shape.id)).toBeTrue();
        expect(timeline.rows.some(row => row.type === 'property' && row.element === shape)).toBeTrue();
        const selectedIndex = timeline.rows.findIndex(row => row.type === 'layer' && row.element === shape);
        expect(viewport.scrollTop).toBe(selectedIndex * 30);
        expect(JSON.stringify(timeline.activeAnimation)).toBe(before);
        timeline.ngOnDestroy();
    }));

    it('reserves placement row height in the shared grid and virtual layer viewport', () => {
        const { timeline } = setup();
        timeline.editor.selectedSVG!.animation.composition = { version: 1, actions: [], placements: [
            { id: 'one', actionId: 'source', start: 0 }, { id: 'two', actionId: 'source', start: 2 },
        ] };
        expect(timeline.placementGridRows).toBe('30px repeat(2, 64px)');
        const window = spyOn(timeline as any, 'updateLayerWindow');
        timeline.updateTimelineViewport({ currentTarget: { scrollTop: 218, clientHeight: 300, scrollLeft: 0, clientWidth: 900 } } as unknown as Event);
        expect(window).toHaveBeenCalledWith(60, 300);
        timeline.updateTimelineViewport({ currentTarget: { scrollTop: 0, clientHeight: 300, scrollLeft: 0, clientWidth: 900 } } as unknown as Event);
        expect(window).toHaveBeenCalledWith(0, 142);
    });

    it('keeps graph selection and active scrubbing through seeks but clears them on context changes', () => {
        const {timeline,shape}=setup();
        timeline.selectedGraphTargetId=shape.id; timeline.selectedGraphProperty='transform.translateX';
        (timeline as any).scrubbing=true;
        timeline.animation.contextChanging.next('seek');
        expect(timeline.selectedGraphTargetId).toBe(shape.id);
        expect((timeline as any).scrubbing).toBeTrue();
        timeline.animation.contextChanging.next();
        expect(timeline.selectedGraphTargetId).toBeUndefined();
        expect((timeline as any).scrubbing).toBeFalse(); timeline.ngOnDestroy();
    });

    it('continues playhead dragging across seek notifications and finishes at pointer release', fakeAsync(() => {
        const { timeline, shape } = setup();
        const pause = jasmine.createSpy('pause');
        timeline.animation.pause = pause;
        timeline.animation.seek = (time: number) => {
            timeline.animation.contextChanging.next('seek');
            timeline.animation.currentTime = time;
        };
        timeline.selectedGraphTargetId = shape.id;
        const commits = jasmine.createSpy('commit');
        timeline.animationChange.subscribe(commits);
        const ruler = document.createElement('div');
        spyOn(ruler, 'getBoundingClientRect').and.returnValue({ left: 100 } as DOMRect);
        const x = (time: number) => 100 + Number.parseFloat(timeline.keyframeLeft(time));
        timeline.beginScrub(pointerEvent(x(.25), ruler, 'pointerdown'));
        tick(17);
        expect(pause).toHaveBeenCalledTimes(1);
        expect(timeline.animation.currentTime).toBeCloseTo(.25);
        document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: x(.75) }));
        tick(17);
        expect(timeline.animation.currentTime).toBeCloseTo(.75);
        document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: x(1.25) }));
        expect(timeline.animation.currentTime).toBeCloseTo(1.25);
        document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: x(2) }));
        tick(17);
        expect(timeline.animation.currentTime).toBeCloseTo(1.25);
        expect(timeline.selectedGraphTargetId).toBe(shape.id);
        expect(commits).not.toHaveBeenCalled();
        timeline.ngOnDestroy();
    }));

    for(const interruption of ['pointercancel', 'lostpointercapture', 'blur']) {
        it(`stops pending playhead updates on ${interruption}`, fakeAsync(() => {
            const { timeline } = setup();
            timeline.animation.seek = jasmine.createSpy('seek');
            timeline.beginScrub(pointerEvent(100, document.createElement('div'), 'pointerdown'));
            if(interruption === 'blur') window.dispatchEvent(new Event('blur'));
            else document.dispatchEvent(new PointerEvent(interruption, { pointerId: 7 }));
            tick(17);
            expect(timeline.animation.seek).not.toHaveBeenCalled();
            expect((timeline as any).scrubbing).toBeFalse();
            timeline.ngOnDestroy();
        }));
    }

    it("reserves keyframe clipboard shortcuts for Animate mode and respects consumed events", () => {
        const { timeline } = setup();
        const copy = spyOn(timeline, 'copySelectedKeyframes').and.returnValue(true);
        timeline.animation.mode = 'edit';
        timeline.handleTimelineShortcut(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));
        expect(copy).not.toHaveBeenCalled();
        timeline.animation.mode = 'animate';
        const consumed = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true });
        consumed.preventDefault();
        timeline.handleTimelineShortcut(consumed);
        expect(copy).not.toHaveBeenCalled();
        const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true });
        timeline.handleTimelineShortcut(event);
        expect(copy).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBeTrue();
    });

    it("redraws selected keyframes during drag and snaps any one of them to the playhead", fakeAsync(() => {
        const { timeline, markForCheck, shape } = setup();
        const track: AnimationTrack = {
            id: "position", targetId: shape.id, property: "transform.translateX", valueType: "number",
            keyframes: [
                { id: "first", time: 1.125, value: 0 },
                { id: "middle", time: 2.25, value: 10 },
                { id: "last", time: 3.875, value: 20 },
            ],
        };
        timeline.editor.selectedSVG!.animation.tracks = [track];
        timeline.selectedKeyframeIds = new Set(track.keyframes.map((keyframe) => keyframe.id));
        (timeline.animation as { currentTime: number }).currentTime = 1;
        const capture = document.createElement("div");

        timeline.beginKeyframeDrag(track.keyframes[0], pointerEvent(0, capture));
        timeline.updateKeyframeDrag(pointerEvent(-12, capture));
        tick(20);

        expect(track.keyframes.map((keyframe) => keyframe.time)).toEqual([1, 2.125, 3.75]);
        expect(markForCheck).toHaveBeenCalled();
        timeline.endKeyframeDrag(pointerEvent(-12, capture, "pointerup"));
    }));

    it("summarizes descendant keyframes on a minified group row", () => {
        const { timeline, shape } = setup();
        const group = new Group(timeline.editor);
        group.elements = [shape];
        const svg = timeline.editor.selectedSVG!;
        svg.elements = [group];
        svg.animation.tracks = [{
            id: "child-track", targetId: shape.id, property: "opacity", valueType: "number",
            keyframes: [{ id: "child-key", time: 0.75, value: 0.5 }],
        }];

        const groupRow = timeline.rows.find((row) => row.type === "layer" && row.element === group)!;
        expect(timeline.keyframes(groupRow).map((keyframe) => keyframe.time)).toEqual([0.75]);
    });

    it("projects linked scale dimensions as one Scale row and one graph curve", () => {
        const { timeline, shape } = setup();
        const animation = timeline.editor.selectedSVG!.animation;
        animation.tracks = matchingScaleTracks(shape);
        timeline.expandedLayerIds.add(shape.id);

        const properties = timeline.rows
            .filter((row): row is PropertyTimelineRow => row.type === "property")
            .map((row) => row.property.property);
        expect(properties).toContain("transform.scale");
        expect(properties).not.toContain("transform.scaleX");
        expect(properties).not.toContain("transform.scaleY");

        timeline.selectTimelineRow(timeline.rows.find((row): row is PropertyTimelineRow => row.type === "property"
            && row.property.property === "transform.scale")!);
        expect(timeline.graphTracks().map((track) => track.label)).toEqual(["Scale"]);
        expect(timeline.graphTracks()[0].axis).toBe("scalar");
        timeline.selectGraphProperty(timeline.graphTracks()[0].track.property);
        expect(timeline.selectedGraphProperty).toBe("transform.scale");
        expect(timeline.graphTracks()).toHaveSize(1);
    });

    it("keys linked scale dimensions together until the row is split", () => {
        const { timeline, writes, shape } = setup();
        const row = scaleRow(shape, "transform.scaleX");

        timeline.toggleKey(row);
        expect(writes).toEqual(["transform.scaleX", "transform.scaleY"]);

        timeline.toggleScaleLinked(row, new MouseEvent("click"));
        writes.length = 0;
        timeline.toggleKey(row);
        expect(writes).toEqual(["transform.scaleX"]);
    });

    it("infers a persisted split from divergent scale track topology", () => {
        const { timeline, shape } = setup();
        const row = scaleRow(shape, "transform.scaleX");
        const animation = timeline.editor.selectedSVG!.animation;
        animation.tracks = [{
            id: "x", targetId: shape.id, property: "transform.scaleX", valueType: "number",
            keyframes: [{ id: "x0", time: 0, value: 1 }, { id: "x1", time: 1, value: 2 }],
        }];
        expect(timeline.scaleLinked(row)).toBeFalse();

        animation.tracks.push({
            id: "y", targetId: shape.id, property: "transform.scaleY", valueType: "number",
            keyframes: [{ id: "y0", time: 0, value: 1 }, { id: "y1", time: 1, value: 2 }],
        });
        expect(timeline.scaleLinked(row)).toBeTrue();

        animation.tracks[1].keyframes[1].value = 3;
        expect(timeline.scaleLinked(row)).toBeFalse();
    });

    it("mirrors numeric speed-graph edits across a uniform scale pair", () => {
        const { timeline, shape } = setup();
        const animation = timeline.editor.selectedSVG!.animation;
        animation.tracks = matchingScaleTracks(shape);
        timeline.expandedLayerIds.add(shape.id);
        const row = timeline.rows.find((candidate): candidate is PropertyTimelineRow => candidate.type === "property"
            && candidate.property.property === "transform.scale")!;
        timeline.selectTimelineRow(row);
        const handle = timeline.graphHandles(timeline.graphTracks()[0].track)[0];
        timeline.activeGraphHandle = handle;

        timeline.setActiveHandleValue("speed", 7);

        expect(animation.tracks[0].keyframes[0].temporal).toEqual(animation.tracks[1].keyframes[0].temporal);
        expect(animation.tracks[0].keyframes[0].temporal?.out?.speed).toBe(7);
    });

    it("routes Ease Out through the selected ending keyframe", () => {
        const { timeline, shape } = setup();
        const track: AnimationTrack = {
            id: "position", targetId: shape.id, property: "transform.translateX", valueType: "number" as const,
            keyframes: [{ id: "start", time: 0, value: 0 }, { id: "end", time: 1, value: 10 }],
        };
        timeline.editor.selectedSVG!.animation.tracks = [track];
        timeline.selectedKeyframeIds = new Set(["end"]);

        timeline.setSelectedEasing("ease-out");

        expect(track.keyframes[0].easing?.type).toBe("ease-out");
        expect(track.keyframes[1].temporal?.in?.speed).toBe(0);
        expect(timeline.selectedEasingType()).toBe("ease-out");
    });

    it("updates layer virtualization and graph time visibility independently", () => {
        const { timeline } = setup();
        timeline.visibleTimeStart = 4;
        timeline.visibleTimeEnd = 8;
        const layerViewport = document.createElement("div");
        Object.defineProperties(layerViewport, { scrollTop: { value: 300 }, clientHeight: { value: 180 } });
        timeline.updateLayerViewport({ currentTarget: layerViewport } as unknown as Event);
        expect(timeline.visibleTimeStart).toBe(4);
        expect(timeline.visibleTimeEnd).toBe(8);

        const virtualStart = timeline.virtualStart;
        const graphViewport = document.createElement("div");
        Object.defineProperties(graphViewport, {
            scrollLeft: { value: 240 },
            clientWidth: { value: 600 },
        });
        timeline.updateGraphViewport({ currentTarget: graphViewport } as unknown as Event);
        expect(timeline.virtualStart).toBe(virtualStart);
        expect(timeline.visibleTimeStart).toBeGreaterThan(0);
    });

    it("renders ordinary expanded scenes without virtual spacer churn", () => {
        const { timeline } = setupWithLayerCount(100);
        const viewport = document.createElement("div");
        Object.defineProperties(viewport, {
            scrollTop: { value: 900 },
            scrollLeft: { value: 0 },
            clientHeight: { value: 300 },
            clientWidth: { value: 800 },
        });

        timeline.updateTimelineViewport({ currentTarget: viewport } as unknown as Event);

        expect(timeline.visibleRows).toHaveSize(100);
        expect(timeline.virtualTopHeight).toBe(0);
        expect(timeline.virtualBottomHeight).toBe(0);
    });

    it("keeps a large virtual window and its spacers stable at the bottom", () => {
        const { timeline } = setupWithLayerCount(150);
        const viewport = document.createElement("div");
        Object.defineProperties(viewport, {
            scrollTop: { value: 5000 },
            scrollLeft: { value: 0 },
            clientHeight: { value: 1200 },
            clientWidth: { value: 800 },
        });

        timeline.updateTimelineViewport({ currentTarget: viewport } as unknown as Event);
        const first = [timeline.virtualStart, timeline.visibleRows.length, timeline.virtualTopHeight, timeline.virtualBottomHeight];
        timeline.updateTimelineViewport({ currentTarget: viewport } as unknown as Event);

        expect([timeline.virtualStart, timeline.visibleRows.length, timeline.virtualTopHeight, timeline.virtualBottomHeight]).toEqual(first);
        expect(timeline.virtualStart + timeline.visibleRows.length).toBe(150);
        expect(timeline.virtualBottomHeight).toBe(0);
    });

    it("adds filler only when the timeline rows are shorter than the viewport", () => {
        const { timeline } = setupWithLayerCount(1);
        expect(timeline.overscrollHeight).toBeGreaterThan(0);

        timeline.editor.selectedSVG!.elements = setupShapes(timeline.editor, 20);
        expect(timeline.overscrollHeight).toBe(0);
    });
});

describe('Speed graph interaction regressions', () => {
    function scenario() {
        const result = setup();
        const track: AnimationTrack = { id: 'audit-x', targetId: result.shape.id,
            property: 'transform.translateX', valueType: 'number', keyframes: [
                { id: 'a', time: 0, value: 0, easing: { type: 'ease-in' } },
                { id: 'b', time: 1, value: 10 },
                { id: 'c', time: 2, value: 30 },
            ] };
        result.timeline.editor.selectedSVG!.animation.tracks = [track];
        result.timeline.selectedGraphTargetId = result.shape.id;
        result.timeline.selectedGraphProperty = track.property;
        const surface = document.createElement('div'); surface.className = 'speed-graph-surface';
        return { ...result, track, surface };
    }
    function event(surface: HTMLElement, x = 0, y = 0, altKey = false): PointerEvent {
        return { ...pointerEvent(x, surface), clientY: y, altKey } as PointerEvent;
    }
    it('previews both seam speeds and restores both after Escape', fakeAsync(() => {
        const {timeline,track,surface}=scenario(); linkLoopSeam(track,0,2,'start',true);
        const before=JSON.stringify(track);
        timeline.beginGraphHandleDrag(timeline.graphHandles(track)[0],event(surface));
        timeline.updateGraphHandleDrag(event(surface,8,-20)); tick(20);
        expect(track.keyframes[2].temporal!.in!.speed).toBe(track.keyframes[0].temporal!.out!.speed);
        expect(JSON.stringify(track)).not.toBe(before);
        timeline.handleTimelineShortcut(new KeyboardEvent('keydown',{key:'Escape'}));
        expect(JSON.stringify(track)).toBe(before); timeline.ngOnDestroy();
    }));
    it('protects linked boundary timing while allowing ordinary interior retiming', fakeAsync(() => {
        const {timeline,track,surface}=scenario(); linkLoopSeam(track,0,2,'start',false);
        timeline.beginKeyframeDrag(track.keyframes[0],event(surface));
        timeline.updateKeyframeDrag(event(surface,60)); tick(20); timeline.endKeyframeDrag(event(surface,60));
        expect(track.keyframes[0].time).toBe(0); expect(timeline.animation.contextMessage).toContain('Unlink');
        timeline.beginKeyframeDrag(track.keyframes[1],event(surface));
        timeline.updateKeyframeDrag(event(surface,60)); tick(20); timeline.endKeyframeDrag(event(surface,60));
        expect(track.keyframes[1].time).toBe(1.5); timeline.ngOnDestroy();
    }));
    it('clicking without dragging preserves all tangents and evaluated motion', () => {
        const {timeline,track,surface}=scenario();
        const before=evaluateTrack(track,.5);
        const commit=spyOn(timeline.animationChange,'emit');
        timeline.beginGraphHandleDrag(timeline.graphHandles(track)[0],event(surface));
        timeline.endGraphHandleDrag(event(surface));
        expect(track.keyframes[0].temporal).toBeUndefined();
        expect(track.keyframes[1].temporal).toBeUndefined();
        expect(evaluateTrack(track,.5)).toEqual(before);
        expect(commit).not.toHaveBeenCalled();
        timeline.ngOnDestroy();
    });
    it('Escape restores the complete segment', fakeAsync(() => {
        const {timeline,track,surface}=scenario(); const before=JSON.stringify(track);
        timeline.beginGraphHandleDrag(timeline.graphHandles(track)[0],event(surface));
        timeline.updateGraphHandleDrag(event(surface,10,-20)); tick(20);
        timeline.handleTimelineShortcut(new KeyboardEvent('keydown',{key:'Escape'}));
        expect(JSON.stringify(track)).toBe(before);
        expect(track.keyframes[1].temporal).toBeUndefined();
        timeline.ngOnDestroy();
    }));
    it('Alt keeps the opposite tangent independent throughout the drag', fakeAsync(() => {
        const {timeline,track,surface}=scenario();
        track.keyframes[1].temporal={linked:true,in:{speed:5,influence:.3},out:{speed:5,influence:.3}};
        const handle=timeline.graphHandles(track).find(h=>h.keyframe.id==='b' && h.side==='out')!;
        timeline.beginGraphHandleDrag(handle,event(surface,0,0,true));
        timeline.updateGraphHandleDrag(event(surface,0,-20,true)); tick(20);
        expect(track.keyframes[1].temporal!.linked).toBeFalse();
        expect(track.keyframes[1].temporal!.in!.speed).not.toBe(track.keyframes[1].temporal!.out!.speed);
        expect(track.keyframes[1].temporal!.in!.speed).toBe(5);
        timeline.endGraphHandleDrag(event(surface)); timeline.ngOnDestroy();
    }));
    it('browser pointer cancellation restores without committing', fakeAsync(() => {
        const {timeline,track,surface}=scenario(); const commit=spyOn(timeline.animationChange,'emit');
        timeline.beginGraphHandleDrag(timeline.graphHandles(track)[0],event(surface));
        timeline.updateGraphHandleDrag(event(surface,0,-20)); tick(20);
        document.dispatchEvent(new PointerEvent('pointercancel',{pointerId:7}));
        expect(commit).not.toHaveBeenCalled();
        timeline.ngOnDestroy();
    }));
    it('window blur cancels the handle gesture', fakeAsync(() => {
        const {timeline,track,surface}=scenario();
        timeline.beginGraphHandleDrag(timeline.graphHandles(track)[0],event(surface));
        timeline.updateGraphHandleDrag(event(surface,0,-20)); tick(20);
        window.dispatchEvent(new Event('blur'));
        expect((timeline as any).graphDrag).toBeUndefined();
        timeline.handleTimelineShortcut(new KeyboardEvent('keydown',{key:'Escape'})); timeline.ngOnDestroy();
    }));
    it('changing the displayed property clears the numeric handle target', () => {
        const {timeline,track,surface}=scenario();
        const rotation: AnimationTrack={...structuredClone(track),id:'rotation',property:'transform.rotation'};
        timeline.editor.selectedSVG!.animation.tracks.push(rotation);
        timeline.beginGraphHandleDrag(timeline.graphHandles(track)[0],event(surface));
        timeline.endGraphHandleDrag(event(surface));
        timeline.selectGraphProperty(rotation.property);
        expect(timeline.graphTracks().map(item=>item.track.id)).toEqual(['rotation']);
        timeline.setActiveHandleValue('speed',99);
        expect(track.keyframes[0].temporal).toBeUndefined();
        expect(rotation.keyframes[0].temporal).toBeUndefined();
        timeline.ngOnDestroy();
    });
    it('history clears handles referencing replaced tracks', () => {
        const {timeline,track,surface}=scenario();
        timeline.beginGraphHandleDrag(timeline.graphHandles(track)[0],event(surface));
        timeline.endGraphHandleDrag(event(surface));
        const restored=structuredClone(track);
        timeline.editor.selectedSVG!.animation.tracks=[restored];
        (timeline as any).mutations.historyRestored.emit();
        timeline.setActiveHandleValue('speed',99);
        expect(track.keyframes[0].temporal).toBeUndefined();
        expect(restored.keyframes[0].temporal).toBeUndefined();
        timeline.ngOnDestroy();
    });
    it('Hold draws zero speed consistently with evaluation', () => {
        const {timeline,track}=scenario();
        applyEasingPresetToKeyframe(track,track.keyframes[0],'hold');
        expect(evaluateTrack(track,.4)).toBe(0);
        expect(evaluateTrack(track,.6)).toBe(0);
        expect((timeline as any).segmentSpeed(track.keyframes[0],track.keyframes[1],.5)).toBe(0);
        timeline.ngOnDestroy();
    });
    it('a time-domain change refreshes curve coordinates with their roots', () => {
        const {timeline,track}=scenario();
        const path=timeline.speedCurvePath(track);
        const x=timeline.graphKeyX(timeline.graphHandles(track)[0]);
        timeline.editor.selectedSVG!.animation.tracks.push({id:'negative',targetId:'other',property:'opacity',valueType:'number',keyframes:[{id:'neg',time:-1,value:1}]});
        (timeline.animation as any).revision++;
        expect(timeline.graphKeyX(timeline.graphHandles(track)[0])).toBeGreaterThan(x);
        expect(timeline.speedCurvePath(track)).not.toBe(path);
        (timeline as any).speedCurveCache.clear();
        expect(timeline.speedCurvePath(track)).not.toBe(path);
        timeline.ngOnDestroy();
    });
});

function setupWithLayerCount(count: number): ReturnType<typeof setup> {
    const result = setup();
    result.timeline.editor.selectedSVG!.elements = setupShapes(result.timeline.editor, count);
    return result;
}

function setupShapes(editor: EditorService, count: number): Shape[] {
    return Array.from({ length: count }, (_unused, index) => new Shape(editor, {
        type: "rectangle",
        position: new Point(index, index),
    }));
}

function setup(): { timeline: TimelineEditorService; writes: string[]; shape: Shape; markForCheck: jasmine.Spy } {
    const editor = { get ID() { return Math.random().toString(36); } } as EditorService;
    const shape = new Shape(editor, { type: "rectangle", position: new Point(0, 0) });
    const svg = new SVG(editor, { width: 100, height: 100, pos: new Point(0, 0) });
    svg.elements = [shape];
    editor.selectedSVG = svg;
    editor.selectedElement = shape;
    const writes: string[] = [];
    const animation = {
        contextChanging: new EventEmitter<'seek' | 'playback' | void>(),
        currentTime: 0,
        duration: 2,
        mode: "animate",
        revision: 0,
        trackFor: (element: Shape, property: string) => svg.animation.tracks.find((track) => track.targetId === element.id && track.property === property),
        tracksForElement: (element: Shape) => svg.animation.tracks.filter((track) => track.targetId === element.id),
        hasKeyframeAtCurrentTime: () => false,
        upsertKeyframe: (_element: Shape, property: string) => writes.push(property),
        removeKeyframeAtCurrentTime: () => undefined,
        invalidate: () => undefined,
        previewAt: () => [],
    } as unknown as AnimationPlaybackService;
    const mutations = { historyRestored: new EventEmitter<void>() } as unknown as DocumentMutationService;
    const zone = { runOutsideAngular: (callback: () => unknown) => callback(), run: (callback: () => unknown) => callback() } as NgZone;
    const markForCheck = jasmine.createSpy("markForCheck");
    const timeline = new TimelineEditorService(
        editor,
        animation,
        new ElementRef(document.createElement("div")),
        { timelineHeight: 310 } as EditorPreferencesService,
        new TimelineEditingService(),
        zone,
        mutations,
        { markForCheck } as unknown as ChangeDetectorRef,
        {} as PaintEditingService,
    );
    return { timeline, writes, shape, markForCheck };
}

function pointerEvent(clientX: number, currentTarget: HTMLElement, type = "pointermove"): PointerEvent {
    return {
        button: 0,
        clientX,
        currentTarget,
        pointerId: 7,
        shiftKey: false,
        type,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
    } as unknown as PointerEvent;
}

function scaleRow(shape: Shape, property: "transform.scaleX" | "transform.scaleY"): PropertyTimelineRow {
    return {
        type: "property",
        element: shape,
        depth: 1,
        property: ANIMATABLE_PROPERTIES.find((candidate) => candidate.property === property)!,
    };
}

function matchingScaleTracks(shape: Shape) {
    return (["transform.scaleX", "transform.scaleY"] as const).map((property, axis) => ({
        id: axis === 0 ? "x" : "y",
        targetId: shape.id,
        property,
        valueType: "number" as const,
        keyframes: [
            { id: `${axis}-0`, time: 0, value: 1 },
            { id: `${axis}-1`, time: 1, value: 2 },
        ],
    }));
}
