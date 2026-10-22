import { Injectable } from '@angular/core';
import { SVGSave } from '../editor/objects/svg.object';
import {
    migrateProjectDatabase,
    ProjectDatabaseV1,
    runtimeProjects,
    storeRuntimeProjects,
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

@Injectable({ providedIn: 'root' })
export class ProjectService {
    loading = true;
    error?: string;
    savingWarning?: string;
    readonly ready: Promise<void>;
    private projects: ProjectRecord[] = [];
    private repository?: ProjectRepository;
    private pending = new Map<string, { record: RepositoryProjectRecord; thumbnailChanged: boolean }>();
    private draining = false;

    constructor() {
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
        this.pending.set(record.id, { record: record as RepositoryProjectRecord, thumbnailChanged: options.thumbnailChanged !== false });
        void this.drainPending();
    }

    remove(id: string): void {
        this.projects = this.projects.filter(p => p.id !== id);
        this.pending.delete(id);
        void this.ready.then(() => this.repository?.remove(id)).catch(() => this.failToMemory());
    }

    updateThumbnail(id: string, thumbnail: string, revision?: number): void {
        const record = this.projects.find((candidate) => candidate.id === id);
        if(!record || (revision != null && (record.revision ?? 0) > revision)) return;
        record.thumbnail = thumbnail;
        void this.ready.then(() => this.repository?.putThumbnail(id, record.revision ?? revision ?? 0, thumbnail)).catch(() => this.failToMemory());
    }

    private async initializeRepository(): Promise<void> {
        try {
            this.repository = await createResilientProjectRepository(PROJECT_STORAGE_KEY);
            const records = await this.repository.list();
            if(records.length) {
                this.projects = records;
                this.pending.forEach(({ record }) => {
                    const index = this.projects.findIndex((candidate) => candidate.id === record.id);
                    if(index >= 0) this.projects[index] = record; else this.projects.unshift(record);
                });
            }
            else this.projects.forEach((record) => this.pending.set(record.id, { record: record as RepositoryProjectRecord, thumbnailChanged: true }));
            if(!this.repository.persistent) this.savingWarning = 'Changes are not being saved. They will be lost when this tab closes.';
            await this.drainPending();
        } catch(error) {
            this.error = error instanceof Error ? error.message : 'Unable to initialize project storage.';
            this.failToMemory();
        } finally {
            this.loading = false;
        }
    }

    private async drainPending(): Promise<void> {
        if(this.draining) return;
        await this.readyIfAssigned();
        if(!this.repository) return;
        this.draining = true;
        try {
            while(this.pending.size) {
                const entry = [...this.pending.values()].sort((a, b) => a.record.revision - b.record.revision).at(-1)!;
                this.pending.delete(entry.record.id);
                try {
                    await this.repository.put(entry.record, entry.thumbnailChanged);
                } catch {
                    await this.fallbackRepository();
                    await this.repository.put(entry.record, entry.thumbnailChanged);
                }
            }
        } catch {
            this.failToMemory();
        } finally {
            this.draining = false;
        }
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

    private async readyIfAssigned(): Promise<void> {
        // Constructor writes can arrive before `ready` is assigned. A microtask
        // lets assignment complete without recursively awaiting `ready` itself.
        if(!this.repository) await Promise.resolve();
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
