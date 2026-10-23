import { ElementFactory } from './element-factory.service';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { ProjectFileImportService, MAX_PROJECT_IMPORT_BYTES } from './project-file-import.service';
import { ProjectExportService } from './project-export.service';
import { ProjectService } from './project.service';
import { MemoryProjectRepository } from './project-repository';
import { PRELOADED_PROJECTS } from './preloaded-projects';
import { SVGImporterService } from '../editor/import/svg-importer.service';
import { parseProjectJSON } from '../editor/import/project-json-import';
import versions from '../editor/migrations/fixtures/document-envelope-versions.json';
import { Path } from '../editor/objects/elements/path.object';
import { Line } from '../editor/objects/line.object';
import { Point } from '../editor/objects/point.object';

describe('Project file import', () => {
    let projects: ProjectService;
    let importer: ProjectFileImportService;
    let exporter: ProjectExportService;

    beforeEach(async () => {
        projects = new ProjectService(async () => new MemoryProjectRepository([]));
        await projects.ready;
        importer = new ProjectFileImportService(projects, new SVGImporterService(), new ElementFactory(new EditorService(new EditorPreferencesService())));
        exporter = new ProjectExportService();
    });

    it('round-trips both starter projects without changing internal artwork or animation IDs', async () => {
        const save = spyOn(projects, 'upsert').and.callThrough();
        for(const original of PRELOADED_PROJECTS) {
            const source = structuredClone(original);
            source.svgData.guides = [{ id: 'guide', axis: 'x', value: 12.5 }];
            source.svgData.guidesLocked = true;
            source.svgData.animation!.tracks.push({
                id: 'orphan', targetId: 'missing-layer', property: 'opacity', valueType: 'number',
                keyframes: [{ id: 'outside', time: -1, value: 0.3, temporal: { linked: false, out: { speed: 3, influence: 0.5 } } }],
            });
            projects.upsert(source.svgData, source.thumbnail);
            const originalRecord = structuredClone(projects.get(source.id));
            const exported = exporter.build(source);
            save.calls.reset();
            const file = new File([exported.content as string], exported.filename, { type: exported.mimeType });
            await importer.import(file);
            expect(save).toHaveBeenCalledTimes(1);
            const imported = projects.list()[0];
            expect(imported.id).not.toBe(source.id);
            expect(imported.name).toBe(`${source.name} (imported)`);
            expect({ ...imported.svgData, id: source.id, name: source.name }).toEqual(source.svgData);
            expect(projects.get(source.id)).toEqual(originalRecord);
            expect(imported.thumbnail).toContain('<svg');

        }
    });

    it('accepts legacy saves and each supported envelope, including a UTF-8 BOM', () => {
        versions.slice(0, 5).forEach((version) => expect(parseProjectJSON(JSON.stringify(version)).document.id).toBe(version.data.id));
        expect(parseProjectJSON('\uFEFF' + JSON.stringify(versions[0].data)).migrated).toBeTrue();
    });

    it('preserves a saved pen path with an unfinished final segment', async () => {
        const editor = new EditorService(new EditorPreferencesService());
        const path = new Path(editor);
        path.lines.push(new Line(editor, { points: [new Point(4, 5)] }));
        const source = { ...versions[4].data, elements: [path.save()] };
        await importer.import(new File([JSON.stringify(source)], 'unfinished.json'));
        expect(projects.list()[0].svgData.elements).toEqual(JSON.parse(JSON.stringify(source.elements)));
    });

    it('rejects malformed, future, and unsupported artwork before saving anything', async () => {
        const save = spyOn(projects, 'upsert').and.callThrough();
        const valid = versions[4];
        const files = [
            '{broken', JSON.stringify(versions[5]),
            JSON.stringify({ ...valid, data: { ...valid.data, animation: { version: 99, tracks: [] } } }),
            JSON.stringify({ ...valid, data: { ...valid.data, elements: [{ type: 'future-element' }] } }),
            JSON.stringify({ ...valid, data: { ...valid.data, animation: { version: 2, duration: 1, tracks: 'bad' } } }),
        ];
        for(const source of files) await expectAsync(importer.import(new File([source], 'bad.json'))).toBeRejectedWithError();
        expect(save).not.toHaveBeenCalled();
        expect(projects.list()).toEqual([]);
    });

    it('rejects oversized files before reading them', async () => {
        const file = { name: 'large.json', type: 'application/json', size: MAX_PROJECT_IMPORT_BYTES + 1, text: jasmine.createSpy('text') } as unknown as File;
        await expectAsync(importer.import(file)).toBeRejectedWithError(/50 MB/);
        expect(file.text).not.toHaveBeenCalled();
    });

    it('sanitizes preserved SVG before saving or exporting while retaining safe artwork', async () => {
        const data = {
            ...versions[4].data,
            importedSourceNodes: [{ id: 'source', parentId: null, tagName: 'g', markup: '<g onclick="alert(1)"><script>alert(1)</script><circle r="5"/><image href="https://example.com/track"/></g>' }],
        };
        const message = await importer.import(new File([JSON.stringify(data)], 'source.json'));
        const saved = projects.list()[0];
        const json = exporter.build(saved).content as string;
        expect(json).not.toContain('onclick');
        expect(json).not.toContain('<script');
        expect(json).not.toContain('example.com');
        expect(json).toContain('<circle');
        expect(message).toContain('Removed 3 unsafe items');
    });

    it('keeps SVG import and its editability report available', async () => {
        const message = await importer.import(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="10" height="10"/></svg>'], 'shape.svg'));
        expect(message).toContain('1 editable element');
        expect(projects.list()[0].svgData.elements[0].type).toBe('shape');
    });
});
