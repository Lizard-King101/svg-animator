import { createDocumentEnvelope, migrateProjectDatabase, runtimeProjects, storeRuntimeProjects } from "../editor/migrations/document-migrations";
import { SVGSave } from "../editor/objects/svg.object";

export interface RepositoryProjectRecord {
    id: string;
    name: string;
    thumbnail: string;
    createdAt: number;
    updatedAt: number;
    revision: number;
    svgData: SVGSave;
}

export interface ProjectRepository {
    readonly kind: "indexeddb" | "localstorage" | "memory";
    readonly persistent: boolean;
    initialize(): Promise<void>;
    list(): Promise<RepositoryProjectRecord[]>;
    get(id: string): Promise<RepositoryProjectRecord | null>;
    put(record: RepositoryProjectRecord, thumbnailChanged: boolean): Promise<void>;
    putThumbnail(id: string, revision: number, thumbnail: string): Promise<void>;
    remove(id: string): Promise<void>;
}

const DB_NAME = "svg-animator";
const DB_VERSION = 1;

export class IndexedDbProjectRepository implements ProjectRepository {
    readonly kind = "indexeddb" as const;
    readonly persistent = true;
    private database?: IDBDatabase;

    constructor(private legacyStorageKey: string) {}

    async initialize(): Promise<void> {
        this.database = await openDatabase();
        await this.migrateLegacyOnce();
    }

