import { AnimationGestureService } from "./animation-gesture.service";
import { AnimationPlaybackService } from "./animation-playback.service";
import { EditorService } from "./editor.service";
import { moveNativeGeometry, resizeNativeGeometry } from "../editor/objects/element-geometry";
import { Shape } from "../editor/objects/elements/shape.object";
import { Path } from "../editor/objects/elements/path.object";
import { Line } from "../editor/objects/line.object";
import { pathPointAnimationProperty } from "../editor/objects/animation-targets";
import { Point } from "../editor/objects/point.object";

describe("AnimationGestureService geometry gestures", () => {
    it("creates geometry tracks for a shape move without transform offset tracks", () => {
        const editor = editorDouble();
        const shape = new Shape(editor, { type: "rectangle", position: new Point(10, 20), width: 100, height: 50 });
        editor.selectedElement = shape;
        const writes: Array<{ property: string; value: unknown; baseline: unknown }> = [];
        const animation = {
            mode: "animate",
            upsertKeyframe(_element: Shape, property: string, _type: string, value: unknown, baseline: unknown) {
                writes.push({ property, value, baseline });
            },
        } as unknown as AnimationPlaybackService;
        const gestures = new AnimationGestureService(editor, animation);

        gestures.begin();
        moveNativeGeometry(shape, { x: 5, y: -3 });
        gestures.end();

        expect(writes).toContain(jasmine.objectContaining({ property: "geometry.x", value: 15, baseline: 10 }));
        expect(writes).toContain(jasmine.objectContaining({ property: "geometry.y", value: 17, baseline: 20 }));
        expect(writes.some((write) => write.property === "transform.translateX" || write.property === "transform.translateY")).toBeFalse();
    });

    it("creates width and height tracks for a shape resize", () => {
        const editor = editorDouble();
        const shape = new Shape(editor, { type: "ellipse", position: new Point(0, 0), width: 100, height: 50 });
        editor.selectedElement = shape;
        const properties: string[] = [];
        const animation = {
            mode: "animate",
            upsertKeyframe(_element: Shape, property: string) { properties.push(property); },
        } as unknown as AnimationPlaybackService;
        const gestures = new AnimationGestureService(editor, animation);

        gestures.begin();
        resizeNativeGeometry(shape, { x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 0, width: 150, height: 75 });
        gestures.end();

        expect(properties).toContain("geometry.width");
        expect(properties).toContain("geometry.height");
        expect(properties).not.toContain("transform.scaleX");
        expect(properties).not.toContain("transform.scaleY");
    });

    it("creates only position tracks for a rigid path move", () => {
        const editor = editorDouble();
        const path = new Path(editor);
        path.lines = [new Line(editor, { points: [new Point(10, 20), new Point(30, 40)] })];
        editor.selectedElement = path;
        const writes: Array<{ property: string; value: unknown; baseline: unknown }> = [];
        const animation = {
            mode: "animate",
            upsertKeyframe(_element: Path, property: string, _type: string, value: unknown, baseline: unknown) {
                writes.push({ property, value, baseline });
            },
        } as unknown as AnimationPlaybackService;
        const gestures = new AnimationGestureService(editor, animation);

        gestures.begin();
        moveNativeGeometry(path, { x: 7, y: -4 });
        gestures.end();

        expect(writes).toEqual([
            { property: "geometry.x", value: 17, baseline: 10 },
            { property: "geometry.y", value: 16, baseline: 20 },
        ]);
    });

    it("keeps path deformation on point tracks instead of changing position", () => {
        const editor = editorDouble();
        const path = new Path(editor);
        const start = new Point(10, 20);
        const end = new Point(30, 40);
        path.lines = [new Line(editor, { points: [start, end] })];
        editor.selectedElement = path;
        const properties: string[] = [];
        const animation = {
            mode: "animate",
            upsertKeyframe(_element: Path, property: string) { properties.push(property); },
        } as unknown as AnimationPlaybackService;
        const gestures = new AnimationGestureService(editor, animation);

        gestures.begin();
        start.x = 5;
        gestures.end();

        expect(properties).toEqual([pathPointAnimationProperty(start.id, "x")]);
        expect(properties).not.toContain("geometry.x");
        expect(properties).not.toContain("geometry.y");
    });
});

function editorDouble(): EditorService {
    return { get ID() { return Math.random().toString(36); } } as EditorService;
}
