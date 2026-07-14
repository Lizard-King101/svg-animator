import { cloneColor, Color } from "../../../editor/objects/color.object";
import { ColorAttribute } from "./color.component";

describe("ColorAttribute", () => {
    it("keeps saturation and luminance stable through form write-back", () => {
        const component = new ColorAttribute();
        const initial = new Color("#336699");
        initial.preferredSpace = "hsl";
        component.writeValue(initial);
        component.registerOnChange((value) => component.writeValue(cloneColor(value)));

        component.hsl.s = 0;
        component.updateHSL();
        expect(component.hsl).toEqual(jasmine.objectContaining({ s: 0 }));
        expect(component.color.hex).toMatch(/^#[0-9a-f]{6}$/);

        component.hsl.h = 217;
        component.hsl.s = 73;
        component.hsl.l = 99;
        component.updateHSL();
        expect(component.hsl).toEqual({ h: 217, s: 73, l: 99 });

        component.hsl.s = 12;
        component.updateHSL();
        expect(component.hsl).toEqual({ h: 217, s: 12, l: 99 });
    });
});
