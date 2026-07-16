import { EditorService } from "../_services/editor.service";
import { AnimationPlaybackService } from "../_services/animation-playback.service";
import { DocumentMutationService } from "../_services/document-mutation.service";
import { ElementFactory } from "../_services/element-factory.service";
import { HistoryService } from "../_services/history.service";
import { LayerOperationsService } from "../_services/layer-operations.service";
import { ProjectService } from "../_services/project.service";
import { createDefaultAnimation, evaluateTrack } from "./objects/animation.object";
import { matchingAnimationProperty, pathPointAnimationProperty } from "./objects/animation-targets";
import { Color } from "./objects/color.object";
import { Group } from "./objects/elements/group.object";
import { Path } from "./objects/elements/path.object";
import { Shape } from "./objects/elements/shape.object";
import { TextElement } from "./objects/elements/text.object";
import { Line } from "./objects/line.object";
import { Point } from "./objects/point.object";
import { canConvertStrokeToPath, convertStrokeToPath } from "./objects/stroke-outline.object";
import { SVG } from "./objects/svg.object";
import { buildSVGMarkup } from "./svg-markup";
import { deletePathAnchor, insertPathPoint, togglePathLineType } from "../_services/tools/path-edit.helpers";
import { snapTimelineTime, TimelineEditingService, timelineTimeToX, timelineXToTime } from "../_services/timeline-editing.service";
import { createDefaultGradient, isGradientPaint, paintSVGValue } from "./objects/paint.object";
import { dashedPathContours } from "./objects/stroke-dash.object";

function editorDouble(): EditorService {
    let id = 0;
    return {
        get ID() {
            id += 1;
            return `id-${id}`;
        },
        removeElement: () => undefined,
    } as unknown as EditorService;
}

function line(editor: EditorService, start: Point, end: Point): Line {
    return new Line(editor, { type: "line", points: [start, end] });
}

function documentWithPath(): { editor: EditorService; svg: SVG; path: Path } {
    const editor = editorDouble();
    const svg = new SVG(editor, {
        width: 100,
        height: 80,
        name: "Characterization",
        pos: new Point(0, 0),
    });
    const path = new Path(editor);
    const start = new Point(0, 0);
    const middle = new Point(10, 0);
    const end = new Point(10, 10);
    path.lines = [line(editor, start, middle), line(editor, middle, end)];
    svg.elements = [path];
    return { editor, svg, path };
}

