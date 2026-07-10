import { readAnimationProperty, writeAnimationProperty } from "./animation-targets";
import { createAnimationColorValue, evaluateTrack } from "./animation.object";
import { Color } from "./color.object";
import { AnyElement } from "./svg.object";
import { createDefaultGradient, gradientAnimationProperties, isGradientPaint, restorePaint, serializePaint } from "./paint.object";
import { TimelineEditingService } from "../../_services/timeline-editing.service";

describe("native gradient paint", () => {
    it("round-trips gradient geometry and stops without changing old solid paint saves", () => {
        const gradient = createDefaultGradient("gradient-1");
        gradient.coordinates.x2 = 0.75;
        gradient.stops[1].opacity = 0.4;

        const restored = restorePaint(serializePaint(gradient));
        expect(isGradientPaint(restored)).toBeTrue();
        expect(serializePaint(restored)).toEqual(serializePaint(gradient));
        expect(serializePaint(restorePaint("#123456"))).toBe("#123456");
    });

    it("projects gradient geometry and stop fields into timeline-addressable properties", () => {
        const gradient = createDefaultGradient("gradient-1");
        const element = elementDouble(gradient);
        const stop = gradient.stops[0];
        const colorProperty = `settings.fill.gradient.stops.${stop.id}.color`;
        const offsetProperty = `settings.fill.gradient.stops.${stop.id}.offset`;
        const properties = gradientAnimationProperties(element.settings as Record<string, unknown>);
        const rows = new TimelineEditingService().projectRows(
            [element],
            new Set([element.id]),
            [],
            () => true,
            { property: "path.shape", label: "Path Shape", valueType: "string", group: "path", mvp: true },
        );

        expect(properties.map((property) => property.property)).toContain(colorProperty);
        expect(rows.filter((row) => row.type === "property").map((row) => row.property.property)).toContain(colorProperty);
        expect(properties.map((property) => property.property)).toContain("settings.fill.gradient.x2");
        expect(writeAnimationProperty(element, offsetProperty, 0.35)).toBeTrue();
        expect(readAnimationProperty(element, offsetProperty)).toBe(0.35);
        expect(writeAnimationProperty(element, colorProperty, createAnimationColorValue("#ff0000"))).toBeTrue();
        expect(readAnimationProperty(element, colorProperty)).toBe("#ff0000");
        expect(readAnimationProperty(element, "settings.fill")).toBeUndefined();
    });

    it("keeps existing solid fill color interpolation compatible", () => {
        const value = evaluateTrack({
            id: "track",
            targetId: "element",
            property: "settings.fill",
            valueType: "color",
            keyframes: [
                { id: "from", time: 0, value: createAnimationColorValue("#000000") },
                { id: "to", time: 1, value: createAnimationColorValue("#ffffff") },
            ],
        }, 0.5);
        const element = elementDouble(new Color("#000000"));

        expect(writeAnimationProperty(element, "settings.fill", value)).toBeTrue();
        expect(readAnimationProperty(element, "settings.fill")).toBe("#808080");
    });
});

function elementDouble(fill: unknown): AnyElement {
    return {
        id: "element",
        settings: { fill, stroke: null, stroke_width: 1 },
        transform: {},
        motion: {},
        opacity: 1,
        visible: true,
    } as unknown as AnyElement;
}
