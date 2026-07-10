import { SVGSave } from "../objects/svg.object";

export const DOCUMENT_ENVELOPE_KIND = "svg-animator/document" as const;
export const PROJECT_DATABASE_KIND = "svg-animator/project-database" as const;
export const CURRENT_DOCUMENT_VERSION = 3 as const;
export const CURRENT_PROJECT_DATABASE_VERSION = 1 as const;

export interface DocumentEnvelopeV1 {
    kind: typeof DOCUMENT_ENVELOPE_KIND;
    version: 1;
    data: SVGSave;
}

export interface DocumentEnvelopeV2 {
    kind: typeof DOCUMENT_ENVELOPE_KIND;
    version: 2;
    data: SVGSave;
}

export interface DocumentEnvelopeV3 {
    kind: typeof DOCUMENT_ENVELOPE_KIND;
    version: typeof CURRENT_DOCUMENT_VERSION;
    data: SVGSave;
}

export interface StoredProjectV1 {
    id: string;
    name: string;
    thumbnail: string;
    createdAt: number;
    updatedAt: number;
    document: DocumentEnvelopeV3;
}

export interface ProjectDatabaseV1 {
    kind: typeof PROJECT_DATABASE_KIND;
    version: typeof CURRENT_PROJECT_DATABASE_VERSION;
    projects: StoredProjectV1[];
}

export interface RuntimeProjectRecord {
    id: string;
    name: string;
    thumbnail: string;
    createdAt: number;
    updatedAt: number;
    svgData: SVGSave;
}

export type MigrationResult<T> = MigrationSuccess<T> | MigrationFailure;

export interface MigrationSuccess<T> {
    status: "ok";
    value: T;
    migrated: boolean;
    warnings: string[];
}

export interface MigrationFailure {
    status: "invalid" | "unsupported";
    warnings: string[];
    version?: number;
}

export function createDocumentEnvelope(document: SVGSave): DocumentEnvelopeV3 {
    return {
        kind: DOCUMENT_ENVELOPE_KIND,
        version: CURRENT_DOCUMENT_VERSION,
        data: document,
    };
}

