import { Inject, Injectable, InjectionToken } from '@angular/core';
import { SVGSave } from '../editor/objects/svg.object';
import {
    migrateProjectDatabase,
    ProjectDatabaseV1,
    runtimeProjects,
} from '../editor/migrations/document-migrations';
import {
    createResilientProjectRepository,
    LocalStorageProjectRepository,
    MemoryProjectRepository,
    ProjectRepository,
    RepositoryProjectRecord,
} from './project-repository';
import { PRELOADED_PROJECTS } from './preloaded-projects';

export interface ProjectRecord {
    id: string;
    name: string;
    thumbnail: string;
    createdAt: number;
    updatedAt: number;
    svgData: SVGSave;
    revision?: number;
}

const DEFAULT_PROJECT = PRELOADED_PROJECTS;

export const PROJECT_STORAGE_KEY = 'svg-animator-projects';
export const PROJECT_REPOSITORY_FACTORY = new InjectionToken<typeof createResilientProjectRepository>('Project repository factory', {
    providedIn: 'root', factory: () => createResilientProjectRepository,
});

type PendingProjectWrite = { record: RepositoryProjectRecord; thumbnailChanged: boolean } | null;

@Injectable({ providedIn: 'root' })
export class ProjectService {
    loading = true;
    error?: string;
    savingWarning?: string;
    readonly ready: Promise<void>;
    private projects: ProjectRecord[] = [];
    private repository?: ProjectRepository;
    private pending = new Map<string, PendingProjectWrite>();
    private drainPromise?: Promise<void>;
    private repositoryReady = false;
    private deleted: { record: ProjectRecord; index: number }[] = [];

    constructor(@Inject(PROJECT_REPOSITORY_FACTORY) private repositoryFactory = createResilientProjectRepository) {
        const stored = this.readStorage();
        if(stored.status === 'ok') this.projects = runtimeProjects(stored.database);
        if(stored.status === 'missing' || (stored.status === 'ok' && this.projects.length === 0)) {
            this.projects = DEFAULT_PROJECT.map((project, index) => ({ ...project, revision: DEFAULT_PROJECT.length - index }));
        }
        this.ready = this.initializeRepository();
    }

    list(): ProjectRecord[] {
        return [...this.projects];
    }

    async listAsync(): Promise<ProjectRecord[]> { await this.ready; return this.list(); }

    get(id: string): ProjectRecord | null {
        return this.projects.find(p => p.id === id) ?? null;
    }

    async getAsync(id: string): Promise<ProjectRecord | null> { await this.ready; return this.get(id); }

    get lastDeletedProject(): ProjectRecord | undefined { return this.deleted.at(-1)?.record; }
    get deletedCount(): number { return this.deleted.length; }

    /** Wait for queued writes, including deletes/restores, to reach the repository. */
    async flush(): Promise<void> {
        await this.ready;
        do { await this.drainPending(); } while(this.pending.size || this.drainPromise);
    }

    upsert(svgData: SVGSave, thumbnail: string, options: { thumbnailChanged?: boolean } = {}): void {
        const idx = this.projects.findIndex(p => p.id === svgData.id);
        const now = Date.now();
        const record: ProjectRecord = {
            id: svgData.id,
            name: svgData.name,
            thumbnail,
            createdAt: idx >= 0 ? this.projects[idx].createdAt : now,
            updatedAt: now,
            svgData,
            revision: (idx >= 0 ? this.projects[idx].revision ?? 0 : 0) + 1,
        };
        if (idx >= 0) {
            this.projects[idx] = record;
        } else {
            this.projects.unshift(record);
        }
        this.deleted = this.deleted.filter((entry) => entry.record.id !== record.id);
        this.queuePut(record, options.thumbnailChanged !== false);
    }

    remove(id: string): void {
        const index = this.projects.findIndex((project) => project.id === id);
        if(index < 0) return;
        this.deleted.push({ record: structuredClone(this.projects[index]), index });
        this.projects = this.projects.filter(p => p.id !== id);
        this.pending.set(id, null);
        void this.drainPending();
    }

    undoDelete(): ProjectRecord | undefined {
        const deleted = this.deleted.pop();
        if(!deleted) return undefined;
        this.projects.splice(Math.min(deleted.index, this.projects.length), 0, deleted.record);
        this.queuePut(deleted.record, true);
        return deleted.record;
    }

