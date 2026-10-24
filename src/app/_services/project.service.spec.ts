import { LocalStorageProjectRepository, MemoryProjectRepository, RepositoryProjectRecord } from './project-repository';
import { ProjectRecord, ProjectService } from './project.service';

describe('Project deletion recovery and write ordering', () => {
    const record = (id: string): RepositoryProjectRecord => ({
        id, name: id, createdAt: 10, updatedAt: 20, revision: 7, thumbnail: '<svg/>',
        svgData: { id, name: id, width: 10, height: 10, elements: [] },
    });
    let repository: MemoryProjectRepository;
    let service: ProjectService;

    beforeEach(async () => {
        repository = new MemoryProjectRepository([record('a'), record('b'), record('c')]);
        service = new ProjectService(async () => repository);
        await service.ready;
    });

    it('undoes multiple deletions in reverse order, preserving documents, thumbnails, dates, and order', async () => {
        const original = structuredClone(service.list());
        service.remove('b');
        service.remove('a');
        expect(service.deletedCount).toBe(2);
        expect(service.lastDeletedProject?.id).toBe('a');
        expect(service.undoDelete()?.id).toBe('a');
        expect(service.undoDelete()?.id).toBe('b');
        expect(service.undoDelete()).toBeUndefined();
        await service.flush();
        expect(service.list()).toEqual(original);
        expect<ProjectRecord[]>((await repository.list()).sort((a, b) => a.id.localeCompare(b.id))).toEqual(original);
        expect(service.deletedCount).toBe(0);
    });

    it('serializes an unfinished save, deletion, and immediate undo', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => release = resolve);
        const put = repository.put.bind(repository);
        spyOn(repository, 'put').and.callFake(async (value) => { await gate; await put(value); });
        service.upsert({ ...record('a').svgData, name: 'Latest artwork' }, '<svg>latest</svg>');
        const expected = structuredClone(service.get('a'));
        service.remove('a');
        service.undoDelete();
        release();
        await service.flush();
        expect<ProjectRecord | null>(await repository.get('a')).toEqual(expected);
    });

    it('does not let a late thumbnail update resurrect a deleted project', async () => {
        service.updateThumbnail('a', '<svg>new</svg>', 7);
        service.remove('a');
        service.updateThumbnail('a', '<svg>late</svg>', 7);
        await service.flush();
        expect(await repository.get('a')).toBeNull();
        service.undoDelete();
        await service.flush();
        expect((await repository.get('a'))?.thumbnail).toBe('<svg>new</svg>');
    });

    it('waits for an in-flight deletion before persisting its restoration', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => release = resolve);
        const remove = repository.remove.bind(repository);
        spyOn(repository, 'remove').and.callFake(async (id) => { await gate; await remove(id); });
        service.remove('a');
        service.undoDelete();
        release();
        await service.flush();
        expect(await repository.get('a')).toEqual(record('a'));
    });

    it('persists an empty gallery without reseeding starter projects on reload', async () => {
        service.list().forEach((project) => service.remove(project.id));
        await service.flush();
        const reloaded = new ProjectService(async () => repository);
        await reloaded.ready;
        expect(reloaded.list()).toEqual([]);
        expect(reloaded.deletedCount).toBe(0);
    });

    it('ignores missing deletes and cannot undo over a newer project with the same ID', async () => {
        service.remove('missing');
        expect(service.deletedCount).toBe(0);
        service.remove('a');
        service.upsert({ ...record('a').svgData, name: 'New version' }, '<svg/>');
        expect(service.undoDelete()).toBeUndefined();
        await service.flush();
        expect((await repository.get('a'))?.name).toBe('New version');
    });

    it('recognizes a deliberately empty localStorage repository across sessions', async () => {
        const key = `project-recovery-test-${crypto.randomUUID()}`;
        const storage = new LocalStorageProjectRepository(key);
        try {
            expect(await storage.hasSavedProjects()).toBeFalse();
            await storage.put(record('only'));
            await storage.remove('only');
            const reopened = new LocalStorageProjectRepository(key);
            expect(await reopened.hasSavedProjects()).toBeTrue();
            expect(await reopened.list()).toEqual([]);
        } finally { localStorage.removeItem(key); }
    });

    it('picks unique names, renames in place, and duplicates under a new identity', async () => {
        expect(service.uniqueName('Untitled')).toBe('Untitled');
        expect(service.uniqueName('A')).toBe('A 2');
        expect(service.uniqueName('  ')).toBe('Untitled');

        expect(service.rename('a', '  ')).toBeUndefined();
        expect(service.rename('a', 'a')).toBeUndefined();
        const renamed = service.rename('a', '  Logo  ')!;
        expect(renamed.name).toBe('Logo');
        expect(renamed.svgData.name).toBe('Logo');
        expect(renamed.thumbnail).toBe('<svg/>');
        expect(renamed.createdAt).toBe(10);
        expect(service.uniqueName('logo')).toBe('logo 2');

        const copy = service.duplicate('a')!;
        expect(copy.id).not.toBe('a');
        expect(copy.svgData.id).toBe(copy.id);
        expect(copy.name).toBe('Logo copy');
        expect(service.duplicate('a')!.name).toBe('Logo copy 2');
        copy.svgData.width = 999;
        expect(service.get('a')!.svgData.width).toBe(10);
        await service.flush();
        expect((await repository.list()).map((project) => project.name).sort()).toEqual(['Logo', 'Logo copy', 'Logo copy 2', 'b', 'c']);
    });

    it('restores a missing bundled project once and keeps an existing copy', async () => {
        const bundled = { ...record('banner'), name: 'Welcome Banner' };
        const restored = service.ensurePreloaded(bundled);
        expect(restored.id).toBe('banner');
        expect(restored.svgData).not.toBe(bundled.svgData);
        service.rename('banner', 'My banner');
        expect(service.ensurePreloaded(bundled).name).toBe('My banner');
        await service.flush();
        expect((await repository.list()).filter((project) => project.id === 'banner').length).toBe(1);
    });
});
