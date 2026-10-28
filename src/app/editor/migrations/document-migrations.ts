import { validRigs } from '../objects/armature';
import { AnimationDocument, validComposition } from '../objects/animation.object';
import { validProjectColors } from '../objects/project-colors';
import { SVGSave } from "../objects/svg.object";
import { outlineSectionsProblem, OutlineSection } from '../../../../packages/runtime/src/outline';
import type { RuntimeContourV1, RuntimeLineV1, RuntimePointV1 } from '../../../../packages/runtime/src/contracts';

export const DOCUMENT_ENVELOPE_KIND = "svg-animator/document" as const;
export const PROJECT_DATABASE_KIND = "svg-animator/project-database" as const;
export const CURRENT_DOCUMENT_VERSION = 19 as const;
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
    version: 5;
    data: SVGSave;
}

export interface DocumentEnvelopeV6 {
    kind: typeof DOCUMENT_ENVELOPE_KIND;
    version: 6;
    data: SVGSave;
}

export interface DocumentEnvelopeV11 {
    kind: typeof DOCUMENT_ENVELOPE_KIND;
    version: 11;
    data: SVGSave;
}

export interface DocumentEnvelopeV12 {
    kind: typeof DOCUMENT_ENVELOPE_KIND;
    version: 12;
    data: SVGSave;
}

export interface DocumentEnvelopeV13 {
    kind: typeof DOCUMENT_ENVELOPE_KIND;
    version: 13;
    data: SVGSave;
}

export interface DocumentEnvelopeV14 {
    kind: typeof DOCUMENT_ENVELOPE_KIND;
    version: 14;
    data: SVGSave;
}

export interface DocumentEnvelopeV15 {
    kind: typeof DOCUMENT_ENVELOPE_KIND;
    version: 15;
    data: SVGSave;
}

export interface DocumentEnvelopeV16 {
    kind: typeof DOCUMENT_ENVELOPE_KIND;
    version: 16;
    data: SVGSave;
}

export interface DocumentEnvelopeV18 {
    kind: typeof DOCUMENT_ENVELOPE_KIND;
    version: 18;
    data: SVGSave;
}

