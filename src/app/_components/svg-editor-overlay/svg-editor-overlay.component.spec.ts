import { EditorService } from "../../_services/editor.service";
import { canvasToWorkspaceProjection } from "../../editor/canvas-workspace-projection";
import { Group } from "../../editor/objects/elements/group.object";
import { Path } from "../../editor/objects/elements/path.object";
import { Shape } from "../../editor/objects/elements/shape.object";
import { Line } from "../../editor/objects/line.object";
import { combinedMotionAdjustedMatrixFor } from "../../editor/objects/motion-path.object";
import { GradientPaint } from "../../editor/objects/paint.object";
import { Point } from "../../editor/objects/point.object";
import { SVG } from "../../editor/objects/svg.object";
import { applyMatrix, multiplyMatrix } from "../../editor/objects/transform.object";
import { SVGEditorOverlayComponent } from "./svg-editor-overlay.component";

describe("viewport SVG editor overlay", () => {
    it("projects nested, scaled, reflected, and rotated selection geometry", () => {
        const { editor, svg, overlay } = setup();
        const group = new Group(editor);
        group.transform = { translateX: 7, translateY: -4, scaleX: 1.5, scaleY: 0.75, rotation: 25 };
        const shape = new Shape(editor, {
            type: "rectangle", position: new Point(10, 20), width: 40, height: 20,
        });
        shape.transform = { translateX: 3, translateY: 5, scaleX: -2, scaleY: 1.25, rotation: 35 };
        group.elements = [shape];
        svg.elements = [group];

        const box = overlay.selectionBox(shape)!;
        const expectedMatrix = multiplyMatrix(workspaceMatrix(), combinedMotionAdjustedMatrixFor(svg, shape));
        const expectedNorthWest = applyMatrix(expectedMatrix, 10, 20);
        const northWest = box.handles.find((handle) => handle.role === "nw")!;

        expect(northWest.x).toBeCloseTo(expectedNorthWest.x, 8);
        expect(northWest.y).toBeCloseTo(expectedNorthWest.y, 8);
        expect(box.pivot.x).toBeCloseTo(applyMatrix(expectedMatrix, 30, 30).x, 8);
        expect(box.pivot.y).toBeCloseTo(applyMatrix(expectedMatrix, 30, 30).y, 8);
        expect(Math.hypot(box.rotate.x - box.topCenter.x, box.rotate.y - box.topCenter.y)).toBeCloseTo(34, 8);
    });

    it("composes motion-path placement before projecting controls", () => {
        const { editor, svg, overlay } = setup();
        const motionPath = new Path(editor);
        motionPath.lines = [new Line(editor, {
            points: [new Point(0, 0), new Point(100, 0)],
        })];
        const shape = new Shape(editor, {
            type: "rectangle", position: new Point(0, 0), width: 10, height: 10,
        });
        shape.motion.pathId = motionPath.id;
        shape.motion.progress = 0.5;
        shape.motion.offsetX = 2;
        shape.motion.offsetY = 3;
        svg.elements = [motionPath, shape];

        const box = overlay.selectionBox(shape)!;

        expect(box.pivot.x).toBeCloseTo(204, 8);
        expect(box.pivot.y).toBeCloseTo(56, 8);
    });

    it("projects path anchors and Bezier controls individually", () => {
        const { editor, svg, overlay } = setup();
        const group = new Group(editor);
        group.transform.translateX = 5;
        const path = new Path(editor);
        const start = new Point(1, 2);
        const end = new Point(11, 12);
        const line = new Line(editor, {
            type: "bezier",
            points: [start, end],
            controlStart: new Point(4, 8),
            controlEnd: new Point(9, 6),
        });
        path.lines = [line];
        path.transform = { translateX: 2, translateY: 3, scaleX: 3, scaleY: -2, rotation: 20 };
        group.elements = [path];
        svg.elements = [group];

        const matrix = multiplyMatrix(workspaceMatrix(), combinedMotionAdjustedMatrixFor(svg, path));
        const anchors = overlay.pathAnchors(path);
        const segment = overlay.bezierSegments(path)[0];

        expect(anchors[0].point).toBe(start);
        expect(anchors[0].x).toBeCloseTo(applyMatrix(matrix, start.x, start.y).x, 8);
        expect(anchors[0].y).toBeCloseTo(applyMatrix(matrix, start.x, start.y).y, 8);
        expect(segment.controlStart.x).toBeCloseTo(applyMatrix(matrix, 4, 8).x, 8);
        expect(segment.controlStart.y).toBeCloseTo(applyMatrix(matrix, 4, 8).y, 8);
        expect(overlay.screenPx(4.5)).toBe(4.5);
        expect(overlay.screenDash(3, 3)).toBe("3 3");
    });

    it("projects gradient handles through the same element matrix", () => {
        const { editor, svg, overlay } = setup();
        const shape = new Shape(editor, {
            type: "rectangle", position: new Point(10, 20), width: 40, height: 20,
        });
        const gradient: GradientPaint = {
            type: "linear-gradient",
            id: "gradient",
            units: "objectBoundingBox",
            spreadMethod: "pad",
            coordinates: { x1: 0, y1: 0, x2: 1, y2: 1 },
            stops: [],
        };
        shape.settings.fill = gradient;
        shape.transform = { translateX: 5, translateY: 6, scaleX: -1.5, scaleY: 2, rotation: 15 };
        svg.elements = [shape];

        const matrix = multiplyMatrix(workspaceMatrix(), combinedMotionAdjustedMatrixFor(svg, shape));
        const geometry = overlay.gradient(shape)!;

        expect(geometry.start!.x).toBeCloseTo(applyMatrix(matrix, 10, 20).x, 8);
        expect(geometry.start!.y).toBeCloseTo(applyMatrix(matrix, 10, 20).y, 8);
        expect(geometry.end!.x).toBeCloseTo(applyMatrix(matrix, 50, 40).x, 8);
        expect(geometry.end!.y).toBeCloseTo(applyMatrix(matrix, 50, 40).y, 8);
    });
});

function setup(): { editor: EditorService; svg: SVG; overlay: SVGEditorOverlayComponent } {
    let id = 0;
    const editor = {
        get ID() { id += 1; return `id-${id}`; },
        selectedPathLines: [],
        selectedGradientPaintKey: undefined,
    } as unknown as EditorService;
    const svg = new SVG(editor, {
        width: 100,
        height: 100,
        pos: new Point(0, 0),
    });
    editor.selectedSVG = svg;
    const overlay = new SVGEditorOverlayComponent(editor);
    const artwork = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const workspace = document.createElement("div");
    spyOn(artwork, "getBoundingClientRect").and.returnValue(rect(120, 80, 200, 200));
    spyOn(workspace, "getBoundingClientRect").and.returnValue(rect(20, 30, 600, 400));
    overlay.artwork = artwork;
    overlay.workspace = { element: workspace } as any;
    return { editor, svg, overlay };
}

function workspaceMatrix() {
    return canvasToWorkspaceProjection(
        { left: 120, top: 80, width: 200, height: 200 },
        { left: 20, top: 30, width: 600, height: 400 },
        { x: 0, y: 0, width: 100, height: 100 },
    ).canvasToWorkspace;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}
