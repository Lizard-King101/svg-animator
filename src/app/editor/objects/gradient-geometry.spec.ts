import { GradientPaint } from "./paint.object";
import { gradientGeometry, moveGradientHandle } from "./gradient-geometry";
import { AnyElement } from "./svg.object";
import { Shape } from "./elements/shape.object";
import { Point } from "./point.object";
import { EditorService } from "../../_services/editor.service";

describe("gradient viewport geometry", () => {
    it("maps object-box linear coordinates to element-local handles and back", () => {
        const paint = gradient("linear-gradient", { x1: 0, y1: 0, x2: 1, y2: 1 });
        const element = elementDouble(paint);
        const geometry = gradientGeometry(element)!;

        expect(geometry.start).toEqual({ x: 10, y: 20 });
        expect(geometry.end).toEqual({ x: 210, y: 120 });
        expect(moveGradientHandle(element, paint, "end", { x: 110, y: 45 })).toBeTrue();
        expect(paint.coordinates.x2).toBe(0.5);
        expect(paint.coordinates.y2).toBe(0.25);
    });

    it("moves radial center/focal together and edits radius independently", () => {
        const paint = gradient("radial-gradient", { cx: 0.5, cy: 0.5, r: 0.25, fx: 0.4, fy: 0.4 });
        const element = elementDouble(paint);

        moveGradientHandle(element, paint, "center", { x: 130, y: 80 });
        expect(paint.coordinates.cx).toBe(0.6);
        expect(paint.coordinates.cy).toBe(0.6);
        expect(paint.coordinates.fx).toBeCloseTo(0.5, 5);
        expect(paint.coordinates.fy).toBeCloseTo(0.5, 5);
        moveGradientHandle(element, paint, "radius", { x: 170, y: 80 });
        expect(paint.coordinates.r).toBeCloseTo(0.2, 5);
    });
});

function gradient(type: GradientPaint["type"], coordinates: GradientPaint["coordinates"]): GradientPaint {
    return { type, id: "gradient", units: "objectBoundingBox", spreadMethod: "pad", coordinates, stops: [] };
}

function elementDouble(fill: GradientPaint): AnyElement {
    const shape = new Shape({ get ID() { return "shape"; } } as EditorService, {
        type: "rectangle", position: new Point(10, 20), width: 200, height: 100,
    });
    shape.settings.fill = fill;
    return shape;
}
