import legacyProjects from "./fixtures/legacy-projects.json";
import currentProjects from "./fixtures/current-projects-v1.json";
import futureProjects from "./fixtures/future-projects.json";
import invalidProjects from "./fixtures/invalid-projects.json";
import {
    CURRENT_DOCUMENT_VERSION,
    CURRENT_PROJECT_DATABASE_VERSION,
    DOCUMENT_ENVELOPE_KIND,
    migrateDocument,
    migrateProjectDatabase,
    PROJECT_DATABASE_KIND,
    runtimeProjects,
    storeRuntimeProjects,
} from "./document-migrations";
import { ProjectService, PROJECT_STORAGE_KEY } from "../../_services/project.service";

describe("document migrations", () => {
    it("wraps an unversioned SVG save without changing its payload", () => {
        const legacyDocument = legacyProjects[0].svgData;
        const result = migrateDocument(legacyDocument);

        expect(result.status).toBe("ok");
        if(result.status !== "ok") return;
        expect(result.migrated).toBeTrue();
        expect(result.value.kind).toBe(DOCUMENT_ENVELOPE_KIND);
        expect(result.value.version).toBe(CURRENT_DOCUMENT_VERSION);
        expect(result.value.data).toEqual({ ...legacyDocument, importedSourceNodes: [] } as any);
    });

    it("migrates the legacy project array into document and database envelopes", () => {
        const result = migrateProjectDatabase(legacyProjects);

        expect(result.status).toBe("ok");
        if(result.status !== "ok") return;
        expect(result.migrated).toBeTrue();
        expect(result.value.kind).toBe(PROJECT_DATABASE_KIND);
        expect(result.value.version).toBe(CURRENT_PROJECT_DATABASE_VERSION);
        expect(result.value.projects[0].document.data).toEqual({ ...legacyProjects[0].svgData, importedSourceNodes: [] } as any);
        expect(runtimeProjects(result.value)[0].svgData).toEqual({ ...legacyProjects[0].svgData, importedSourceNodes: [] } as any);
    });

    it("treats the current fixture as idempotent", () => {
        const result = migrateProjectDatabase(currentProjects);

        expect(result.status).toBe("ok");
        if(result.status !== "ok") return;
        expect(result.migrated).toBeFalse();
        expect(result.value).toEqual(currentProjects as any);
        expect(storeRuntimeProjects(runtimeProjects(result.value))).toEqual(result.value);
    });

    it("sequentially migrates a version-1 document envelope to the current version", () => {
        const result = migrateDocument({
            kind: DOCUMENT_ENVELOPE_KIND,
            version: 1,
            data: legacyProjects[0].svgData,
        });

        expect(result.status).toBe("ok");
        if(result.status !== "ok") return;
        expect(result.migrated).toBeTrue();
        expect(result.value.version).toBe(3);
        expect(result.value.data.importedSourceNodes).toEqual([]);
    });

    it("migrates version 2 documents without changing solid paint or animation tracks", () => {
        const data = {
            ...legacyProjects[0].svgData,
            importedSourceNodes: [],
            animation: {
                version: 1 as const,
                duration: 2,
                tracks: [{ id: "fill-track", targetId: "shape", property: "settings.fill", valueType: "color" as const, keyframes: [] }],
                markers: [],
            },
        };
        const result = migrateDocument({ kind: DOCUMENT_ENVELOPE_KIND, version: 2, data });

        expect(result.status).toBe("ok");
        if(result.status !== "ok") return;
        expect(result.value.version).toBe(3);
        expect(result.value.data).toEqual(data as any);
    });

    it("isolates invalid records while retaining valid projects", () => {
        const result = migrateProjectDatabase(invalidProjects);

        expect(result.status).toBe("ok");
        if(result.status !== "ok") return;
        expect(result.migrated).toBeTrue();
        expect(result.value.projects.map((project) => project.id)).toEqual(["survivor"]);
        expect(result.warnings.some((warning) => warning.includes("Discarded project at index 0"))).toBeTrue();
    });

    it("rejects future storage versions instead of attempting a downgrade", () => {
        const result = migrateProjectDatabase(futureProjects);

        expect(result.status).toBe("unsupported");
        if(result.status !== "unsupported") return;
        expect(result.version).toBe(999);
    });
});

describe("ProjectService migration boundary", () => {
    let originalStorage: string | null;

    beforeEach(() => {
        originalStorage = localStorage.getItem(PROJECT_STORAGE_KEY);
    });

    afterEach(() => {
        if(originalStorage == null) {
            localStorage.removeItem(PROJECT_STORAGE_KEY);
        } else {
            localStorage.setItem(PROJECT_STORAGE_KEY, originalStorage);
        }
    });

    it("rewrites legacy localStorage once and exposes the unchanged runtime record", () => {
        localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(legacyProjects));
        const service = new ProjectService();

        expect(service.list()[0].svgData).toEqual({ ...legacyProjects[0].svgData, importedSourceNodes: [] } as any);
        const persisted = JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!);
        expect(persisted.kind).toBe(PROJECT_DATABASE_KIND);
        expect(persisted.version).toBe(CURRENT_PROJECT_DATABASE_VERSION);
        expect(persisted.projects[0].document.kind).toBe(DOCUMENT_ENVELOPE_KIND);
    });

    it("writes all subsequent saves through the current envelopes", () => {
        localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(currentProjects));
        const service = new ProjectService();
        const document = { ...service.list()[0].svgData, name: "Updated name" };

        service.upsert(document, "<svg>updated</svg>");

        const persisted = JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!);
        expect(persisted.projects[0].name).toBe("Updated name");
        expect(persisted.projects[0].document.data.name).toBe("Updated name");
        expect(persisted.projects[0].createdAt).toBe(300);
    });

    it("does not overwrite data from a future application version", () => {
        const raw = JSON.stringify(futureProjects);
        localStorage.setItem(PROJECT_STORAGE_KEY, raw);
        const service = new ProjectService();

        expect(service.list()).toEqual([]);
        service.upsert({
            id: "old-client-document",
            name: "Old client document",
            width: 10,
            height: 10,
            elements: [],
        }, "<svg></svg>");
        service.remove("anything");
        expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(raw);
    });

    it("does not replace malformed existing storage with defaults", () => {
        localStorage.setItem(PROJECT_STORAGE_KEY, "{not-json");
        const service = new ProjectService();

        expect(service.list()).toEqual([]);
        expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe("{not-json");
    });
});
