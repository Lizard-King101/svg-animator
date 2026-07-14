import { SVGSave } from "../objects/svg.object";

export const DOCUMENT_ENVELOPE_KIND = "svg-animator/document" as const;
export const PROJECT_DATABASE_KIND = "svg-animator/project-database" as const;
export const CURRENT_DOCUMENT_VERSION = 5 as const;
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
    version: 3;
    data: SVGSave;
}

export interface DocumentEnvelopeV4 {
    kind: typeof DOCUMENT_ENVELOPE_KIND;
    version: 4;
    data: SVGSave;
}

export interface DocumentEnvelopeV5 {
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
    document: DocumentEnvelopeV5;
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

export function createDocumentEnvelope(document: SVGSave): DocumentEnvelopeV5 {
    return {
        kind: DOCUMENT_ENVELOPE_KIND,
        version: CURRENT_DOCUMENT_VERSION,
        data: document,
    };
}

/** Migrates one persisted document without constructing editor model objects. */
export function migrateDocument(input: unknown): MigrationResult<DocumentEnvelopeV5> {
    if(isRecord(input) && input["kind"] === DOCUMENT_ENVELOPE_KIND) {
        const version = numericVersion(input["version"]);
        if(version === 1) {
            if(!isSVGSave(input["data"])) return invalid("Document v1 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(withStrokeStyleV5(withAnimationV2(withImportedSourceNodes(input["data"])))), true, ["Migrated document version 1 to version 2.", "Migrated document version 2 to version 3.", "Migrated document version 3 to version 4 with animation schema v2.", "Migrated document version 4 to version 5 with expanded stroke styles."]);
        }
        if(version === 2) {
            if(!isSVGSave(input["data"])) return invalid("Document v2 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(withStrokeStyleV5(withAnimationV2(input["data"]))), true, ["Migrated document version 2 to version 3 for native paint values.", "Migrated document version 3 to version 4 with animation schema v2.", "Migrated document version 4 to version 5 with expanded stroke styles."]);
        }
        if(version === 3) {
            if(!isSVGSave(input["data"])) return invalid("Document v3 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(withStrokeStyleV5(withAnimationV2(input["data"]))), true, ["Migrated document version 3 to version 4 with animation schema v2.", "Migrated document version 4 to version 5 with expanded stroke styles."]);
        }
        if(version === 4) {
            if(!isSVGSave(input["data"])) return invalid("Document v4 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(withStrokeStyleV5(withAnimationV2(input["data"]))), true, ["Migrated document version 4 to version 5 with expanded stroke styles."]);
        }
        if(version !== CURRENT_DOCUMENT_VERSION) return unsupported("document", version);
        if(!isSVGSave(input["data"])) {
            return invalid("Document v5 contains an invalid SVG payload.");
        }
        const upgraded = withStrokeStyleV5(withAnimationV2(input["data"]));
        const migrated = upgraded !== input["data"];
        return success(migrated ? createDocumentEnvelope(upgraded) : input as unknown as DocumentEnvelopeV5, migrated,
            migrated ? ["Normalized document defaults."] : []);
    }

    if(isSVGSave(input)) {
        return success(createDocumentEnvelope(withStrokeStyleV5(withAnimationV2(withImportedSourceNodes(input)))), true, ["Migrated an unversioned document to version 5."]);
    }

    return invalid("Value is neither a legacy SVG document nor a supported document envelope.");
}

function withStrokeStyleV5(document: SVGSave): SVGSave {
    let changed = false;
    const visit = (element: any): any => {
        if(element?.type === "group") {
            const elements = Array.isArray(element.elements) ? element.elements.map(visit) : [];
            if(elements.some((child: unknown, index: number) => child !== element.elements[index])) {
                changed = true;
                return { ...element, elements };
            }
            return element;
        }
        if(element?.type !== "path" && element?.type !== "shape") return element;
        const settings = element.settings ?? {};
        const hasDefaults = settings.stroke_alignment != null
            && Array.isArray(settings.stroke_dasharray)
            && settings.stroke_dashoffset != null
            && settings.stroke_miterlimit != null
            && (element.type !== "shape" || ("line_cap" in settings && "line_join" in settings));
        if(hasDefaults) return element;
        changed = true;
        return {
            ...element,
            settings: {
                ...settings,
                line_cap: settings.line_cap ?? null,
                line_join: settings.line_join ?? null,
                stroke_alignment: settings.stroke_alignment ?? "center",
                stroke_dasharray: Array.isArray(settings.stroke_dasharray) ? settings.stroke_dasharray : [],
                stroke_dashoffset: settings.stroke_dashoffset ?? 0,
                stroke_miterlimit: settings.stroke_miterlimit ?? 4,
            },
        };
    };
    const elements = document.elements.map(visit);
    return changed ? { ...document, elements } : document;
}

function withAnimationV2(document: SVGSave): SVGSave {
    const animation = document.animation as (SVGSave["animation"] & { version?: number }) | undefined;
    if(!animation || animation.version === 2) return document;
    return {
        ...document,
        animation: {
            ...animation,
            version: 2,
            tracks: Array.isArray(animation.tracks) ? animation.tracks.map((track) => ({
                ...track,
                keyframes: Array.isArray(track.keyframes) ? track.keyframes.map((keyframe) => ({ ...keyframe })) : [],
            })) : [],
        },
    } as SVGSave;
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
