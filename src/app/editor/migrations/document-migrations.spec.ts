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
import type { PathSave } from '../objects/elements/path.object';
import type { GroupSave } from '../objects/elements/group.object';
import { AnimationTrack, createDefaultAnimation } from '../objects/animation.object';

describe("document migrations", () => {
    it('migrates legacy clipping sources to hidden artwork without mutating inputs or ordinary visibility', () => {
        const base = migrateDocument(legacyProjects[0].svgData);
        if(base.status !== 'ok') throw new Error('Invalid test fixture');
        const source = { ...base.value.data.elements[0], id: 'source', visible: true };
        const child = { ...source, id: 'detail', visible: false };
        const inner: GroupSave = { type: 'group', id: 'inner', name: 'Inner', visible: true, locked: false,
            clipElementId: source.id, elements: [child, source] };
        const outerMask = { ...source, id: 'outer-source' };
        const outer: GroupSave = { type: 'group', id: 'outer', name: 'Outer', visible: true, locked: false,
            clipElementId: outerMask.id, elements: [inner, outerMask] };
        const data = { ...base.value.data, elements: [outer] };
        const input = { kind: DOCUMENT_ENVELOPE_KIND, version: 16, data };
        const before = JSON.stringify(input);
        const result = migrateDocument(input);
        expect(result.status).toBe('ok');
        if(result.status !== 'ok') return;
        expect(result.value.version).toBe(CURRENT_DOCUMENT_VERSION);
        expect(result.migrated).toBeTrue();
        const migrated = result.value.data.elements[0] as GroupSave;
        expect(migrated.visible).toBeTrue();
        expect(migrated.elements[1].visible).toBeFalse();
        const migratedInner = migrated.elements[0] as GroupSave;
        expect(migratedInner.visible).toBeTrue();
        expect(migratedInner.elements.map(element => element.visible)).toEqual([false, false]);
        expect(JSON.stringify(input)).toBe(before);
        expect(migrateDocument(result.value)).toEqual({ status: 'ok', value: result.value, migrated: false, warnings: [] });
        const unversioned = migrateDocument(data);
        expect(unversioned.status).toBe('ok');
        if(unversioned.status === 'ok') expect(unversioned.value.data.elements).toEqual(result.value.data.elements);
    });

    it('preserves explicit visible clipping artwork in current documents', () => {
        const base = migrateDocument(legacyProjects[0].svgData);
        if(base.status !== 'ok') throw new Error('Invalid test fixture');
        const source = { ...base.value.data.elements[0], id: 'source', visible: true };
        const group: GroupSave = { type: 'group', id: 'group', name: 'Eye', visible: true, locked: false,
            clipElementId: source.id, elements: [source] };
        const envelope = { ...base.value, data: { ...base.value.data, elements: [group] } };
        const result = migrateDocument(JSON.parse(JSON.stringify(envelope)));
        expect(result.status).toBe('ok');
        if(result.status === 'ok') {
            expect(result.migrated).toBeFalse();
            expect(result.value).toEqual(envelope);
            expect((result.value.data.elements[0] as GroupSave).elements[0].visible).toBeTrue();
        }
    });

    it('keeps legacy scene and action clip-source visibility channels hidden without changing their identity or scope', () => {
        const base = migrateDocument(legacyProjects[0].svgData);
        if(base.status !== 'ok') throw new Error('Invalid test fixture');
        const source = { ...base.value.data.elements[0], id: 'source', visible: false };
        const detail = { ...source, id: 'detail', visible: true };
        const group: GroupSave = { type: 'group', id: 'group', name: 'Eye', visible: true, locked: false,
            clipElementId: source.id, elements: [detail, source] };
        const track = (id: string, targetId: string): AnimationTrack => ({ id, targetId, property: 'visible', valueType: 'boolean',
            keyframes: [{ id: `${id}-show`, time: 0, value: true }, { id: `${id}-hide`, time: 1, value: false }] });
        const animation = createDefaultAnimation(), actionAnimation = createDefaultAnimation();
        animation.tracks = [track('scene-source', source.id), track('scene-detail', detail.id)];
        actionAnimation.tracks = [{ ...track('action-source', source.id), enabled: false }, track('action-detail', detail.id)];
        animation.composition = { version: 1, actions: [{ id: 'blink', name: 'Blink', targetIds: [source.id, detail.id], animation: actionAnimation }],
            placements: [{ id: 'blink-placement', actionId: 'blink', start: 0 }] };
        const input = { kind: DOCUMENT_ENVELOPE_KIND, version: 16, data: { ...base.value.data, elements: [group], animation } };
        const before = JSON.stringify(input), result = migrateDocument(input);
        expect(result.status).toBe('ok');
        if(result.status !== 'ok') return;
        const migrated = result.value.data.animation!;
        const expected = (value: AnimationTrack) => ({ ...value, keyframes: value.keyframes.map(key => ({ ...key, value: false })) });
        expect(migrated.tracks[0]).toEqual(expected(animation.tracks[0]));
        expect(migrated.tracks[1]).toEqual(animation.tracks[1]);
        const action = migrated.composition!.actions[0];
        expect(action.animation.tracks[0]).toEqual(expected(actionAnimation.tracks[0]));
        expect(action.animation.tracks[1]).toEqual(actionAnimation.tracks[1]);
        expect(action.targetIds).toEqual(animation.composition.actions[0].targetIds);
        expect(migrated.composition!.placements).toEqual(animation.composition.placements);
        expect(JSON.stringify(input)).toBe(before);
        expect(migrateDocument(result.value)).toEqual({ status: 'ok', value: result.value, migrated: false, warnings: [] });
    });

    it('upgrades v11 rigs without inventing targets or changing posed artwork', () => {
        const before = JSON.stringify(documentV11Attachments);
        const result = migrateDocument(documentV11Attachments);
        expect(result.status).toBe('ok');
        if(result.status !== 'ok') return;
        expect(result.value.version).toBe(CURRENT_DOCUMENT_VERSION);
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
        const future = structuredClone(documentV12IK); future.data.rigs.version = 7;
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

    it('normalizes omitted legacy tracks after clipping migration without mutating the source', () => {
        const data = { ...legacyProjects[0].svgData, animation: { version: 1, duration: 2, markers: [] } };
        for(const input of [data, { kind: DOCUMENT_ENVELOPE_KIND, version: 3, data }]) {
            const before = JSON.stringify(input);
            const result = migrateDocument(input);
            expect(result.status).toBe('ok');
            if(result.status === 'ok') {
                expect(result.value.data.animation?.version).toBe(2);
                expect(result.value.data.animation?.tracks).toEqual([]);
            }
            expect(JSON.stringify(input)).toBe(before);
        }
    });

    it('normalizes omitted legacy visibility keyframes while preserving the hidden clipping source', () => {
        const source = { ...legacyProjects[0].svgData.elements[0], id: 'source', visible: true };
        const group = { type: 'group', id: 'group', name: 'Eye', visible: true, locked: false,
            clipElementId: source.id, elements: [source] };
        const track = { id: 'source-visibility', targetId: source.id, property: 'visible', valueType: 'boolean' };
        const input = { kind: DOCUMENT_ENVELOPE_KIND, version: 3,
            data: { ...legacyProjects[0].svgData, elements: [group], animation: { version: 1, duration: 2, tracks: [track], markers: [] } } };
        const before = JSON.stringify(input), result = migrateDocument(input);
        expect(result.status).toBe('ok');
        if(result.status === 'ok') {
            expect(result.value.data.animation?.tracks).toEqual([{ ...track, keyframes: [] }] as AnimationTrack[]);
            expect((result.value.data.elements[0] as GroupSave).elements[0].visible).toBeFalse();
        }
        expect(JSON.stringify(input)).toBe(before);

        // Legacy restoration already discards empty keys; preserving them here
        // allows that normalization without losing the valid visibility key.
        const withKeys = { ...input, data: { ...input.data, animation: { ...input.data.animation,
            tracks: [{ ...track, keyframes: [null, { id: 'show', time: 0, value: true }] }] } } };
        const keysResult = migrateDocument(withKeys);
        expect(keysResult.status).toBe('ok');
        if(keysResult.status === 'ok') expect(keysResult.value.data.animation?.tracks[0].keyframes)
            .toEqual([{}, { id: 'show', time: 0, value: false }] as AnimationTrack['keyframes']);
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

describe('outline metadata migration validation', () => {
    const section = () => ({ id: 'outline', contourId: 'contour', start: { segmentId: 'line-1', t: 0 }, end: { segmentId: 'line-1', t: 1 } });
    function fixture(outlineSections: unknown) {
        const legacy = structuredClone(legacyProjects[0].svgData), source = legacy.elements[0];
        const path: Record<string, unknown> = { ...source, contours: [{ id: 'contour', closed: false, lines: source.lines }], outlineSections };
        return { kind: DOCUMENT_ENVELOPE_KIND, version: CURRENT_DOCUMENT_VERSION, data: { ...legacy, elements: [path] } };
    }

    it('preserves absent and explicitly empty outlines, including legacy line-only paths', () => {
        for(const sections of [undefined, []]) {
            const input = fixture(sections);
            if(sections === undefined) delete input.data.elements[0]['outlineSections'];
            const result = migrateDocument(input); expect(result.status).toBe('ok');
            if(result.status === 'ok') {
                expect((result.value.data.elements[0] as PathSave).outlineSections).toEqual(sections);
                expect('outlineSections' in result.value.data.elements[0]).toBe(sections !== undefined);
                const reopened = migrateDocument(result.value); expect(reopened.status).toBe('ok');
                if(reopened.status === 'ok') expect(reopened.migrated).toBeFalse();
            }
        }
        const legacy = fixture([]); delete legacy.data.elements[0]['contours'];
        expect(migrateDocument(legacy).status).toBe('ok');
        legacy.data.elements[0]['outlineSections'] = [section()];
        expect(migrateDocument(legacy).status).toBe('invalid');
    });

    it('validates sections recursively inside nested artwork groups without changing their data', () => {
        const input = fixture([section()]), path = input.data.elements[0];
        input.data.elements = [{ type: 'group', id: 'outer', elements: [{ type: 'group', id: 'inner', elements: [path] }] }];
        const before = JSON.stringify(input);
        expect(migrateDocument(input).status).toBe('ok'); expect(JSON.stringify(input)).toBe(before);
        path['outlineSections'] = [{ ...section(), end: { segmentId: 'missing', t: .5 } }];
        expect(migrateDocument(input).status).toBe('invalid');
    });

    it('rejects malformed metadata lists, missing addresses, overlapping ranges, and invalid tapers', () => {
        const invalid: unknown[] = [null, {}, 'outline', [null], [[]], [0],
            [{ ...section(), contourId: 'missing' }], [{ ...section(), start: null }],
            [{ ...section(), end: { segmentId: 'missing', t: .5 } }], [{ ...section(), end: { segmentId: 'line-1', t: 2 } }],
            [section(), { ...section(), id: 'overlap', start: { segmentId: 'line-1', t: .5 } }], [section(), section()],
            [{ ...section(), startTaper: { length: -1, tipWidth: 0 } }], [{ ...section(), endTaper: { length: .2, tipWidth: 2 } }],
            [{ ...section(), startTaper: { length: .8, tipWidth: 0 }, endTaper: { length: .4, tipWidth: 0 } }],
            [{ ...section(), startTaper: null }], [{ ...section(), endTaper: false }], [{ ...section(), fullContour: 'yes' }],
        ];
        for(const value of invalid) expect(migrateDocument(fixture(value)).status).withContext(JSON.stringify(value)).toBe('invalid');
    });

    it('accepts touching ranges and implicit closing-edge addresses, but refuses malformed source geometry safely', () => {
        const touching = fixture([{ ...section(), end: { segmentId: 'line-1', t: .5 } },
            { ...section(), id: 'next', start: { segmentId: 'line-1', t: .5 } }]);
        expect(migrateDocument(touching).status).toBe('ok');
        const closing = fixture([{ ...section(), start: { segmentId: 'contour:close', t: .2 }, end: { segmentId: 'contour:close', t: .8 } }]);
        (closing.data.elements[0]['contours'] as { closed: boolean }[])[0].closed = true;
        expect(migrateDocument(closing).status).toBe('ok');
        for(const contours of [null, [null], [{ id: 'contour', closed: false, lines: null }],
            [{ id: 'contour', closed: false, lines: [null] }],
            [{ id: 'contour', closed: false, lines: [{ id: 'line-1', type: 'line', points: [null, null] }] }]]) {
            const input = fixture([section()]); input.data.elements[0]['contours'] = contours;
            expect(() => migrateDocument(input)).not.toThrow(); expect(migrateDocument(input).status).toBe('invalid');
        }
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
