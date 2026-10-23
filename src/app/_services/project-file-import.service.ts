import { Injectable } from "@angular/core";
import { MAX_SVG_IMPORT_BYTES, SVGImporterService } from "../editor/import/svg-importer.service";
import { parseProjectJSON } from "../editor/import/project-json-import";
import { buildSVGMarkup } from "../editor/svg-markup";
import { ElementFactory } from "./element-factory.service";
import { ProjectService } from "./project.service";

export const MAX_PROJECT_IMPORT_BYTES = 50 * 1024 * 1024;

/** Gallery file ingestion; imports create projects, never mutate the open document. */
@Injectable()
export class ProjectFileImportService {
    constructor(
        private projects: ProjectService,
        private svgImporter: SVGImporterService,
        private elements: ElementFactory,
    ) {}

    async import(file: File): Promise<string> {
        const isJSON = /\.json$/i.test(file.name) || file.type === "application/json";
        if(!isJSON && !/\.svg$/i.test(file.name) && file.type !== "image/svg+xml") {
            throw new Error("Choose an SVG or an exported .svg-animator.json project.");
        }
        const limit = isJSON ? MAX_PROJECT_IMPORT_BYTES : MAX_SVG_IMPORT_BYTES;
        if(file.size > limit) throw new Error(`${isJSON ? 'Project JSON' : 'SVG'} files must be smaller than ${limit / 1024 / 1024} MB.`);
        const source = await file.text();
        await this.projects.ready;

        if(isJSON) {
            const result = parseProjectJSON(source);
            // Retain internal IDs: clips, gradients, motion paths, and animation
            // tracks refer to them. Only the gallery identity is new.
            const document = { ...result.document, id: crypto.randomUUID() };
            const names = new Set(this.projects.list().map((project) => project.name));
            const baseName = document.name;
            for(let copy = 1; names.has(document.name); copy++) {
                document.name = `${baseName} (imported${copy === 1 ? '' : ` ${copy}`})`;
            }
            let thumbnail: string;
            try {
                thumbnail = buildSVGMarkup(this.elements.restoreDocument(document));
            } catch {
                throw new Error("This project contains invalid artwork and could not be opened. Nothing was imported.");
            }
            this.projects.upsert(document, thumbnail);
            return `Imported editable project “${document.name}”.${result.migrated ? ' Updated an older project format.' : ''}${result.removedCount ? ` Removed ${result.removedCount} unsafe item${result.removedCount === 1 ? '' : 's'} from preserved SVG content.` : ''}`;
        }

        const result = this.svgImporter.import(source, { name: file.name });
        this.projects.upsert(result.document, result.sanitizedMarkup);
        const details = [
            `${result.nativeElementCount} editable element${result.nativeElementCount === 1 ? '' : 's'}`,
            `${result.preservedNodeCount} non-editable preserved node${result.preservedNodeCount === 1 ? '' : 's'}`,
            `${result.removedUnsafeCount} unsafe item${result.removedUnsafeCount === 1 ? '' : 's'} removed`,
        ];
        return `${result.editability === 'native' ? 'Fully editable import' : 'Partial import'} “${result.document.name}”: ${details.join(', ')}.`;
    }
}