/** Migrates one persisted document without constructing editor model objects. */
export function migrateDocument(input: unknown): MigrationResult<DocumentEnvelopeV3> {
    if(isRecord(input) && input["kind"] === DOCUMENT_ENVELOPE_KIND) {
        const version = numericVersion(input["version"]);
        if(version === 1) {
            if(!isSVGSave(input["data"])) return invalid("Document v1 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(withImportedSourceNodes(input["data"])), true, ["Migrated document version 1 to version 3."]);
        }
        if(version === 2) {
            if(!isSVGSave(input["data"])) return invalid("Document v2 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(input["data"]), true, ["Migrated document version 2 to version 3 for native paint values."]);
        }
        if(version !== CURRENT_DOCUMENT_VERSION) return unsupported("document", version);
        if(!isSVGSave(input["data"])) {
            return invalid("Document v3 contains an invalid SVG payload.");
        }
        return success(input as unknown as DocumentEnvelopeV3, false);
    }

    if(isSVGSave(input)) {
        return success(createDocumentEnvelope(withImportedSourceNodes(input)), true, ["Migrated an unversioned document to version 3."]);
    }

    return invalid("Value is neither a legacy SVG document nor a supported document envelope.");
}

function withImportedSourceNodes(document: SVGSave): SVGSave {
    return {
        ...document,
        importedSourceNodes: Array.isArray(document.importedSourceNodes) ? document.importedSourceNodes : [],
    };
}

/**
 * Accepts the historic raw project array and the current database envelope.
 * Invalid project entries are isolated and discarded; an unsupported database
 * version rejects the entire value so an older client never rewrites it.
 */
export function migrateProjectDatabase(input: unknown): MigrationResult<ProjectDatabaseV1> {
    if(Array.isArray(input)) {
        return migrateProjectList(input, true);
    }

    if(!isRecord(input) || input["kind"] !== PROJECT_DATABASE_KIND) {
        return invalid("Project storage is not a legacy array or a supported database envelope.");
    }

    const version = numericVersion(input["version"]);
    if(version !== CURRENT_PROJECT_DATABASE_VERSION) {
        return unsupported("project database", version);
    }
    if(!Array.isArray(input["projects"])) {
        return invalid("Project database v1 is missing its projects array.");
    }

    return migrateProjectList(input["projects"], false);
}

export function runtimeProjects(database: ProjectDatabaseV1): RuntimeProjectRecord[] {
    return database.projects.map((project) => ({
        id: project.id,
        name: project.name,
        thumbnail: project.thumbnail,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        svgData: project.document.data,
    }));
}

export function storeRuntimeProjects(projects: RuntimeProjectRecord[]): ProjectDatabaseV1 {
    return {
        kind: PROJECT_DATABASE_KIND,
        version: CURRENT_PROJECT_DATABASE_VERSION,
        projects: projects.map(storeRuntimeProject),
    };
}

function migrateProjectList(input: unknown[], legacyDatabase: boolean): MigrationResult<ProjectDatabaseV1> {
    const projects: StoredProjectV1[] = [];
    const warnings: string[] = [];
    let migrated = legacyDatabase;

    for(let index = 0; index < input.length; index++) {
        const candidate = input[index];
        const project = migrateProject(candidate);
        if(project.status !== "ok") {
            if(project.status === "unsupported") return project;
            warnings.push(`Discarded project at index ${index}: ${project.warnings.join(" ")}`);
            migrated = true;
            continue;
        }
        projects.push(project.value);
        migrated ||= project.migrated;
        warnings.push(...project.warnings);
    }

    return success({
        kind: PROJECT_DATABASE_KIND,
        version: CURRENT_PROJECT_DATABASE_VERSION,
        projects,
    }, migrated, warnings);
}

function migrateProject(input: unknown): MigrationResult<StoredProjectV1> {
    if(!isRecord(input)) return invalid("Project record is not an object.");
    const documentInput = input["document"] ?? input["svgData"];
    const document = migrateDocument(documentInput);
    if(document.status !== "ok") return document;
    const data = document.value.data;
    const thumbnail = input["thumbnail"];
    const createdAt = input["createdAt"];
    const updatedAt = input["updatedAt"];
    if(typeof thumbnail !== "string" || !isFiniteNumber(createdAt) || !isFiniteNumber(updatedAt)) {
        return invalid("Project metadata is incomplete or invalid.");
    }

    const metadataChanged = input["id"] !== data.id || input["name"] !== data.name;
    return success({
        id: data.id,
        name: data.name,
        thumbnail,
        createdAt,
        updatedAt,
        document: document.value,
    }, document.migrated || metadataChanged, [
        ...document.warnings,
        ...(metadataChanged ? ["Normalized project identity from its document payload."] : []),
    ]);
}

function storeRuntimeProject(project: RuntimeProjectRecord): StoredProjectV1 {
    return {
        id: project.svgData.id,
        name: project.svgData.name,
        thumbnail: project.thumbnail,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        document: createDocumentEnvelope(project.svgData),
    };
}

function isSVGSave(input: unknown): input is SVGSave {
    return isRecord(input)
        && typeof input["id"] === "string"
        && typeof input["name"] === "string"
        && Array.isArray(input["elements"])
        && isFiniteNumber(input["width"])
        && isFiniteNumber(input["height"])
        && input["width"] >= 0
        && input["height"] >= 0;
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isFiniteNumber(input: unknown): input is number {
    return typeof input === "number" && Number.isFinite(input);
}

function numericVersion(input: unknown): number | undefined {
    return isFiniteNumber(input) ? input : undefined;
}

function success<T>(value: T, migrated: boolean, warnings: string[] = []): MigrationSuccess<T> {
    return { status: "ok", value, migrated, warnings };
}

function invalid(message: string): MigrationFailure {
    return { status: "invalid", warnings: [message] };
}

function unsupported(subject: string, version?: number): MigrationFailure {
    return {
        status: "unsupported",
        version,
        warnings: [`Unsupported ${subject} version: ${version ?? "missing"}.`],
    };
}
