import { PaintEditorChange } from "../_components/paint-editor/paint-editor.types";
import { AnimationPlaybackService } from "./animation-playback.service";
import { DocumentMutationService } from "./document-mutation.service";
import { EditorService } from "./editor.service";
import { GradientPresetService } from "./gradient-preset.service";
import { PaintEditingService } from "./paint-editing.service";
import { Color } from "../editor/objects/color.object";
import { createDefaultGradient, GradientPaint, isGradientPaint } from "../editor/objects/paint.object";
import { AnyElement } from "../editor/objects/svg.object";

describe("PaintEditingService", () => {
    it("restores inactive paint variants and their exact animation tracks", () => {
        const harness = serviceHarness(new Color("#123456"));
        const solidTrack = track("solid-track", "settings.fill", "solid-key");
        harness.svg.animation.tracks.push(solidTrack);

        expect(harness.service.apply(harness.element, "fill", { type: "mode", mode: "gradient" })).toBeTrue();
        const created = harness.settings["fill"] as GradientPaint;
        expect(isGradientPaint(created)).toBeTrue();
        expect(created.stops[0].color.hex).toBe("#123456");
        expect(created.stops[1].color.serialized).toBe("#ffffff");
        expect(harness.settings["fill_enabled"]).toBeFalse();
        expect(harness.svg.animation.tracks).toEqual([]);

        created.stops[0].offset = 0.2;
        const gradientTrack = track("gradient-track", `settings.fill.gradient.stops.${created.stops[0].id}.offset`, "gradient-key");
        harness.svg.animation.tracks.push(gradientTrack);
        harness.service.apply(harness.element, "fill", { type: "mode", mode: "solid", selectedStopId: created.stops[1].id });

        expect((harness.settings["fill"] as Color).serialized).toBe("#123456");
        expect(harness.svg.animation.tracks).toEqual([solidTrack]);

        harness.service.apply(harness.element, "fill", { type: "mode", mode: "gradient" });
        const restored = harness.settings["fill"] as GradientPaint;
        expect(restored.stops[0].offset).toBe(0.2);
        expect(harness.svg.animation.tracks).toEqual([gradientTrack]);
        expect(harness.svg.animation.tracks[0]).not.toBe(gradientTrack);
    });

    it("uses the selected stop fallback and adds into the widest gap without dropping below two stops", () => {
        const gradient = createDefaultGradient("gradient");
        gradient.stops[0].offset = 0;
        gradient.stops[1].offset = 0.25;
        gradient.stops[1].color = new Color("#00ff00");
        const harness = serviceHarness(gradient);

        harness.service.apply(harness.element, "fill", { type: "add-stop", stopId: "new-stop" });
        const added = (harness.settings["fill"] as GradientPaint).stops.find((stop) => stop.id === "new-stop")!;
        expect(added.offset).toBeCloseTo(0.125);

        harness.service.apply(harness.element, "fill", { type: "remove-stop", stopId: "new-stop" });
        expect((harness.settings["fill"] as GradientPaint).stops.length).toBe(2);
        expect(harness.service.apply(harness.element, "fill", { type: "remove-stop", stopId: gradient.stops[0].id })).toBeFalse();

        harness.service.apply(harness.element, "fill", { type: "mode", mode: "solid", selectedStopId: gradient.stops[1].id });
        expect((harness.settings["fill"] as Color).hex).toBe("#00ff00");
    });

    it("applies preset stops by sorted index while preserving geometry and cleaning deleted-stop tracks", () => {
        const gradient = createDefaultGradient("gradient", "radial-gradient");
        gradient.units = "userSpaceOnUse";
        gradient.spreadMethod = "repeat";
        gradient.transform = [1, 0, 0, 1, 12, 13];
        gradient.coordinates = { cx: 8, cy: 9, r: 20, fx: 10, fy: 11 };
        gradient.stops.push({ id: "third", offset: 0.5, color: new Color("#888888"), opacity: 1 });
        gradient.stops.sort((a, b) => a.offset - b.offset);
        const originalIds = gradient.stops.map((stop) => stop.id);
        const harness = serviceHarness(gradient);
        harness.svg.animation.tracks.push(track("deleted-track", `settings.fill.gradient.stops.${originalIds[2]}.color`, "deleted-key"));

        harness.service.apply(harness.element, "fill", {
            type: "apply-preset",
            preset: {
                id: "preset",
                name: "Preset",
                stops: [
                    { offset: 0.1, color: "#112233", alpha: 0.4 },
                    { offset: 0.9, color: "#abcdef", alpha: 1 },
                ],
            },
        });

        expect(gradient.type).toBe("radial-gradient");
        expect(gradient.units).toBe("userSpaceOnUse");
        expect(gradient.spreadMethod).toBe("repeat");
        expect(gradient.transform).toEqual([1, 0, 0, 1, 12, 13]);
        expect(gradient.coordinates).toEqual({ cx: 8, cy: 9, r: 20, fx: 10, fy: 11 });
        expect(gradient.stops.map((stop) => stop.id)).toEqual(originalIds.slice(0, 2));
        expect(gradient.stops[0].color.alpha).toBe(0.4);
        expect(harness.svg.animation.tracks).toEqual([]);
    });

    it("routes timeline-safe solid and stop edits into keyframes", () => {
        const gradient = createDefaultGradient("gradient");
        const harness = serviceHarness(gradient, "animate");
        const change: PaintEditorChange = { type: "stop", stopId: gradient.stops[0].id, field: "offset", value: 0.3 };

        expect(harness.service.apply(harness.element, "fill", change)).toBeTrue();
        expect(harness.animation.setAnimatedPropertyValue).toHaveBeenCalledWith(
            harness.element,
            `settings.fill.gradient.stops.${gradient.stops[0].id}.offset`,
            "number",
            0.3,
        );
        expect(harness.service.apply(harness.element, "fill", { type: "add-stop", stopId: "blocked" })).toBeFalse();

        const solidHarness = serviceHarness(new Color("#000000"), "animate");
        const color = new Color("#abcdef80");
        expect(solidHarness.service.apply(solidHarness.element, "fill", { type: "solid-color", color })).toBeTrue();
        expect(solidHarness.animation.setAnimatedPropertyValue).toHaveBeenCalledWith(
            solidHarness.element, "settings.fill", "color", jasmine.objectContaining({ hex: "#abcdef" }),
        );
    });
});

