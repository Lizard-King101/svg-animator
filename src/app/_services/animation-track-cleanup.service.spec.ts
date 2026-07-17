import { AnimationTrackCleanupService, findOrphanedAnimationTracks } from "./animation-track-cleanup.service";
import { AnimationPlaybackService } from "./animation-playback.service";
import { DocumentMutationService } from "./document-mutation.service";
import { EditorService } from "./editor.service";
import { Group } from "../editor/objects/elements/group.object";
import { Shape } from "../editor/objects/elements/shape.object";
import { Point } from "../editor/objects/point.object";
import { SVG } from "../editor/objects/svg.object";
import { AnimationTrack } from "../editor/objects/animation.object";

describe("AnimationTrackCleanupService", () => {
    it("finds only tracks whose targets are absent, including nested group targets", () => {
        const { svg, nested } = documentHarness();
        const valid = track("valid", nested.id);
        const orphaned = track("orphaned", "deleted-layer");
        const disabledOrphaned = { ...track("disabled-orphaned", "also-deleted"), enabled: false };
        svg.animation.tracks = [valid, orphaned, disabledOrphaned];

        expect(findOrphanedAnimationTracks(svg)).toEqual([orphaned, disabledOrphaned]);
    });

    it("removes all orphaned tracks in one animation mutation and invalidates preview state", () => {
        const { editor, svg, nested } = documentHarness();
        const valid = track("valid", nested.id);
        const orphaned = track("orphaned", "deleted-layer");
        svg.animation.tracks = [valid, orphaned];
        const domains: string[] = [];
        const mutations = {
            mutate: (change: () => void, domain: string) => { domains.push(domain); change(); },
        } as unknown as DocumentMutationService;
        const animation = {
            mode: "edit",
            currentTime: 0,
            invalidate: jasmine.createSpy("invalidate"),
            previewAt: jasmine.createSpy("previewAt"),
        } as unknown as AnimationPlaybackService;
        const cleanup = new AnimationTrackCleanupService(editor, animation, mutations);

        expect(cleanup.removeOrphanedTracks()).toBe(1);
        expect(svg.animation.tracks).toEqual([valid]);
        expect(domains).toEqual(["animation"]);
        expect(animation.invalidate).toHaveBeenCalledTimes(1);
        expect(animation.previewAt).not.toHaveBeenCalled();
        expect(cleanup.removeOrphanedTracks()).toBe(0);
        expect(domains).toEqual(["animation"]);
    });
});

function documentHarness(): { editor: EditorService; svg: SVG; nested: Shape } {
    let id = 0;
    const editor = {
        get ID() { return `id-${++id}`; },
    } as unknown as EditorService;
    const svg = new SVG(editor, { width: 100, height: 100, pos: new Point(0, 0) });
    const group = new Group(editor);
    const nested = new Shape(editor, { type: "rectangle", position: new Point(0, 0) });
    group.elements = [nested];
    svg.elements = [group];
    editor.selectedSVG = svg;
    return { editor, svg, nested };
}

function track(id: string, targetId: string): AnimationTrack {
    return {
        id,
        targetId,
        property: "transform.translateX",
        valueType: "number",
        keyframes: [{ id: `${id}-key`, time: 0, value: 0 }],
    };
}
