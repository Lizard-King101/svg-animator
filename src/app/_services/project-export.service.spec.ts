import { ProjectExportService } from "./project-export.service";
import { migrateDocument } from "../editor/migrations/document-migrations";
import { SVGSave } from "../editor/objects/svg.object";

describe("ProjectExportService", () => {
    const source = (): SVGSave => ({
        id: "project", name: "Editable source", width: 120, height: 90, elements: [],
        animation: {
            version: 2, duration: 1, loop: false, markers: [], variables: [],
            tracks: [{
                id: "orphan", targetId: "deleted-layer", property: "opacity", valueType: "number",
                keyframes: [{ id: "start", time: 0, value: 1 }],
            }],
        },
    });

    it("builds a deterministic editable v5 envelope even with orphaned tracks", () => {
        const service = new ProjectExportService();
        const project = { name: "Demo / unsafe", svgData: source() };
        const first = service.build(project);
        const second = service.build(project);

        expect(first).toEqual(second);
        expect(first.filename).toBe("Demo - unsafe.svg-animator.json");
        expect(first.mimeType).toBe("application/json");
        const envelope = JSON.parse(first.content as string);
        expect(envelope.kind).toBe("svg-animator/document");
        expect(envelope.version).toBe(5);
        expect(envelope.data.animation.tracks[0].targetId).toBe("deleted-layer");
        expect(migrateDocument(envelope).status).toBe("ok");
    });
});