    async list(): Promise<RepositoryProjectRecord[]> {
        const db = this.requireDatabase();
        const [metadata, documents, thumbnails] = await Promise.all([
            readAll<StoredMetadata>(db, "projects"),
            readAll<{ id: string; document: ReturnType<typeof createDocumentEnvelope> }>(db, "documents"),
            readAll<{ id: string; thumbnail: string }>(db, "thumbnails"),
        ]);
        const documentMap = new Map(documents.map((entry) => [entry.id, entry.document.data]));
        const thumbnailMap = new Map(thumbnails.map((entry) => [entry.id, entry.thumbnail]));
        return metadata.flatMap((entry) => {
            const svgData = documentMap.get(entry.id);
            return svgData ? [{ ...entry, svgData, thumbnail: thumbnailMap.get(entry.id) ?? "" }] : [];
        }).sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async get(id: string): Promise<RepositoryProjectRecord | null> {
        return (await this.list()).find((record) => record.id === id) ?? null;
    }

    async put(record: RepositoryProjectRecord, thumbnailChanged: boolean): Promise<void> {
        const db = this.requireDatabase();
        const stores = thumbnailChanged ? ["projects", "documents", "thumbnails"] : ["projects", "documents"];
        const transaction = db.transaction(stores, "readwrite");
        transaction.objectStore("projects").put(metadataOf(record));
        transaction.objectStore("documents").put({ id: record.id, revision: record.revision, document: createDocumentEnvelope(record.svgData) });
        if(thumbnailChanged) transaction.objectStore("thumbnails").put({ id: record.id, revision: record.revision, thumbnail: record.thumbnail });
        await transactionDone(transaction);
    }

    async remove(id: string): Promise<void> {
        const transaction = this.requireDatabase().transaction(["projects", "documents", "thumbnails"], "readwrite");
        transaction.objectStore("projects").delete(id);
        transaction.objectStore("documents").delete(id);
        transaction.objectStore("thumbnails").delete(id);
        await transactionDone(transaction);
    }

    async putThumbnail(id: string, revision: number, thumbnail: string): Promise<void> {
        const transaction = this.requireDatabase().transaction("thumbnails", "readwrite");
        transaction.objectStore("thumbnails").put({ id, revision, thumbnail });
        await transactionDone(transaction);
    }

    private async migrateLegacyOnce(): Promise<void> {
        const db = this.requireDatabase();
        const completed = await readOne<{ key: string; value: boolean }>(db, "meta", "legacyMigrationComplete");
        if(completed?.value) return;
        const raw = localStorage.getItem(this.legacyStorageKey);
        const parsed = raw == null ? undefined : safeJson(raw);
        const migrated = parsed == null ? undefined : migrateProjectDatabase(parsed);
        const records = migrated?.status === "ok" ? runtimeProjects(migrated.value) : [];
        const transaction = db.transaction(["projects", "documents", "thumbnails", "meta"], "readwrite");
        records.forEach((record, index) => {
            const revision = Math.max(1, records.length - index);
            const repositoryRecord = { ...record, revision };
            transaction.objectStore("projects").put(metadataOf(repositoryRecord));
            transaction.objectStore("documents").put({ id: record.id, revision, document: createDocumentEnvelope(record.svgData) });
            transaction.objectStore("thumbnails").put({ id: record.id, revision, thumbnail: record.thumbnail });
        });
        transaction.objectStore("meta").put({ key: "legacyMigrationComplete", value: true });
        transaction.objectStore("meta").put({ key: "databaseVersion", value: DB_VERSION });
        await transactionDone(transaction);
        if(raw != null && localStorage.getItem(`${this.legacyStorageKey}:legacy-backup-v1`) == null) {
            try { localStorage.setItem(`${this.legacyStorageKey}:legacy-backup-v1`, raw); } catch {}
        }
    }

    private requireDatabase(): IDBDatabase {
        if(!this.database) throw new Error("IndexedDB repository is not initialized.");
        return this.database;
    }
}

export class LocalStorageProjectRepository implements ProjectRepository {
    readonly kind = "localstorage" as const;
    readonly persistent = true;
    constructor(private storageKey: string) {}
    async initialize(): Promise<void> {
        void localStorage.length;
        const raw = localStorage.getItem(this.storageKey);
        if(raw != null && localStorage.getItem(`${this.storageKey}:legacy-backup-v1`) == null) {
            localStorage.setItem(`${this.storageKey}:legacy-backup-v1`, raw);
        }
    }
    async list(): Promise<RepositoryProjectRecord[]> {
        const raw = localStorage.getItem(this.storageKey);
        if(raw == null) return [];
        const migrated = migrateProjectDatabase(JSON.parse(raw));
        if(migrated.status !== "ok") throw new Error("Project storage has an unsupported or invalid format.");
        return runtimeProjects(migrated.value).map((record, index) => ({ ...record, revision: Math.max(1, migrated.value.projects.length - index) }));
    }
    async get(id: string): Promise<RepositoryProjectRecord | null> { return (await this.list()).find((record) => record.id === id) ?? null; }
    async put(record: RepositoryProjectRecord): Promise<void> {
        const records = await this.list();
        const index = records.findIndex((candidate) => candidate.id === record.id);
        if(index >= 0) records[index] = record; else records.unshift(record);
        localStorage.setItem(this.storageKey, JSON.stringify(storeRuntimeProjects(records)));
    }
    async putThumbnail(id: string, _revision: number, thumbnail: string): Promise<void> {
        const record = await this.get(id);
        if(record) await this.put({ ...record, thumbnail });
    }
    async remove(id: string): Promise<void> {
        localStorage.setItem(this.storageKey, JSON.stringify(storeRuntimeProjects((await this.list()).filter((record) => record.id !== id))));
    }
}

export class MemoryProjectRepository implements ProjectRepository {
    readonly kind = "memory" as const;
    readonly persistent = false;
    constructor(private records: RepositoryProjectRecord[] = []) {}
    async initialize(): Promise<void> {}
    async list(): Promise<RepositoryProjectRecord[]> { return this.records; }
    async get(id: string): Promise<RepositoryProjectRecord | null> { return this.records.find((record) => record.id === id) ?? null; }
    async put(record: RepositoryProjectRecord): Promise<void> {
        const index = this.records.findIndex((candidate) => candidate.id === record.id);
        if(index >= 0) this.records[index] = record; else this.records.unshift(record);
    }
    async putThumbnail(id: string, _revision: number, thumbnail: string): Promise<void> {
        const record = await this.get(id);
        if(record) record.thumbnail = thumbnail;
    }
    async remove(id: string): Promise<void> { this.records = this.records.filter((record) => record.id !== id); }
}

export async function createResilientProjectRepository(storageKey: string): Promise<ProjectRepository> {
    if(typeof indexedDB !== "undefined") {
        try {
            const repository = new IndexedDbProjectRepository(storageKey);
            await repository.initialize();
            return repository;
        } catch {}
    }
    try {
        const repository = new LocalStorageProjectRepository(storageKey);
        await repository.initialize();
        return repository;
    } catch {
        const repository = new MemoryProjectRepository();
        await repository.initialize();
        return repository;
    }
}

interface StoredMetadata { id: string; name: string; createdAt: number; updatedAt: number; revision: number; }
function metadataOf(record: RepositoryProjectRecord): StoredMetadata {
    return { id: record.id, name: record.name, createdAt: record.createdAt, updatedAt: record.updatedAt, revision: record.revision };
}

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            ["projects", "documents", "thumbnails"].forEach((name) => { if(!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" }); });
            if(!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB."));
        request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked."));
    });
}

function readAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
    return requestResult(db.transaction(store).objectStore(store).getAll());
}
function readOne<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
    return requestResult(db.transaction(store).objectStore(store).get(key));
}
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
}
function safeJson(raw: string): unknown { try { return JSON.parse(raw); } catch { return undefined; } }
