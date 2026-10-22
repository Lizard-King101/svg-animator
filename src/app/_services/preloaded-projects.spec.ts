import { PRELOADED_PROJECTS } from "./preloaded-projects";

describe("preloaded projects", () => {
    it("loads the current exported favicon and animation showcase", () => {
        expect(PRELOADED_PROJECTS.map((project) => project.name)).toEqual([
            "Animation Example",
            "favicon",
        ]);

        const animation = PRELOADED_PROJECTS[0].svgData.animation;
        expect(animation?.version).toBe(2);
        expect(animation?.tracks.length).toBe(30);
        expect(animation?.tracks.some((track) => track.property === "settings.stroke")).toBeTrue();
        expect(animation?.tracks.some((track) => track.property === "settings.color.gradient.x2")).toBeTrue();
        expect(JSON.stringify(PRELOADED_PROJECTS[0].svgData.elements)).toContain('"stroke_alignment":"outside"');

        const favicon = PRELOADED_PROJECTS[1].svgData;
        expect(favicon.elements[0].type).toBe("group");
        if(favicon.elements[0].type === "group") {
            expect(favicon.elements[0].clipElementId).toBeTruthy();
            expect(favicon.elements[0].elements.length).toBe(4);
        }
    });

    it("provides valid SVG gallery thumbnails for every seed", () => {
        PRELOADED_PROJECTS.forEach((project) => {
            const parsed = new DOMParser().parseFromString(project.thumbnail, "image/svg+xml");
            expect(parsed.querySelector("parsererror")).toBeNull();
            expect(parsed.documentElement.tagName).toBe("svg");
            expect(parsed.documentElement.getAttribute("viewBox")).toBeTruthy();
        });
    });
});
