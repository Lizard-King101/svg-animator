import { floatingPopoverStyle, positionFloatingPopover, positionPointMenu } from "./floating-popover";

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
});
