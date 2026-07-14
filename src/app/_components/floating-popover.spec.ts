import { floatingPopoverStyle, positionFloatingPopover } from "./floating-popover";

describe("floating popover positioning", () => {
    const viewport = { width: 1000, height: 800 };

    it("anchors above a low trigger without relying on the popover height", () => {
        const position = positionFloatingPopover(
            { left: 300, right: 400, top: 700, bottom: 724 },
            { width: 244, preferredHeight: 360 },
            viewport,
        );

        expect(position).toEqual({ left: 156, bottom: 104, maxHeight: 360 });
        expect(floatingPopoverStyle(position)).toEqual({ left: "156px", bottom: "104px", maxHeight: "360px" });
    });

    it("opens below when that side has more room and clamps to the viewport", () => {
        const position = positionFloatingPopover(
            { left: 4, right: 54, top: 20, bottom: 44 },
            { width: 244, preferredHeight: 900 },
            viewport,
        );

        expect(position).toEqual({ left: 8, top: 48, maxHeight: 744 });
    });
});
