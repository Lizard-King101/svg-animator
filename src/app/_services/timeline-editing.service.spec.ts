import { clampKeyframeTimeDelta, clampTimelineScale, semanticPartnerProperty, timelineRulerInterval } from "./timeline-editing.service";

describe("speed graph semantic pairing", () => {
    it("pairs transform and motion channels", () => {
        expect(semanticPartnerProperty("transform.translateX")).toBe("transform.translateY");
        expect(semanticPartnerProperty("transform.scaleY")).toBe("transform.scaleX");
        expect(semanticPartnerProperty("motion.offsetX")).toBe("motion.offsetY");
    });

    it("pairs each path point and gradient coordinate without crossing identities", () => {
        expect(semanticPartnerProperty("path.points.point-7.x")).toBe("path.points.point-7.y");
        expect(semanticPartnerProperty("settings.fill.gradient.x2")).toBe("settings.fill.gradient.y2");
        expect(semanticPartnerProperty("settings.stroke.gradient.fy")).toBe("settings.stroke.gradient.fx");
    });

    it("keeps scalar channels single", () => {
        expect(semanticPartnerProperty("opacity")).toBeUndefined();
        expect(semanticPartnerProperty("transform.rotation")).toBeUndefined();
    });
});

describe("comprehensive timeline zoom", () => {
    it("supports overview and detailed curve scales", () => {
        expect(clampTimelineScale(1)).toBe(10);
        expect(clampTimelineScale(900)).toBe(900);
        expect(clampTimelineScale(4000)).toBe(2000);
        expect(timelineRulerInterval(1200)).toBe(0.05);
    });
});

describe("keyframe retiming", () => {
    it("clamps a shared delta without changing multi-key spacing", () => {
        expect(clampKeyframeTimeDelta([0.5, 1.5], -1, 3)).toBe(-0.5);
        expect(clampKeyframeTimeDelta([0.5, 1.5], 2, 3)).toBe(1.5);
        expect(clampKeyframeTimeDelta([0.5, 1.5], 0.25, 3)).toBe(0.25);
    });
});
