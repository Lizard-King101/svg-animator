import { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { KEYFRAME_EASING_ICONS, keyframeEasingIcon } from "./keyframe-easing-icons";

describe("keyframe easing icons", () => {
    it("uses the custom symbol pair for every visualized easing preset", () => {
        Object.values(KEYFRAME_EASING_ICONS).forEach((icons) => {
            expect(icons.default.icon.slice(0, 2)).toEqual([50, 50]);
            expect(icons.selected.icon.slice(0, 2)).toEqual([50, 50]);
            expect(icons.selected).not.toBe(icons.default);
        });
    });

    it("chooses the outlined symbol only for selected keyframes", () => {
        expect(keyframeEasingIcon("ease-out")).toBe(KEYFRAME_EASING_ICONS["ease-out"].default);
        expect(keyframeEasingIcon("ease-out", true)).toBe(KEYFRAME_EASING_ICONS["ease-out"].selected);
    });

    it("preserves the existing hold symbol and treats mixed easing as linear", () => {
        expect(keyframeEasingIcon("hold")).toBe("pause");
        expect(keyframeEasingIcon("mixed") as IconDefinition).toBe(KEYFRAME_EASING_ICONS.linear.default);
    });
});
