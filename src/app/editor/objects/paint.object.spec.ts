import { readAnimationProperty, writeAnimationProperty } from "./animation-targets";
import { ANIMATABLE_PROPERTIES, createAnimationColorValue, evaluateTrack } from "./animation.object";
import { Color } from "./color.object";
import { AnyElement } from "./svg.object";
import { createDefaultGradient, gradientAnimationProperties, isGradientPaint, restorePaint, serializePaint } from "./paint.object";
import { TimelineEditingService } from "../../_services/timeline-editing.service";

describe("native gradient paint", () => {
    it("round-trips gradient geometry and stops without changing old solid paint saves", () => {
        const gradient = createDefaultGradient("gradient-1");
        gradient.coordinates.x2 = 0.75;
        gradient.stops[1].color.alpha = 0.4;

        const restored = restorePaint(serializePaint(gradient));
        expect(isGradientPaint(restored)).toBeTrue();
        expect(serializePaint(restored)).toEqual(serializePaint(gradient));
        expect(serializePaint(restorePaint("#123456"))).toBe("#123456");
        const translucent = restorePaint("#12345680") as Color;
        expect(translucent.alpha).toBeCloseTo(0.502, 2);
        expect(serializePaint(translucent)).toBe("#12345680");
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
        expect(rows.filter((row) => row.type === "property").map((row) => row.property.property)).toEqual([
            "settings.fill.gradient.geometry",
            "settings.fill.gradient.stops",
        ]);
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

    it("interpolates alpha through existing color tracks", () => {
        const value = evaluateTrack({
            id: "alpha-track", targetId: "element", property: "settings.fill", valueType: "color",
            keyframes: [
                { id: "from", time: 0, value: createAnimationColorValue("#00000000") },
                { id: "to", time: 1, value: createAnimationColorValue("#ffffff") },
            ],
        }, 0.5);
        expect(value).toBe("#80808080");
    });

    it("projects text color paints into solid and gradient timeline rows", () => {
        const solid = elementWithSettings({ color: new Color("#123456") });
        const solidRows = new TimelineEditingService().projectRows(
            [solid],
            new Set([solid.id]),
            ANIMATABLE_PROPERTIES,
            (element, property) => property.property === "settings.color"
                && readAnimationProperty(element, property.property) !== undefined,
            { property: "path.shape", label: "Path Shape", valueType: "string", group: "path", mvp: true },
        );

        expect(solidRows.some((row) => row.type === "property" && row.property.property === "settings.color")).toBeTrue();
        expect(writeAnimationProperty(solid, "settings.color", createAnimationColorValue("#abcdef"))).toBeTrue();
        expect(readAnimationProperty(solid, "settings.color")).toBe("#abcdef");

        const gradient = createDefaultGradient("text-gradient");
        const gradientText = elementWithSettings({ color: gradient });
        const properties = gradientAnimationProperties(gradientText.settings as Record<string, unknown>);
        const gradientRows = new TimelineEditingService().projectRows(
            [gradientText],
            new Set([gradientText.id]),
            ANIMATABLE_PROPERTIES,
            (element, property) => property.property === "settings.color"
                && readAnimationProperty(element, property.property) !== undefined,
            { property: "path.shape", label: "Path Shape", valueType: "string", group: "path", mvp: true },
        );

        expect(properties.map((property) => property.property)).toContain("settings.color.gradient.x2");
        expect(gradientRows.some((row) => row.type === "property" && row.property.property === "settings.color.gradient.geometry")).toBeTrue();
        expect(gradientRows.some((row) => row.type === "property" && row.property.property === "settings.color.gradient.stops")).toBeTrue();
    });
});

function elementDouble(fill: unknown): AnyElement {
    return elementWithSettings({ fill, stroke: null, stroke_width: 1 });
}

function elementWithSettings(settings: Record<string, unknown>): AnyElement {
    return {
        id: "element",
        settings,
        transform: {},
        motion: {},
        opacity: 1,
        visible: true,
    } as unknown as AnyElement;
}
