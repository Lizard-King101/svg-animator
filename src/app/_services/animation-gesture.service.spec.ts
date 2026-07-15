import { AnimationGestureService } from "./animation-gesture.service";
import { AnimationPlaybackService } from "./animation-playback.service";
import { EditorService } from "./editor.service";
import { moveNativeGeometry, resizeNativeGeometry } from "../editor/objects/element-geometry";
import { Shape } from "../editor/objects/elements/shape.object";
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
});

function editorDouble(): EditorService {
    return { get ID() { return Math.random().toString(36); } } as EditorService;
}
