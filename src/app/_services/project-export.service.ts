import { Injectable } from "@angular/core";
import { SVGSave } from "../editor/objects/svg.object";
import { createDocumentEnvelope } from "../editor/migrations/document-migrations";
import {
    downloadArtifact,
    ExportArtifact,
    sanitizeFilename,
    stableJson,
} from "../editor/export/export-artifact";

export interface ProjectExportSource {
    name: string;
    svgData: SVGSave;
}

@Injectable({ providedIn: "root" })
export class ProjectExportService {
    build(project: ProjectExportSource): ExportArtifact {
        return {
            filename: `${sanitizeFilename(project.name)}.svg-animator.json`,
            mimeType: "application/json",
            content: `${stableJson(createDocumentEnvelope(project.svgData))}\n`,
        };
    }

    download(project: ProjectExportSource): void { downloadArtifact(this.build(project)); }
}