    updateThumbnail(id: string, thumbnail: string, revision?: number): void {
        const record = this.projects.find((candidate) => candidate.id === id);
        if(!record || (revision != null && (record.revision ?? 0) > revision)) return;
        const updated = { ...record, thumbnail };
        this.projects[this.projects.indexOf(record)] = updated;
        this.queuePut(updated, true);
    }

    private async initializeRepository(): Promise<void> {
        try {
            this.repository = await this.repositoryFactory(PROJECT_STORAGE_KEY);
            const records = await this.repository.list();
            if(records.length || await this.repository.hasSavedProjects()) {
                this.projects = [...records];
                this.pending.forEach((entry, id) => {
                    if(!entry) {
                        this.projects = this.projects.filter((record) => record.id !== id);
                        return;
                    }
                    const { record } = entry;
                    const index = this.projects.findIndex((candidate) => candidate.id === record.id);
                    if(index >= 0) this.projects[index] = record; else this.projects.unshift(record);
                });
            }
            else this.projects.forEach((record) => {
                if(!this.pending.has(record.id)) this.pending.set(record.id, { record: record as RepositoryProjectRecord, thumbnailChanged: true });
            });
            if(!this.repository.persistent) this.savingWarning = 'Changes are not being saved. They will be lost when this tab closes.';
            this.repositoryReady = true;
            await this.drainPending();
        } catch(error) {
            this.error = error instanceof Error ? error.message : 'Unable to initialize project storage.';
            this.failToMemory();
        } finally {
            this.repositoryReady = true;
            this.loading = false;
        }
    }

    private queuePut(record: ProjectRecord, thumbnailChanged: boolean): void {
        const previous = this.pending.get(record.id);
        this.pending.set(record.id, {
            record: record as RepositoryProjectRecord,
            thumbnailChanged: thumbnailChanged || previous?.thumbnailChanged === true,
        });
        void this.drainPending();
    }

    private drainPending(): Promise<void> {
        if(this.drainPromise) return this.drainPromise;
        if(!this.repositoryReady || !this.repository) return Promise.resolve();
        this.drainPromise = this.writePending().finally(() => {
            this.drainPromise = undefined;
            if(this.pending.size) void this.drainPending();
        });
        return this.drainPromise;
    }

    private async writePending(): Promise<void> {
        try {
            while(this.pending.size) {
                const [id, entry] = this.pending.entries().next().value!;
                this.pending.delete(id);
                try {
                    await this.writeEntry(id, entry);
                } catch {
                    await this.fallbackRepository();
                    await this.writeEntry(id, entry);
                }
            }
        } catch {
            this.failToMemory();
            this.pending.clear();
        }
    }

    private writeEntry(id: string, entry: PendingProjectWrite): Promise<void> {
        return entry ? this.repository!.put(entry.record, entry.thumbnailChanged) : this.repository!.remove(id);
    }

    private async fallbackRepository(): Promise<void> {
        if(this.repository?.kind === 'indexeddb') {
            const fallback = new LocalStorageProjectRepository(PROJECT_STORAGE_KEY);
            await fallback.initialize();
            for(const record of this.projects) await fallback.put(record as RepositoryProjectRecord);
            this.repository = fallback;
            return;
        }
        this.failToMemory();
    }

    private failToMemory(): void {
        this.repository = new MemoryProjectRepository(this.projects as RepositoryProjectRecord[]);
        this.savingWarning = 'Changes are not being saved. They will be lost when this tab closes.';
    }

    private readStorage(): StorageReadResult {
        const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
        if(raw == null) return { status: 'missing' };
        try {
            const migrated = migrateProjectDatabase(JSON.parse(raw));
            if(migrated.status !== 'ok') {
                return { status: migrated.status };
            }
            return {
                status: 'ok',
                database: migrated.value,
                migrated: migrated.migrated,
            };
        } catch {
            return { status: 'invalid' };
        }
    }

}

type StorageReadResult = {
    status: 'ok';
    database: ProjectDatabaseV1;
    migrated: boolean;
} | {
    status: 'missing' | 'invalid' | 'unsupported';
};
