import { EditorService } from "../_services/editor.service";
import { AnimationPlaybackService } from "../_services/animation-playback.service";
import { DocumentMutationService } from "../_services/document-mutation.service";
import { ElementFactory } from "../_services/element-factory.service";
import { HistoryService } from "../_services/history.service";
import { LayerOperationsService } from "../_services/layer-operations.service";
import { ProjectService } from "../_services/project.service";
import { evaluateTrack } from "./objects/animation.object";
import { Color } from "./objects/color.object";
import { Group } from "./objects/elements/group.object";
import { Path } from "./objects/elements/path.object";
import { Shape } from "./objects/elements/shape.object";
import { Line } from "./objects/line.object";
import { Point } from "./objects/point.object";
import { canConvertStrokeToPath, convertStrokeToPath } from "./objects/stroke-outline.object";
import { SVG } from "./objects/svg.object";
import { buildSVGMarkup } from "./svg-markup";

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
        expect(outline!.settings.fill?.hex).toBe("#abcdef");
        expect(outline!.settings.stroke).toBeNull();
        expect(outline!.settings.stroke_width).toBe(0);
        expect(outline!.contours.every((contour) => contour.closed)).toBeTrue();
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

    it("creates one history snapshot and autosave for a change and neither for a no-op", () => {
        const { editor, svg, path } = documentWithPath();
        (editor as any).selectedSVG = svg;
        const animation = {
            withBaseState: <T>(callback: () => T) => callback(),
        } as AnimationPlaybackService;
        const history = new HistoryService();
        const projects = {
            upsert: jasmine.createSpy("upsert"),
        } as unknown as ProjectService;
        spyOn(history, "snapshot").and.callThrough();
        const mutations = new DocumentMutationService(editor, animation, history, projects);
        mutations.resetBaseline();

        mutations.mutate(() => { path.opacity = 0.5; });
        expect(history.snapshot).toHaveBeenCalledTimes(1);
        expect(projects.upsert).toHaveBeenCalledTimes(1);

        mutations.mutate(() => undefined);
        expect(history.snapshot).toHaveBeenCalledTimes(1);
        expect(projects.upsert).toHaveBeenCalledTimes(1);
    });
});