describe("editor model characterization", () => {
    it("round-trips the current save schema without changing IDs or values", () => {
        const { editor, svg, path } = documentWithPath();
        path.name = "Saved path";
        path.closed = true;
        path.settings.fill_enabled = true;
        path.settings.fill = new Color("#123456");
        path.transform.rotation = 17;
        svg.guides = [{ id: "guide-1", axis: "x", value: 12.34567 }];
        svg.guidesLocked = true;

        const save = svg.save();
        const restored = SVG.fromSave(save, editor);

        expect(restored.save()).toEqual(save);
        expect(restored.id).toBe(svg.id);
    });

    it("round-trips, duplicates, and exports text gradient paint", () => {
        const editor = editorDouble();
        const svg = new SVG(editor, {
            width: 160,
            height: 60,
            name: "Text gradient",
            pos: new Point(0, 0),
        });
        const text = new TextElement(editor, new Point(8, 10));
        text.settings.content = "Gradient";
        text.settings.color = createDefaultGradient("text-gradient");
        svg.elements = [text];

        const restored = SVG.fromSave(svg.save(), editor);
        const restoredText = restored.elements[0] as TextElement;
        const duplicate = new ElementFactory(editor).clone(text) as TextElement;
        const markup = buildSVGMarkup(restored);

        expect(isGradientPaint(restoredText.settings.color)).toBeTrue();
        expect(isGradientPaint(duplicate.settings.color)).toBeTrue();
        expect((duplicate.settings.color as ReturnType<typeof createDefaultGradient>).id).not.toBe("text-gradient");
        expect(markup).toContain('<linearGradient id="text-gradient"');
        expect(markup).toContain('fill="url(#text-gradient)"');
    });

    it("restores shared path endpoints by object identity", () => {
        const { editor, svg } = documentWithPath();
        const restored = SVG.fromSave(svg.save(), editor);
        const path = restored.elements[0] as Path;

        expect(path.lines[0].points[1]).toBe(path.lines[1].points[0]);
    });

    it("preserves compound contours and their close state", () => {
        const { editor, svg, path } = documentWithPath();
        const a = new Point(20, 20);
        const b = new Point(30, 20);
        path.contours.push(path.createContour([line(editor, a, b)], false));
        path.closed = true;

        const restored = SVG.fromSave(svg.save(), editor);
        const restoredPath = restored.elements[0] as Path;

        expect(restoredPath.contours.length).toBe(2);
        expect(restoredPath.contours.map((contour) => contour.closed)).toEqual([true, false]);
        expect(restoredPath.raw).toContain("Z");
        expect(restoredPath.raw.match(/M /g)?.length).toBe(2);
    });

    it("generates stable line, cubic, rounded-corner, and close geometry", () => {
        const editor = editorDouble();
        const path = new Path(editor);
        const a = new Point(0, 0);
        const b = new Point(20, 0);
        const c = new Point(20, 20);
        b.cornerRadius = 4;
        path.lines = [
            line(editor, a, b),
            new Line(editor, {
                type: "bezier",
                points: [b, c],
                controlStart: new Point(20, 5),
                controlEnd: new Point(20, 15),
            }),
        ];
        path.closed = true;

        expect(path.rawUnrounded).toBe("M  0 0 L 20 0 C 20 5 20 15 20 20 Z");
        expect(path.rawUnrounded).toContain("C 20 5 20 15 20 20");
        expect(path.rawUnrounded.trim().endsWith("Z")).toBeTrue();
        expect(path.raw).not.toBe(path.rawUnrounded);
    });

    it("evaluates animation tracks with the existing interpolation and hold rules", () => {
        expect(evaluateTrack({
            id: "track",
            targetId: "element",
            property: "opacity",
            valueType: "number",
            keyframes: [
                { id: "a", time: 0, value: 0 },
                { id: "b", time: 2, value: 10 },
            ],
        }, 1)).toBe(5);

        expect(evaluateTrack({
            id: "track",
            targetId: "element",
            property: "visible",
            valueType: "boolean",
            keyframes: [
                { id: "a", time: 0, value: false, easing: { type: "hold" } },
                { id: "b", time: 1, value: true },
            ],
        }, 0.75)).toBeFalse();
    });

    it("exports sanitized XML text, transforms, groups, and clipping markup", () => {
        const { editor, svg, path } = documentWithPath();
        (path as any).id = "path-id";
        path.transform.translateX = 3;
        const mask = new Shape(editor, { type: "rectangle", position: new Point(0, 0), width: 5, height: 5 });
        (mask as any).id = "mask-id";
        const group = new Group(editor);
        (group as any).id = "group-id";
        group.elements = [path, mask];
        group.clipElementId = mask.id;
        svg.elements = [group];

        const markup = buildSVGMarkup(svg);

        expect(markup).toContain('<clipPath id="clip-group-id">');
        expect(markup).toContain('clip-path="url(#clip-group-id)"');
        expect(markup).toContain('transform="matrix(1 0 0 1 3 0)"');
        expect(markup.match(/id="mask-id"/g)?.length).toBe(1);
    });

    it("records only changed snapshots and restores elements and animation", () => {
        const { svg, path } = documentWithPath();
        svg.snapshot();
        svg.snapshot();
        expect(svg.canUndo).toBeTrue();

        path.opacity = 0.25;
        svg.animation.duration = 7;
        svg.snapshot();
        svg.undo();

        expect((svg.elements[0] as Path).opacity).toBe(1);
        expect(svg.animation.duration).toBe(3);
        expect(svg.canRedo).toBeTrue();

        svg.redo();
        expect((svg.elements[0] as Path).opacity).toBe(0.25);
        expect(svg.animation.duration).toBe(7);
    });

    it("converts a stroked path into closed fill geometry", () => {
        const { editor, path } = documentWithPath();
        path.settings.stroke = new Color("#abcdef");
        path.settings.stroke_width = 8;
        path.settings.line_cap = "round";

        expect(canConvertStrokeToPath(path)).toBeTrue();
        const outline = convertStrokeToPath(path, editor, "precise");

        expect(outline).not.toBeNull();
        expect(paintSVGValue(outline!.settings.fill)).toBe("#abcdef");
        expect(outline!.settings.stroke).toBeNull();
        expect(outline!.settings.stroke_width).toBe(0);
        expect(outline!.contours.every((contour) => contour.closed)).toBeTrue();
    });

    it("exports authored dashes and portable inside alignment", () => {
        const { svg, path } = documentWithPath();
        path.closed = true;
        path.settings.stroke_width = 6;
        path.settings.stroke_alignment = "inside";
        path.settings.stroke_dasharray = [8, 4, 2, 4];
        path.settings.stroke_dashoffset = 3;
        path.settings.stroke_miterlimit = 7;

        const markup = buildSVGMarkup(svg);

        expect(markup).toContain(`<clipPath id="stroke-inside-${path.id}">`);
        expect(markup).toContain('stroke-width="12"');
        expect(markup).toContain('stroke-dasharray="8 4 2 4"');
        expect(markup).toContain('stroke-dashoffset="3"');
        expect(markup).toContain('stroke-miterlimit="7"');
        expect(new DOMParser().parseFromString(markup, "image/svg+xml").querySelector("parsererror")).toBeNull();
    });

    it("converts dashed and aligned strokes into fill-only geometry", () => {
        const { editor, path } = documentWithPath();
        path.closed = true;
        path.settings.stroke = new Color("#2468ac");
        path.settings.stroke_width = 4;
        path.settings.stroke_alignment = "outside";
        path.settings.stroke_dasharray = [5, 3];
        path.settings.stroke_dashoffset = -2;
        path.settings.line_cap = "round";

        expect(dashedPathContours(path, editor).length).toBeGreaterThan(0);

        path.settings.stroke_alignment = "center";
        const dashedOutline = convertStrokeToPath(path, editor, "optimized");
        expect(dashedOutline).not.toBeNull();

        path.settings.stroke_alignment = "outside";
        path.settings.stroke_dasharray = [];
        const outline = convertStrokeToPath(path, editor, "optimized");

        expect(outline).not.toBeNull();
        expect(outline!.settings.fill_enabled).toBeTrue();
        expect(outline!.settings.stroke).toBeNull();
        expect(outline!.settings.stroke_dasharray).toEqual([]);
        expect(outline!.settings.stroke_alignment).toBe("center");
        expect(outline!.contours.every((contour) => contour.closed)).toBeTrue();

        path.settings.stroke_dasharray = [5, 3];
        path.settings.stroke_alignment = "inside";
        path.settings.line_cap = "butt";
        const dashedAligned = convertStrokeToPath(path, editor, "optimized");
        expect(dashedAligned).not.toBeNull();
        expect(dashedAligned!.settings.stroke_dasharray).toEqual([]);
        const anchors = dashedAligned!.contours.flatMap((contour) => contour.lines.flatMap((line) => line.points));
        expect(Math.min(...anchors.map((point) => point.x))).toBeGreaterThanOrEqual(-0.001);
        expect(Math.max(...anchors.map((point) => point.x))).toBeLessThanOrEqual(10.001);
        expect(Math.min(...anchors.map((point) => point.y))).toBeGreaterThanOrEqual(-0.001);
        expect(Math.max(...anchors.map((point) => point.y))).toBeLessThanOrEqual(10.001);
    });
});

