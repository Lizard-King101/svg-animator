import { createDefaultGradient } from "../editor/objects/paint.object";
import { GradientPresetService } from "./gradient-preset.service";

describe("GradientPresetService", () => {
    const storageKey = "svg-animator.gradient-presets";

    beforeEach(() => localStorage.removeItem(storageKey));
    afterEach(() => localStorage.removeItem(storageKey));

    it("provides the bundled set and persists auto-named custom presets without document IDs", () => {
        const service = new GradientPresetService();
        expect(service.presets.slice(0, 8).map((preset) => preset.name)).toEqual([
            "Sunset", "Ocean", "Mint", "Violet", "Fire", "Steel", "Spectrum", "Fade",
        ]);
        const gradient = createDefaultGradient("document-gradient");
        gradient.stops[1].color.alpha = 0.25;

        const first = service.save(gradient);
        const second = service.save(gradient);
        expect([first.name, second.name]).toEqual(["Custom 1", "Custom 2"]);
        expect(JSON.stringify(first)).not.toContain("document-gradient");

        const restored = new GradientPresetService();
        expect(restored.presets.slice(-2).map((preset) => preset.name)).toEqual(["Custom 1", "Custom 2"]);
        expect(restored.delete(first.id)).toBeTrue();
        expect(new GradientPresetService().presets.some((preset) => preset.id === first.id)).toBeFalse();
    });

    it("ignores malformed and unsupported storage records", () => {
        localStorage.setItem(storageKey, "not json");
        expect(new GradientPresetService().presets.length).toBe(8);
        localStorage.setItem(storageKey, JSON.stringify({ version: 99, presets: [{ id: "bad" }] }));
        expect(new GradientPresetService().presets.length).toBe(8);
    });
});
