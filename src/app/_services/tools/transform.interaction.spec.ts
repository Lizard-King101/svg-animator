import { EditorService } from "../editor.service";
import { Group } from "../../editor/objects/elements/group.object";
import { Shape } from "../../editor/objects/elements/shape.object";
import { TextElement } from "../../editor/objects/elements/text.object";
import { Point } from "../../editor/objects/point.object";
import { SVG } from "../../editor/objects/svg.object";
import { applyMatrix } from "../../editor/objects/transform.object";
import { ownMatrix } from "../../editor/objects/element-bounds";
import { TransformInteraction } from "./transform.interaction";

describe("TransformInteraction geometry policy", () => {
    it("moves shape and text geometry while groups keep transform offsets", () => {
        const shape = new Shape(editorDouble(), { type: "rectangle", position: new Point(10, 20), width: 100, height: 50 });
        const shapeInteraction = interactionFor(shape);
        expect(shapeInteraction.begin("move", mouse(10, 20))).toBeTrue();
        shapeInteraction.update(mouse(15, 27));
        expect(shape.position.x).toBe(15);
        expect(shape.position.y).toBe(27);
        expect(shape.transform.translateX).toBe(0);

        const text = new TextElement(editorDouble(), new Point(4, 6));
        const textInteraction = interactionFor(text);
        textInteraction.begin("move", mouse(4, 6));
        textInteraction.update(mouse(9, 8));
        expect(text.position.x).toBe(9);
        expect(text.position.y).toBe(8);

        const group = new Group(editorDouble());
        const groupInteraction = interactionFor(group);
        groupInteraction.begin("move", mouse(0, 0));
        groupInteraction.update(mouse(5, 7));
        expect(group.transform.translateX).toBe(5);
        expect(group.transform.translateY).toBe(7);
    });

    it("resizes shapes natively while text retains scale resizing", () => {
        const shape = new Shape(editorDouble(), { type: "rectangle", position: new Point(0, 0), width: 100, height: 50 });
        const shapeInteraction = interactionFor(shape);
        shapeInteraction.begin("e", mouse(100, 25));
        shapeInteraction.update(mouse(150, 25));
        expect(shape.width).toBeCloseTo(150, 5);
        expect(shape.transform.scaleX).toBe(1);

        const text = new TextElement(editorDouble(), new Point(0, 0));
        const width = text.width;
        const textInteraction = interactionFor(text);
        textInteraction.begin("e", mouse(width, text.height / 2));
        textInteraction.update(mouse(width * 1.5, text.height / 2));
        expect(text.transform.scaleX).toBeGreaterThan(1.45);
        expect(text.position.x).toBe(0);
    });

    it("restores geometry and attached transform state when cancelled", () => {
        const shape = new Shape(editorDouble(), { type: "ellipse", position: new Point(10, 20), width: 100, height: 50 });
        shape.transform.originX = 60;
        shape.transform.originY = 45;
        const interaction = interactionFor(shape);
        interaction.begin("move", mouse(0, 0));
        interaction.update(mouse(20, 30));
        expect(interaction.cancel()).toBeTrue();
        expect(shape.position.x).toBe(10);
        expect(shape.position.y).toBe(20);
        expect(shape.transform.originX).toBe(60);
        expect(shape.transform.originY).toBe(45);
    });

    it("does not persist an implicit origin when a handle gesture never moves", () => {
        const shape = new Shape(editorDouble(), { type: "rectangle", position: new Point(0, 0), width: 100, height: 50 });
        const interaction = interactionFor(shape);
        interaction.begin("e", mouse(100, 25));
        interaction.end();
        expect(shape.transform.originX).toBeUndefined();
        expect(shape.transform.originY).toBeUndefined();
    });

    it("preserves an existing scale and the opposite visual edge during native resize", () => {
        const shape = new Shape(editorDouble(), { type: "rectangle", position: new Point(0, 0), width: 100, height: 50 });
        shape.transform.scaleX = 2;
        const interaction = interactionFor(shape);
        const before = applyMatrix(ownMatrix(shape), shape.x, shape.y + shape.height / 2);
        interaction.begin("e", mouse(150, 25));
        interaction.update(mouse(250, 25));
        const after = applyMatrix(ownMatrix(shape), shape.x, shape.y + shape.height / 2);
        expect(shape.width).toBeCloseTo(150, 5);
        expect(shape.transform.scaleX).toBe(2);
        expect(after.x).toBeCloseTo(before.x, 5);
        expect(after.y).toBeCloseTo(before.y, 5);
    });
});

function interactionFor(element: Shape | TextElement | Group): TransformInteraction {
    const editor = editorDouble();
    editor.selectedElement = element;
    editor.selectedSVG = { elements: [element] } as SVG;
    return new TransformInteraction(editor);
}

function editorDouble(): EditorService {
    return {
        get ID() { return Math.random().toString(36); },
        toCanvasPoint(x: number, y: number) { return new Point(x, y); },
    } as EditorService;
}

function mouse(x: number, y: number): MouseEvent {
    return new MouseEvent("mousemove", { clientX: x, clientY: y });
}
