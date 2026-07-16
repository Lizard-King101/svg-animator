import { EditorService } from "./editor.service";
import { ANIMATABLE_PROPERTIES, AnimatablePropertyDefinition } from "../editor/objects/animation.object";
import { readAnimationProperty } from "../editor/objects/animation-targets";
import { Path } from "../editor/objects/elements/path.object";
import { Line } from "../editor/objects/line.object";
import { Point } from "../editor/objects/point.object";
import { Group } from "../editor/objects/elements/group.object";
import { clampKeyframeTimeDelta, clampTimelineScale, semanticPartnerProperty, TimelineEditingService, timelineRulerInterval, timelineTimeToX, timelineXToTime } from "./timeline-editing.service";

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
        expect(semanticPartnerProperty("settings.color.gradient.x1")).toBe("settings.color.gradient.y1");
    });

    it("keeps scalar channels single", () => {
        expect(semanticPartnerProperty("opacity")).toBeUndefined();
        expect(semanticPartnerProperty("transform.rotation")).toBeUndefined();
    });
});

describe("path timeline properties", () => {
    it("projects independent Position X/Y and Offset X/Y rows", () => {
        const editor = { get ID() { return Math.random().toString(36); } } as EditorService;
        const path = new Path(editor);
        path.lines = [new Line(editor, { points: [new Point(10, 20), new Point(30, 40)] })];
        const pathShape: AnimatablePropertyDefinition = {
            property: "path.shape", label: "Path Shape", valueType: "string", group: "path", mvp: true,
        };
        const rows = new TimelineEditingService().projectRows(
            [path],
            new Set([path.id]),
            ANIMATABLE_PROPERTIES,
            (element, property) => property.property.startsWith("transform.")
                || readAnimationProperty(element, property.property) !== undefined,
            pathShape,
        );
        const properties = rows.flatMap((row) => row.type === "property" ? [row.property] : []);

        expect(properties).toContain(jasmine.objectContaining({ property: "geometry.x", label: "Position X" }));
        expect(properties).toContain(jasmine.objectContaining({ property: "geometry.y", label: "Position Y" }));
        expect(properties).toContain(jasmine.objectContaining({ property: "transform.translateX", label: "Offset X" }));
        expect(properties).toContain(jasmine.objectContaining({ property: "transform.translateY", label: "Offset Y" }));
    });
});

describe("timeline group projection", () => {
    it("minifies a collapsed group subtree and restores its existing expansion state", () => {
        const editor = { get ID() { return Math.random().toString(36); } } as EditorService;
        const group = new Group(editor);
        const child = new Path(editor);
        group.elements = [child];
        const editing = new TimelineEditingService();
        const project = (expanded: Set<string>) => editing.projectRows(
            [group], expanded, [], () => true,
            { property: "path.shape", label: "Path Shape", valueType: "string", group: "path", mvp: true },
        );

        expect(project(new Set()).map((row) => row.element.id)).toEqual([group.id]);
        expect(project(new Set([group.id])).filter((row) => row.type === "layer").map((row) => row.element.id))
            .toEqual([group.id, child.id]);
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
    it("allows a shared delta beyond the playable range without changing multi-key spacing", () => {
        expect(clampKeyframeTimeDelta([0.5, 1.5], -1, 3)).toBe(-1);
        expect(clampKeyframeTimeDelta([0.5, 1.5], 2, 3)).toBe(2);
        expect(clampKeyframeTimeDelta([0.5, 1.5], 0.25, 3)).toBe(0.25);
    });

    it("projects authored domains that begin before zero", () => {
        expect(timelineTimeToX(-2, 20, 100, -2)).toBe(20);
        expect(timelineTimeToX(0, 20, 100, -2)).toBe(220);
        expect(timelineXToTime(20, 20, 100, -2)).toBe(-2);
    });
});