describe("editor topology boundaries", () => {
    it("clones compound groups without sharing mutable geometry and remaps clipping IDs", () => {
        const editor = editorDouble();
        const factory = new ElementFactory(editor);
        const path = new Path(editor);
        const shared = new Point(10, 0);
        path.lines = [
            line(editor, new Point(0, 0), shared),
            line(editor, shared, new Point(10, 10)),
        ];
        const group = new Group(editor);
        group.elements = [path];
        group.clipElementId = path.id;

        const clone = factory.clone(group) as Group;
        const clonedPath = clone.elements[0] as Path;

        expect(clone.id).not.toBe(group.id);
        expect(clone.clipElementId).toBe(clonedPath.id);
        expect(clonedPath.lines[0].points[1]).toBe(clonedPath.lines[1].points[0]);
        expect(clonedPath.lines[0].points[1]).not.toBe(shared);
    });

    it("performs grouping, ordering, duplication, clipping, and motion attachment outside the page", () => {
        const editor = editorDouble();
        const svg = new SVG(editor, { width: 100, height: 100, pos: new Point(0, 0) });
        (editor as any).selectedSVG = svg;
        const first = new Shape(editor, { type: "rectangle", position: new Point(0, 0) });
        const second = new Shape(editor, { type: "ellipse", position: new Point(20, 20) });
        const motionPath = new Path(editor);
        svg.elements = [first, second, motionPath];
        const operations = new LayerOperationsService(editor, new ElementFactory(editor));

        expect(operations.moveBackward(second)).toBeTrue();
        expect(svg.elements).toEqual([second, first, motionPath]);
        const duplicate = operations.duplicate(first)!;
        expect(svg.elements).toEqual([second, first, duplicate, motionPath]);
        const group = operations.group([second, first])!;
        expect(group.elements).toEqual([second, first]);
        expect(svg.elements[0]).toBe(group);
        expect(operations.useAsClippingMask(first)).toBeTrue();
        expect(group.clipElementId).toBe(first.id);
        expect(operations.attachMotionPath(duplicate, motionPath)).toBeTrue();
        expect(duplicate.motion.pathId).toBe(motionPath.id);
    });

    it("duplicates group and child tracks with remapped path-point and gradient-stop IDs", () => {
        const { editor, svg, path } = documentWithPath();
        (editor as any).selectedSVG = svg;
        const group = new Group(editor);
        group.elements = [path];
        svg.elements = [group];
        const point = path.pathPoints()[0];
        const gradient = createDefaultGradient(editor.ID);
        path.settings.fill = gradient;
        svg.animation.tracks = [
            {
                id: "group-track",
                targetId: group.id,
                property: "opacity",
                valueType: "number",
                keyframes: [{ id: "group-key", time: 0, value: 0.8 }],
            },
            {
                id: "opacity-track",
                targetId: path.id,
                property: "opacity",
                valueType: "number",
                keyframes: [{ id: "opacity-key", time: 0.5, value: 0.4, easing: { type: "ease-in" } }],
            },
            {
                id: "position-track",
                targetId: path.id,
                property: "geometry.x",
                valueType: "number",
                keyframes: [
                    { id: "position-key", time: 0, value: 12, temporal: { linked: false, out: { speed: 18, influence: 0.42 } } },
                    { id: "position-key-2", time: 1, value: 42, temporal: { linked: false, in: { speed: 7, influence: 0.31 } } },
                ],
            },
            {
                id: "point-track",
                targetId: path.id,
                property: pathPointAnimationProperty(point.id, "x"),
                valueType: "number",
                keyframes: [{ id: "point-key", time: 1, value: 12 }],
            },
            {
                id: "stop-track",
                targetId: path.id,
                property: `settings.fill.gradient.stops.${gradient.stops[0].id}.offset`,
                valueType: "number",
                keyframes: [{ id: "stop-key", time: 1.5, value: 0.2 }],
            },
        ];

        const duplicateGroup = new LayerOperationsService(editor, new ElementFactory(editor)).duplicate(group) as Group;
        const duplicate = duplicateGroup.elements[0] as Path;
        const duplicateTracks = svg.animation.tracks.filter((track) => track.targetId === duplicate.id);
        const duplicateGradient = duplicate.settings.fill as typeof gradient;

        expect(duplicateTracks.length).toBe(4);
        expect(svg.animation.tracks.some((track) => track.targetId === duplicateGroup.id && track.property === "opacity")).toBeTrue();
        expect(duplicateTracks.map((track) => track.id)).not.toContain("opacity-track");
        expect(duplicateTracks.flatMap((track) => track.keyframes.map((keyframe) => keyframe.id)))
            .not.toContain("opacity-key");
        expect(duplicateTracks.some((track) => track.property === "opacity")).toBeTrue();
        expect(duplicateTracks.find((track) => track.property === "geometry.x")?.keyframes.map((keyframe) => keyframe.value)).toEqual([12, 42]);
        expect(duplicateTracks.find((track) => track.property === "geometry.x")?.keyframes.map((keyframe) => keyframe.temporal)).toEqual([
            { linked: false, out: { speed: 18, influence: 0.42 } },
            { linked: false, in: { speed: 7, influence: 0.31 } },
        ]);
        expect(duplicateTracks.some((track) => track.property === pathPointAnimationProperty(duplicate.pathPoints()[0].id, "x"))).toBeTrue();
        expect(duplicateTracks.some((track) => track.property === `settings.fill.gradient.stops.${duplicateGradient.stops[0].id}.offset`)).toBeTrue();
        expect(duplicateTracks.find((track) => track.property === "opacity")!.keyframes[0].easing).toEqual({ type: "ease-in" });
    });

    it("creates one history snapshot and autosave for a change and neither for a no-op", () => {
        const { editor, svg, path } = documentWithPath();
        (editor as any).selectedSVG = svg;
        (editor as any).selectedPathLines = [];
        const animation = {
            withBaseState: <T>(callback: () => T) => callback(),
        } as AnimationPlaybackService;
        const history = new HistoryService();
        const projects = {
            upsert: jasmine.createSpy("upsert"),
        } as unknown as ProjectService;
        spyOn(history, "snapshot").and.callThrough();
        const mutations = new DocumentMutationService(editor, animation, history, projects);
        let historyRestores = 0;
        mutations.historyRestored.subscribe(() => historyRestores++);
        mutations.resetBaseline();

        mutations.mutate(() => { path.opacity = 0.5; });
        expect(history.snapshot).toHaveBeenCalledTimes(1);
        expect(projects.upsert).toHaveBeenCalledTimes(1);

        mutations.mutate(() => undefined);
        expect(history.snapshot).toHaveBeenCalledTimes(1);
        expect(projects.upsert).toHaveBeenCalledTimes(1);

        mutations.undo();
        expect(historyRestores).toBe(1);
        mutations.redo();
        expect(historyRestores).toBe(2);
    });

    it("edits path topology through pure helpers while preserving shared endpoints", () => {
        const editor = editorDouble();
        const path = new Path(editor);
        const start = new Point(0, 0);
        const end = new Point(12, 0);
        const segment = line(editor, start, end);
        path.lines = [segment];
        const createLine = (options: ConstructorParameters<typeof Line>[1]) => new Line(editor, options);

        expect(togglePathLineType(segment)).toBeTrue();
        const inserted = insertPathPoint(path, segment, createLine, new Point(6, 0));
        expect(inserted.changed).toBeTrue();
        expect(path.lines.length).toBe(2);
        expect(path.lines[0].points[1]).toBe(path.lines[1].points[0]);

        const third = new Point(18, 0);
        path.lines.push(line(editor, end, third));
        const removed = deletePathAnchor(path, end, createLine);
        expect(removed.changed).toBeTrue();
        expect(path.lines.length).toBe(2);
    });

    it("centralizes timeline math, clipboard, selection, paste, and delete behavior", () => {
        const editing = new TimelineEditingService();
        const animation = createDefaultAnimation();
        animation.duration = 2;
        animation.tracks = [{
            id: "track",
            targetId: "shape",
            property: "opacity",
            valueType: "number",
            keyframes: [{ id: "key", time: 0.5, value: 0.25, easing: { type: "linear" } }],
        }];
        editing.selectedKeyframeIds.add("key");

        expect(editing.copy(animation.tracks)).toBeTrue();
        expect(editing.paste(animation, 1.25)).toBeTrue();
        expect(animation.tracks[0].keyframes.map((keyframe) => keyframe.time)).toEqual([0.5, 1.25]);
        expect(editing.delete(animation)).toBeTrue();
        expect(animation.tracks[0].keyframes.map((keyframe) => keyframe.time)).toEqual([0.5]);
        expect(timelineTimeToX(1, 20, 100)).toBe(120);
        expect(timelineXToTime(120, 20, 100)).toBe(1);
        expect(snapTimelineTime(3, 2)).toBe(3);
    });

    it("pastes copied keyframes onto matching properties of a newly selected layer", () => {
        const editing = new TimelineEditingService();
        const editor = editorDouble();
        const source = new Path(editor);
        const destination = new Shape(editor, { type: "rectangle", position: new Point(0, 0) });
        const animation = createDefaultAnimation();
        animation.tracks = [
            {
                id: "opacity-track",
                targetId: source.id,
                property: "opacity",
                valueType: "number",
                keyframes: [{ id: "opacity-key", time: 0.25, value: 0.5 }],
            },
            {
                id: "path-track",
                targetId: source.id,
                property: "path.drawProgress",
                valueType: "number",
                keyframes: [{ id: "path-key", time: 0.5, value: 0.75 }],
            },
        ];
        editing.selectedKeyframeIds = new Set(["opacity-key", "path-key"]);

        expect(editing.copy(animation.tracks)).toBeTrue();
        expect(editing.paste(
            animation,
            1,
            destination,
            (element, property) => matchingAnimationProperty(source, element, property),
        )).toBeTrue();

        const destinationTracks = animation.tracks.filter((track) => track.targetId === destination.id);
        expect(destinationTracks.length).toBe(1);
        expect(destinationTracks[0].property).toBe("opacity");
        expect(destinationTracks[0].keyframes.map((keyframe) => keyframe.time)).toEqual([1]);
        expect(animation.tracks.find((track) => track.id === "path-track")!.keyframes.length).toBe(1);
    });

    it("matches generated path-point and gradient-stop properties by structural position", () => {
        const { editor, path: source } = documentWithPath();
        const gradient = createDefaultGradient(editor.ID);
        source.settings.fill = gradient;
        const destination = new ElementFactory(editor).clone(source) as Path;

        expect(matchingAnimationProperty(
            source,
            destination,
            pathPointAnimationProperty(source.pathPoints()[1].id, "y"),
        )).toBe(pathPointAnimationProperty(destination.pathPoints()[1].id, "y"));
        expect(matchingAnimationProperty(
            source,
            destination,
            `settings.fill.gradient.stops.${gradient.stops[1].id}.color`,
        )).toBe(`settings.fill.gradient.stops.${(destination.settings.fill as typeof gradient).stops[1].id}.color`);
    });
});
