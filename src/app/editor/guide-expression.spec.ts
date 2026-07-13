import { parseGuideExpression } from "./guide-expression";

describe("guide expressions", () => {
    it("supports document dimensions, percentages, center, and negative-edge offsets", () => {
        expect(parseGuideExpression("center", 800, 600, "x")).toBe(400);
        expect(parseGuideExpression("25%", 800, 600, "y")).toBe(150);
        expect(parseGuideExpression("-20", 800, 600, "x")).toBe(780);
        expect(parseGuideExpression("w / 2 + h / 4", 800, 600, "x")).toBe(550);
    });

    it("rejects malformed or non-finite expressions", () => {
        expect(parseGuideExpression("w +", 800, 600, "x")).toBeUndefined();
        expect(parseGuideExpression("unknown", 800, 600, "x")).toBeUndefined();
        expect(parseGuideExpression("w / 0", 800, 600, "x")).toBeUndefined();
    });
});