export interface DocumentEnvelopeV19 {
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
    document: DocumentEnvelopeV19;
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

export function createDocumentEnvelope(document: SVGSave): DocumentEnvelopeV19 {
    return {
        kind: DOCUMENT_ENVELOPE_KIND,
        version: CURRENT_DOCUMENT_VERSION,
        data: withRigV5(document),
    };
}

/** Migrates one persisted document without constructing editor model objects. */
export function migrateDocument(input: unknown): MigrationResult<DocumentEnvelopeV19> {
    // Prior renderers inferred closure from coincident endpoints. Preserve that
    // appearance once; v16 treats an explicit open contour as open thereafter.
    if(isRecord(input) && input['kind'] === DOCUMENT_ENVELOPE_KIND) {
        const version = numericVersion(input['version']);
        if(version !== undefined && version <= 16 && isSVGSave(input['data'])) {
            const closed = version <= 15 ? withExplicitClosureV16(input['data']) : input['data'];
            input = { ...input, data: withHiddenClippingArtworkV17(closed) };
        }
    } else if(isSVGSave(input)) input = withHiddenClippingArtworkV17(withExplicitClosureV16(input));
    const payload = isRecord(input) && input['kind'] === DOCUMENT_ENVELOPE_KIND ? input['data'] : input;
    const rigs = isRecord(payload) ? payload['rigs'] : undefined;
    if(isRecord(rigs) && rigs['version'] !== 1 && rigs['version'] !== 2 && rigs['version'] !== 3 && rigs['version'] !== 4 && rigs['version'] !== 5 && rigs['version'] !== 6) return unsupported('armature', numericVersion(rigs['version']));
    const animation = isRecord(payload) ? payload['animation'] : undefined;
    const composition = isRecord(animation) ? animation['composition'] : undefined;
    if(isRecord(composition) && composition['version'] !== 1) return unsupported('action composition', numericVersion(composition['version']));
    if(isRecord(input) && input["kind"] === DOCUMENT_ENVELOPE_KIND) {
        const version = numericVersion(input["version"]);
        if(version === 1) {
            if(!isSVGSave(input["data"])) return invalid("Document v1 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(withStrokeStyleV5(withAnimationV2(withImportedSourceNodes(input["data"])))), true, ["Migrated document version 1 to version 2.", "Migrated document version 2 to version 3.", "Migrated document version 3 to version 4 with animation schema v2.", "Migrated document version 4 to version 5 with expanded stroke styles.", "Migrated document version 5 to version 6 with optional editor reference images.", "Migrated document version 6 to version 7 with optional project colors.", "Migrated document version 7 to version 8 with optional action composition.", "Migrated document version 8 to version 9 with optional placement timing."]);
        }
        if(version === 2) {
            if(!isSVGSave(input["data"])) return invalid("Document v2 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(withStrokeStyleV5(withAnimationV2(input["data"]))), true, ["Migrated document version 2 to version 3 for native paint values.", "Migrated document version 3 to version 4 with animation schema v2.", "Migrated document version 4 to version 5 with expanded stroke styles.", "Migrated document version 5 to version 6 with optional editor reference images.", "Migrated document version 6 to version 7 with optional project colors.", "Migrated document version 7 to version 8 with optional action composition.", "Migrated document version 8 to version 9 with optional placement timing."]);
        }
        if(version === 3) {
            if(!isSVGSave(input["data"])) return invalid("Document v3 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(withStrokeStyleV5(withAnimationV2(input["data"]))), true, ["Migrated document version 3 to version 4 with animation schema v2.", "Migrated document version 4 to version 5 with expanded stroke styles.", "Migrated document version 5 to version 6 with optional editor reference images.", "Migrated document version 6 to version 7 with optional project colors.", "Migrated document version 7 to version 8 with optional action composition.", "Migrated document version 8 to version 9 with optional placement timing."]);
        }
        if(version === 4) {
            if(!isSVGSave(input["data"])) return invalid("Document v4 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(withStrokeStyleV5(withAnimationV2(input["data"]))), true, ["Migrated document version 4 to version 5 with expanded stroke styles.", "Migrated document version 5 to version 6 with optional editor reference images.", "Migrated document version 6 to version 7 with optional project colors.", "Migrated document version 7 to version 8 with optional action composition.", "Migrated document version 8 to version 9 with optional placement timing."]);
        }
        if(version === 5) {
            if(!isSVGSave(input["data"])) return invalid("Document v5 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(withStrokeStyleV5(withAnimationV2(input["data"]))), true,
                ["Migrated document version 5 to version 6 with optional editor reference images.", "Migrated document version 6 to version 7 with optional project colors.", "Migrated document version 7 to version 8 with optional action composition.", "Migrated document version 8 to version 9 with optional placement timing."]);
        }
        if(version === 6) {
            if(!isSVGSave(input["data"])) return invalid("Document v6 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(withStrokeStyleV5(withAnimationV2(input["data"]))), true,
                ["Migrated document version 6 to version 7 with optional project colors.", "Migrated document version 7 to version 8 with optional action composition.", "Migrated document version 8 to version 9 with optional placement timing."]);
        }
        if(version === 7) {
            if(!isSVGSave(input["data"])) return invalid("Document v7 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(input["data"]), true, ["Migrated document version 7 to version 8 with optional action composition.", "Migrated document version 8 to version 9 with optional placement timing."]);
        }
        if(version === 8) {
            if(!isSVGSave(input["data"])) return invalid("Document v8 contains an invalid SVG payload.");
            return success(createDocumentEnvelope(input["data"]), true, ["Migrated document version 8 to version 9 with optional placement timing."]);
        }
        if(version === 9) {
            if(!isSVGSave(input['data'])) return invalid('Document v9 contains an invalid SVG payload.');
            return success(createDocumentEnvelope(input['data']), true, ['Migrated document version 9 to version 10 with optional armatures.']);
        }
        if(version === 10) {
            if(!isSVGSave(input['data'])) return invalid('Document v10 contains an invalid SVG payload.');
            return success(createDocumentEnvelope(input['data']), true, ['Migrated document version 10 to version 11 with point bones and rigid attachments.']);
        }
        if(version === 11) {
            if(!isSVGSave(input['data'])) return invalid('Document v11 contains an invalid SVG payload.');
            return success(createDocumentEnvelope(input['data']), true, ['Migrated document version 11 to version 12 with optional persistent IK constraints.']);
        }
        if(version === 12) {
            if(!isSVGSave(input['data'])) return invalid('Document v12 contains an invalid SVG payload.');
            return success(createDocumentEnvelope(input['data']), true, ['Migrated document version 12 to version 13 with optional shared point and independent handle weights.']);
        }
        if(version === 13) {
            if(!isSVGSave(input['data'])) return invalid('Document v13 contains an invalid SVG payload.');
            return success(createDocumentEnvelope(input['data']), true, ['Migrated document version 13 to version 14 with optional weight locks.']);
        }
        if(version === 14) {
            if(!isSVGSave(input['data'])) return invalid('Document v14 contains an invalid SVG payload.');
            return success(createDocumentEnvelope(input['data']), true, ['Migrated document version 14 to version 15 with bone pose animation channels.']);
        }
        if(version === 15) {
            if(!isSVGSave(input['data'])) return invalid('Document v15 contains an invalid SVG payload.');
            return success(createDocumentEnvelope(input['data']), true, ['Migrated document version 15 to version 16 with outline sections and explicit open contours.']);
        }
        if(version === 16) {
            if(!isSVGSave(input['data'])) return invalid('Document v16 contains an invalid SVG payload.');
            return success(createDocumentEnvelope(input['data']), true, ['Migrated document version 16 to version 17 with clipping artwork visibility.']);
        }
        if(version === 17) {
            if(!isSVGSave(input['data'])) return invalid('Document v17 contains an invalid SVG payload.');
            return success(createDocumentEnvelope(input['data']), true, ['Migrated document version 17 to version 18 with optional loop endpoint links.']);
        }
        if(version === 18) {
            if(!isSVGSave(input['data'])) return invalid('Document v18 contains an invalid SVG payload.');
            return success(createDocumentEnvelope(input['data']), true, ['Migrated document version 18 to version 19 with optional live spring constraints.']);
        }
        if(version !== CURRENT_DOCUMENT_VERSION) return unsupported("document", version);
        if(!isSVGSave(input["data"])) {
            return invalid("Document v19 contains an invalid SVG payload.");
        }
        const upgraded = withRigV5(withStrokeStyleV5(withAnimationV2(input["data"])));
        const migrated = upgraded !== input["data"];
        return success(migrated ? createDocumentEnvelope(upgraded) : input as unknown as DocumentEnvelopeV19, migrated,
            migrated ? ["Normalized document defaults."] : []);
    }

    if(isSVGSave(input)) {
        return success(createDocumentEnvelope(withStrokeStyleV5(withAnimationV2(withImportedSourceNodes(input)))), true, ["Migrated an unversioned document to version 18."]);
    }

    return invalid("Value is neither a legacy SVG document nor a supported document envelope.");
}

/** Earlier renderers always omitted clipping-source artwork from the painted scene. */
function withHiddenClippingArtworkV17(document: SVGSave): SVGSave {
    const clipSourceIds = new Set<string>();
    const visit = (element: SVGSave['elements'][number]): SVGSave['elements'][number] => {
        if(element.type !== 'group') return element;
        const elements = element.elements.map(child => {
            const migrated = visit(child);
            if(migrated.id === element.clipElementId) clipSourceIds.add(migrated.id);
            return migrated.id === element.clipElementId && migrated.visible
                ? { ...migrated, visible: false } : migrated;
        });
        return elements.some((child, index) => child !== element.elements[index]) ? { ...element, elements } : element;
    };
    const elements = document.elements.map(visit);
    // Visibility previously never painted a clip source. Keep those scene/action
    // channels hidden so a later seek cannot unexpectedly reveal legacy artwork.
    const hideClipTracks = (animation: AnimationDocument): AnimationDocument => {
        // Older animation payloads can omit these arrays; the existing animation
        // migration normalizes them after this appearance-preservation pass.
        const sourceTracks = Array.isArray(animation.tracks) ? animation.tracks : [];
        const tracks = sourceTracks.map(track => {
            if(!track || track.property !== 'visible' || !clipSourceIds.has(track.targetId) || !Array.isArray(track.keyframes)) return track;
            const keyframes = track.keyframes.map(key => !key || key.value === false ? key : { ...key, value: false });
            return keyframes.some((key, index) => key !== track.keyframes[index]) ? { ...track, keyframes } : track;
        });
        const actions = animation.composition?.actions.map(action => {
            const local = hideClipTracks(action.animation);
            return local === action.animation ? action : { ...action, animation: local };
        });
        const composition = animation.composition && actions?.some((action, index) => action !== animation.composition!.actions[index])
            ? { ...animation.composition, actions } : animation.composition;
        return tracks.some((track, index) => track !== sourceTracks[index]) || composition !== animation.composition
            ? { ...animation, tracks, ...(composition ? { composition } : {}) } : animation;
    };
    const animation = document.animation && hideClipTracks(document.animation);
    return elements.some((element, index) => element !== document.elements[index]) || animation !== document.animation
        ? { ...document, elements, ...(animation ? { animation } : {}) } : document;
}

/** Only valid saved binding signatures follow the closure migration; stale bindings stay stale. */
function withExplicitClosureV16(document: SVGSave): SVGSave {
    const topologyChanges = new Map<string, { before: string; after: string }>();
    const visit = (element: SVGSave['elements'][number]): SVGSave['elements'][number] => {
        if(element.type === 'group') {
            const elements = element.elements.map(visit);
            return elements.some((child, index) => child !== element.elements[index]) ? { ...element, elements } : element;
        }
        if(element.type !== 'path') return element;
        if(!element.contours?.length) {
            return !element.closed && legacyClosed(element.lines ?? [])
                ? { ...element, closed: true, settings: { ...element.settings, stroke_alignment: 'center' } } : element;
        }
        const contours = element.contours.map(contour => !contour.closed && legacyClosed(contour.lines) ? { ...contour, closed: true } : contour);
        if(contours.every((contour, index) => contour === element.contours![index])) return element;
        const signature = (value: typeof contours) => JSON.stringify(value.map(contour => [contour.id, contour.closed,
            contour.lines.map(line => [line.id, line.type, line.points.map(point => point.id), line.controlStart?.id, line.controlEnd?.id])]));
        topologyChanges.set(element.id, { before: signature(element.contours), after: signature(contours) });
        // Old Path.fromSave forced centered alignment whenever a stored contour
        // was open, even if its renderer inferred a closed contour afterwards.
        return { ...element, closed: contours[0].closed, contours,
            settings: { ...element.settings, stroke_alignment: 'center' } };
    };
    const elements = document.elements.map(visit);
    if(elements.every((element, index) => element === document.elements[index])) return document;
    const rigs = document.rigs && { ...document.rigs, armatures: document.rigs.armatures.map(rig => ({ ...rig,
        bindings: rig.bindings.map(binding => {
            const change = topologyChanges.get(binding.pathId);
            return change && binding.topology === change.before ? { ...binding, topology: change.after } : binding;
        }),
    })) };
    return { ...document, elements, ...(rigs ? { rigs } : {}) };
}

function legacyClosed(lines: { points: { id: string; x: number; y: number }[] }[]): boolean {
    const complete = lines.filter(line => line.points.length >= 2);
    if(complete.length < 2) return false;
    const first = complete[0].points[0], last = complete[complete.length - 1].points[1];
    return first.id === last.id || (Math.abs(first.x - last.x) < .0001 && Math.abs(first.y - last.y) < .0001);
}

/** Legacy poses, anchor inheritance, and separate weights remain unchanged; links are never guessed. */
function withRigV5(document: SVGSave): SVGSave {
    return document.rigs && document.rigs.version < 5
        ? { ...document, rigs: { ...document.rigs, version: 5 } }
        : document;
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
        && validComposition((input["animation"] as { composition?: unknown } | undefined)?.composition)
        && typeof input["id"] === "string"
        && typeof input["name"] === "string"
        && Array.isArray(input["elements"])
        && validArtworkOutlines(input['elements'])
        && (input["rigs"] === undefined || validRigs(input["rigs"]))
        && (input["projectColors"] === undefined || validProjectColors(input["projectColors"]))
        && isFiniteNumber(input["width"])
        && isFiniteNumber(input["height"])
        && input["width"] >= 0
        && input["height"] >= 0;
}

/** Metadata addresses require stable saved contours; absent metadata keeps legacy loading unchanged. */
function validArtworkOutlines(elements: unknown[]): boolean {
    return elements.every(element => {
        if(!isRecord(element)) return true;
        if(element['type'] === 'group') return Array.isArray(element['elements']) && validArtworkOutlines(element['elements']);
        if(element['type'] !== 'path' || element['outlineSections'] === undefined) return true;
        const sections = element['outlineSections'];
        if(!Array.isArray(sections)) return false;
        // An empty list intentionally hides the stroke, including legacy paths
        // with only `lines` and paths still being drawn with incomplete segments.
        if(!sections.length) return true;
        const savedContours = element['contours'];
        if(!Array.isArray(savedContours)) return false;
        const contours: RuntimeContourV1[] = [], contourIds = new Set<string>();
        for(const saved of savedContours) {
            if(!isRecord(saved) || typeof saved['id'] !== 'string' || !saved['id'] || contourIds.has(saved['id'])
                || typeof saved['closed'] !== 'boolean' || !Array.isArray(saved['lines'])) return false;
            contourIds.add(saved['id']);
            const lines: RuntimeLineV1[] = [], segmentIds = new Set<string>();
            for(const line of saved['lines']) {
                if(!isRecord(line) || typeof line['id'] !== 'string' || !line['id'] || segmentIds.has(line['id'])
                    || (line['type'] !== 'line' && line['type'] !== 'bezier') || !Array.isArray(line['points'])
                    || !line['points'].every(validOutlinePoint)
                    || (line['controlStart'] !== undefined && !validOutlinePoint(line['controlStart']))
                    || (line['controlEnd'] !== undefined && !validOutlinePoint(line['controlEnd']))) return false;
                segmentIds.add(line['id']);
                if(line['points'].length >= 2) lines.push({ id: line['id'], type: line['type'], points: [line['points'][0], line['points'][1]],
                    ...(line['controlStart'] ? { controlStart: line['controlStart'] as RuntimePointV1 } : {}),
                    ...(line['controlEnd'] ? { controlEnd: line['controlEnd'] as RuntimePointV1 } : {}),
                });
            }
            contours.push({ id: saved['id'], closed: saved['closed'], lines });
        }
        return outlineSectionsProblem(contours, sections as OutlineSection[]) === undefined;
    });
}

function validOutlinePoint(point: unknown): point is RuntimePointV1 {
    return isRecord(point) && typeof point['id'] === 'string' && !!point['id'] && isFiniteNumber(point['x']) && isFiniteNumber(point['y'])
        && (point['cornerRadius'] === undefined || (isFiniteNumber(point['cornerRadius']) && point['cornerRadius'] >= 0));
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