function serviceHarness(paint: unknown, mode: "edit" | "animate" = "edit") {
    let id = 0;
    const svg = { id: "document", animation: { tracks: [] as ReturnType<typeof track>[] } };
    const editor = {
        selectedSVG: svg,
        get ID() { return `generated-${++id}`; },
    } as unknown as EditorService;
    const animation = {
        mode,
        invalidate: jasmine.createSpy("invalidate"),
        setAnimatedPropertyValue: jasmine.createSpy("setAnimatedPropertyValue"),
    } as unknown as AnimationPlaybackService;
    const mutations = {
        mutate: <T>(change: () => T) => change(),
        schedule: jasmine.createSpy("schedule"),
    } as unknown as DocumentMutationService;
    const presets = { save: jasmine.createSpy("save"), delete: jasmine.createSpy("delete") } as unknown as GradientPresetService;
    const settings: Record<string, unknown> = { fill: paint, fill_enabled: false };
    const element = { id: "element", settings } as unknown as AnyElement;
    return { service: new PaintEditingService(editor, animation, mutations, presets), editor, animation, mutations, svg, element, settings };
}

function track(id: string, property: string, keyId: string) {
    return {
        id,
        targetId: "element",
        property,
        valueType: property.endsWith("offset") ? "number" as const : "color" as const,
        enabled: true,
        keyframes: [{ id: keyId, time: 0, value: property.endsWith("offset") ? 0 : "#123456" }],
    };
}
