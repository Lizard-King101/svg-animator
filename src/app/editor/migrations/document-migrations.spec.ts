import legacyProjects from "./fixtures/legacy-projects.json";
import currentProjects from "./fixtures/current-projects-v1.json";
import futureProjects from "./fixtures/future-projects.json";
import invalidProjects from "./fixtures/invalid-projects.json";
import documentV3AnimationV1 from "./fixtures/document-v3-animation-v1.json";
import documentEnvelopeVersions from "./fixtures/document-envelope-versions.json";
import documentV11Attachments from './fixtures/document-v11-attachments.json';
import documentV12IK from './fixtures/document-v12-ik.json';
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
    it('upgrades v11 rigs without inventing targets or changing posed artwork', () => {
        const before = JSON.stringify(documentV11Attachments);
        const result = migrateDocument(documentV11Attachments);
        expect(result.status).toBe('ok');
        if(result.status !== 'ok') return;
        expect(result.value.version).toBe(14);
        expect(result.value.data.rigs?.version).toBe(5);
        expect(result.value.data.rigs?.armatures).toEqual(documentV11Attachments.data.rigs.armatures as any);
        expect(result.value.data.elements).toEqual(documentV11Attachments.data.elements as any);
        expect(result.value.data.rigs?.armatures[0].constraints).toBeUndefined();
        expect(JSON.stringify(documentV11Attachments)).toBe(before);
        const again = migrateDocument(result.value);
        expect(again.status).toBe('ok');
        if(again.status === 'ok') expect(again.migrated).toBeFalse();
    });

    it('round-trips persistent target references and rejects invalid or future constraints', () => {
        const result = migrateDocument(documentV12IK);
        expect(result.status).toBe('ok');
        if(result.status !== 'ok') return;
        expect(result.migrated).toBeTrue();
        expect(result.value.data.rigs?.armatures).toEqual(documentV12IK.data.rigs.armatures as any);
        const again = migrateDocument(result.value);
        expect(again.status).toBe('ok');
        if(again.status === 'ok') expect(again.migrated).toBeFalse();
        const invalid = structuredClone(documentV12IK);
        invalid.data.rigs.armatures[0].constraints[0].targetBoneId = 'lower';
        expect(migrateDocument(invalid).status).toBe('invalid');
        const future = structuredClone(documentV12IK); future.data.rigs.version = 6;
        expect(migrateDocument(future).status).toBe('unsupported');
        const disconnected = structuredClone(documentV12IK); disconnected.data.rigs.armatures[0].bones[2].x = 20;
        expect(migrateDocument(disconnected).status).toBe('invalid');
        disconnected.data.rigs.armatures[0].constraintsActive = false;
        expect(migrateDocument(disconnected).status).toBe('ok');
    });

    it("wraps an unversioned SVG save without changing its payload", () => {
        const legacyDocument = legacyProjects[0].svgData;
        const result = migrateDocument(legacyDocument);

        expect(result.status).toBe("ok");
        if(result.status !== "ok") return;
        expect(result.migrated).toBeTrue();
        expect(result.value.kind).toBe(DOCUMENT_ENVELOPE_KIND);
        expect(result.value.version).toBe(CURRENT_DOCUMENT_VERSION);
        expect(result.value.data.importedSourceNodes).toEqual([]);
        expect((result.value.data.elements[0] as any).settings.stroke_alignment).toBe("center");
    });

    it("migrates the legacy project array into document and database envelopes", () => {
        const result = migrateProjectDatabase(legacyProjects);

        expect(result.status).toBe("ok");
        if(result.status !== "ok") return;
        expect(result.migrated).toBeTrue();
        expect(result.value.kind).toBe(PROJECT_DATABASE_KIND);
        expect(result.value.version).toBe(CURRENT_PROJECT_DATABASE_VERSION);
        expect((result.value.projects[0].document.data.elements[0] as any).settings.stroke_alignment).toBe("center");
        expect((runtimeProjects(result.value)[0].svgData.elements[0] as any).settings.stroke_dasharray).toEqual([]);
    });

    it("treats the current fixture as idempotent", () => {
        const result = migrateProjectDatabase(currentProjects);

        expect(result.status).toBe("ok");
        if(result.status !== "ok") return;
        expect(result.migrated).toBeTrue();
        expect(migrateProjectDatabase(result.value)).toEqual({ status: "ok", value: result.value, migrated: false, warnings: [] });
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
        expect(result.value.version).toBe(CURRENT_DOCUMENT_VERSION);
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
        expect(result.value.version).toBe(CURRENT_DOCUMENT_VERSION);
        expect(result.value.data.animation?.version).toBe(2);
        expect(result.value.data.animation?.tracks).toEqual(data.animation.tracks as any);
    });

    it("migrates document v3 and animation v1 sequentially without changing key semantics", () => {
        const result = migrateDocument(documentV3AnimationV1);
        expect(result.status).toBe("ok");
        if(result.status !== "ok") return;
        expect(result.value.version).toBe(CURRENT_DOCUMENT_VERSION);
        expect(result.value.data.animation?.version).toBe(2);
        expect(result.value.data.animation?.tracks[0].keyframes).toEqual((documentV3AnimationV1.data.animation.tracks[0].keyframes as any));
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

    it("retains immutable representatives for every accepted envelope and rejects the future fixture", () => {
        documentEnvelopeVersions.slice(0, 5).forEach((fixture, index) => {
            const result = migrateDocument(fixture);
            expect(result.status).withContext(`document v${index + 1}`).toBe("ok");
            if(result.status === "ok") expect(result.value.version).toBe(CURRENT_DOCUMENT_VERSION);
        });
        const future = migrateDocument(documentEnvelopeVersions[5]);
        expect(future.status).toBe("unsupported");
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

    it("leaves legacy localStorage read-only while exposing the migrated runtime record", () => {
        const raw = JSON.stringify(legacyProjects);
        localStorage.setItem(PROJECT_STORAGE_KEY, raw);
        const service = new ProjectService();

        expect((service.list()[0].svgData.elements[0] as any).settings.stroke_alignment).toBe("center");
        expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(raw);
    });

    it("writes all subsequent saves through the async repository", async () => {
        localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(currentProjects));
        const service = new ProjectService();
        const document = { ...service.list()[0].svgData, name: "Updated name" };

        service.upsert(document, "<svg>updated</svg>");
        await service.ready;

        const persisted = service.get("current-doc")!;
        expect(persisted.name).toBe("Updated name");
        expect(persisted.svgData.name).toBe("Updated name");
        expect(persisted.createdAt).toBe(300);
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
