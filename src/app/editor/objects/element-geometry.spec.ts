import { EditorService } from "../../_services/editor.service";
import { geometryAnimationValues, readAnimationProperty, writeAnimationProperty } from "./animation-targets";
import { moveNativeGeometry, movesNativeGeometry, resizeNativeGeometry, resizesNativeGeometry, setGeometryFrameField } from "./element-geometry";
import { Group } from "./elements/group.object";
import { Path } from "./elements/path.object";
import { Shape } from "./elements/shape.object";
import { TextElement } from "./elements/text.object";
import { Line } from "./line.object";
import { GradientPaint } from "./paint.object";
import { Point } from "./point.object";

describe("element native geometry", () => {
    const editor = { get ID() { return Math.random().toString(36); } } as EditorService;

    it("moves shape geometry, its explicit pivot, and user-space gradient without changing its transform offset", () => {
        const shape = new Shape(editor, { type: "rectangle", position: new Point(10, 20), width: 100, height: 50 });
        const gradient: GradientPaint = {
            type: "linear-gradient", id: "gradient", units: "userSpaceOnUse", spreadMethod: "pad",
            coordinates: { x1: 10, y1: 20, x2: 110, y2: 70 }, stops: [],
        };
        shape.settings.fill = gradient;
        shape.transform.originX = 60;
        shape.transform.originY = 45;

        moveNativeGeometry(shape, { x: 5, y: -3 });

        expect(shape.position.x).toBe(15);
        expect(shape.position.y).toBe(17);
        expect(shape.transform.translateX).toBe(0);
        expect(shape.transform.translateY).toBe(0);
        expect(shape.transform.originX).toBe(65);
        expect(shape.transform.originY).toBe(42);
        expect(gradient.coordinates).toEqual({ x1: 10, y1: 20, x2: 110, y2: 70 });
        expect(gradient.transform).toEqual([1, 0, 0, 1, 5, -3]);
    });

    it("resizes shape geometry while preserving stroke and corner metrics", () => {
        const shape = new Shape(editor, { type: "rectangle", position: new Point(10, 20), width: 100, height: 50 });
        shape.settings.stroke_width = 7;
        shape.settings.corner_radius = 9;

        resizeNativeGeometry(shape, { x: 10, y: 20, width: 100, height: 50 }, { x: 20, y: 25, width: 200, height: 25 });

        expect(shape.position.x).toBe(20);
        expect(shape.position.y).toBe(25);
        expect(shape.width).toBe(200);
        expect(shape.height).toBe(25);
        expect(shape.settings.stroke_width).toBe(7);
        expect(shape.settings.corner_radius).toBe(9);
    });

    it("affinely resizes each unique path anchor and control point once", () => {
        const path = new Path(editor);
        const start = new Point(0, 0, "start");
        const shared = new Point(10, 10, "shared");
        const end = new Point(20, 0, "end");
        const control = new Point(5, 5, "control");
        path.lines = [
            new Line(editor, { type: "bezier", points: [start, shared], controlStart: control, controlEnd: shared }),
            new Line(editor, { type: "line", points: [shared, end] }),
        ];

        resizeNativeGeometry(path, { x: 0, y: 0, width: 20, height: 10 }, { x: 10, y: 20, width: 40, height: 30 });

        expect(start.x).toBe(10);
        expect(start.y).toBe(20);
        expect(shared.x).toBe(30);
        expect(shared.y).toBe(50);
        expect(end.x).toBe(50);
        expect(end.y).toBe(20);
        expect(control.x).toBe(20);
        expect(control.y).toBe(35);
    });

    it("uses native movement for text but retains transform resizing for text and groups", () => {
        const text = new TextElement(editor, new Point(2, 3));
        const group = new Group(editor);
        expect(movesNativeGeometry(text)).toBeTrue();
        expect(resizesNativeGeometry(text)).toBeFalse();
        expect(movesNativeGeometry(group)).toBeFalse();
        expect(resizesNativeGeometry(group)).toBeFalse();
        moveNativeGeometry(text, { x: 4, y: 5 });
        expect(text.position.x).toBe(6);
        expect(text.position.y).toBe(8);
    });

    it("reads and writes first-class shape and text geometry animation channels", () => {
        const shape = new Shape(editor, { type: "ellipse", position: new Point(5, 6), width: 20, height: 30 });
        const text = new TextElement(editor, new Point(7, 8));
        expect(geometryAnimationValues(shape)).toEqual(jasmine.objectContaining({
            "geometry.x": 5, "geometry.y": 6, "geometry.width": 20, "geometry.height": 30,
        }));
        expect(readAnimationProperty(text, "geometry.x")).toBe(7);
        expect(writeAnimationProperty(text, "geometry.y", 12)).toBeTrue();
        expect(text.position.y).toBe(12);
        expect(writeAnimationProperty(shape, "geometry.width", -4)).toBeTrue();
        expect(shape.width).toBe(1);
        expect(setGeometryFrameField(text, "width", 100)).toBeFalse();
    });

    it("reads and writes path position channels without using transform offset", () => {
        const path = new Path(editor);
        path.lines = [new Line(editor, { points: [new Point(10, 20), new Point(40, 60)] })];
        const gradient: GradientPaint = {
            type: "linear-gradient", id: "path-gradient", units: "userSpaceOnUse", spreadMethod: "pad",
            coordinates: { x1: 10, y1: 20, x2: 40, y2: 60 }, stops: [],
        };
        path.settings.fill = gradient;
        path.transform.originX = 25;
        path.transform.originY = 40;

        expect(readAnimationProperty(path, "geometry.x")).toBe(10);
        expect(readAnimationProperty(path, "geometry.y")).toBe(20);
        expect(writeAnimationProperty(path, "geometry.x", 35)).toBeTrue();
        expect(writeAnimationProperty(path, "geometry.y", 45)).toBeTrue();

        expect(path.pathPoints().map((point) => [point.x, point.y])).toEqual([[35, 45], [65, 85]]);
        expect(path.transform.translateX).toBe(0);
        expect(path.transform.translateY).toBe(0);
        expect(path.transform.originX).toBe(50);
        expect(path.transform.originY).toBe(65);
        expect(gradient.transform).toEqual([1, 0, 0, 1, 25, 25]);
        expect(geometryAnimationValues(path)).toEqual(jasmine.objectContaining({
            "geometry.x": 35,
            "geometry.y": 45,
        }));
    });
});
