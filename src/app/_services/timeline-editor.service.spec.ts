import { ChangeDetectorRef, ElementRef, EventEmitter, NgZone } from "@angular/core";
import { AnimationPlaybackService } from "./animation-playback.service";
import { DocumentMutationService } from "./document-mutation.service";
import { EditorPreferencesService } from "./editor-preferences.service";
import { EditorService } from "./editor.service";
import { PaintEditingService } from "./paint-editing.service";
import { TimelineEditingService, PropertyTimelineRow } from "./timeline-editing.service";
import { TimelineEditorService } from "./timeline-editor.service";
import { ANIMATABLE_PROPERTIES } from "../editor/objects/animation.object";
import { Shape } from "../editor/objects/elements/shape.object";
import { Group } from "../editor/objects/elements/group.object";
import { Point } from "../editor/objects/point.object";
import { SVG } from "../editor/objects/svg.object";

describe("TimelineEditorService scale and viewport policy", () => {
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

function setup(): { timeline: TimelineEditorService; writes: string[]; shape: Shape } {
    const editor = { get ID() { return Math.random().toString(36); } } as EditorService;
    const shape = new Shape(editor, { type: "rectangle", position: new Point(0, 0) });
    const svg = new SVG(editor, { width: 100, height: 100, pos: new Point(0, 0) });
    svg.elements = [shape];
    editor.selectedSVG = svg;
    editor.selectedElement = shape;
    const writes: string[] = [];
    const animation = {
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
    const timeline = new TimelineEditorService(
        editor,
        animation,
        new ElementRef(document.createElement("div")),
        { timelineHeight: 310 } as EditorPreferencesService,
        new TimelineEditingService(),
        zone,
        mutations,
        { markForCheck: () => undefined } as unknown as ChangeDetectorRef,
        {} as PaintEditingService,
    );
    return { timeline, writes, shape };
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
