import { floatingPopoverStyle, positionFloatingPopover, positionPointMenu, positionSidePopover } from "./floating-popover";

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

    it("keeps pointer menus inside the viewport and honours leftward opening", () => {
        const size = { width: 180, height: 300 };
        expect(positionPointMenu({ x: 100, y: 100 }, size, false, viewport)).toEqual({ left: 100, top: 100 });
        expect(positionPointMenu({ x: 100, y: 700 }, size, false, viewport)).toEqual({ left: 100, top: 492 });
        expect(positionPointMenu({ x: 900, y: 50 }, size, true, viewport)).toEqual({ left: 720, top: 50 });
        expect(positionPointMenu({ x: 990, y: 50 }, size, false, viewport)).toEqual({ left: 812, top: 50 });
        expect(positionPointMenu({ x: 50, y: 50 }, { width: 180, height: 900 }, true, viewport)).toEqual({ left: 8, top: 8 });
    });

    it("opens side popovers left of the panel, clamped vertically, and falls back below without room", () => {
        const options = { width: 280, preferredHeight: 600, inset: 12 };
        expect(positionSidePopover({ left: 700, right: 940, top: 500, bottom: 528 }, options, viewport))
            .toEqual({ left: 404, top: 192, maxHeight: 600 });
        expect(positionSidePopover({ left: 700, right: 940, top: 40, bottom: 68 }, options, viewport))
            .toEqual({ left: 404, top: 40, maxHeight: 600 });
        expect(positionSidePopover({ left: 700, right: 940, top: 40, bottom: 68 }, { ...options, preferredHeight: 2000 }, viewport))
            .toEqual({ left: 404, top: 8, maxHeight: 784 });
        expect(positionSidePopover({ left: 200, right: 440, top: 40, bottom: 68 }, options, viewport))
            .toEqual(positionFloatingPopover({ left: 200, right: 440, top: 40, bottom: 68 }, options, viewport));
    });
});
