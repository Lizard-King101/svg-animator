import { cloneColor, Color } from "./color.object";

describe("Color", () => {
    it("converts zero-saturation HSL to valid grayscale RGB", () => {
        const expectations = [
            { luminance: 0, hex: "#000000", channel: 0 },
            { luminance: 25, hex: "#404040", channel: 64 },
            { luminance: 50, hex: "#808080", channel: 128 },
            { luminance: 75, hex: "#bfbfbf", channel: 191 },
            { luminance: 100, hex: "#ffffff", channel: 255 },
        ];

        expectations.forEach(({ luminance, hex, channel }) => {
            const color = new Color();
            color.hsl = { h: 215, s: 0, l: luminance };
            expect(color.hex).toBe(hex);
            expect(color.rgb).toEqual({ r: channel, g: channel, b: channel });
        });
    });

    it("preserves exact HSL coordinates when cloning a quantized color", () => {
        const color = new Color();
        color.preferredSpace = "hsl";
        color.hsl = { h: 217, s: 73, l: 99 };

        const clone = cloneColor(color);

        expect(clone).not.toBe(color);
        expect(clone.hex).toBe(color.hex);
        expect(clone.hsl).toEqual({ h: 217, s: 73, l: 99 });
        expect(clone.preferredSpace).toBe("hsl");
    });

    it("clamps RGB inputs before producing hex", () => {
        const color = new Color();
        color.rgb = { r: -2.4, g: 127.6, b: 300 };
        expect(color.rgb).toEqual({ r: 0, g: 128, b: 255 });
        expect(color.hex).toBe("#0080ff");
    });
});
