import animationExampleExport from "../../../Preloaded/Animation Example.svg-animator.json";
import faviconExport from "../../../Preloaded/favicon.svg-animator.json";
import thumbnailExport from "../../../Preloaded/thumbnails.json";
import { migrateDocument } from "../editor/migrations/document-migrations";
import { SVGSave } from "../editor/objects/svg.object";

export interface PreloadedProject {
    id: string;
    name: string;
    thumbnail: string;
    createdAt: number;
    updatedAt: number;
    svgData: SVGSave;
}

const PRELOADED_AT = Date.UTC(2026, 6, 17, 12);
const thumbnails = thumbnailExport as Record<string, string>;

export const PRELOADED_PROJECTS: readonly PreloadedProject[] = [
    loadPreloadedProject(animationExampleExport, 0),
    loadPreloadedProject(faviconExport, 1),
];

function loadPreloadedProject(source: unknown, order: number): PreloadedProject {
    const migrated = migrateDocument(source);
    if(migrated.status !== "ok") {
        throw new Error(`Invalid preloaded project: ${migrated.warnings.join(" ")}`);
    }

    const svgData = migrated.value.data;
    const thumbnail = thumbnails[svgData.id];
    if(!thumbnail) throw new Error(`Missing thumbnail for preloaded project ${svgData.id}.`);

    return {
        id: svgData.id,
        name: svgData.name,
        thumbnail,
        createdAt: PRELOADED_AT + order,
        updatedAt: PRELOADED_AT + order,
        svgData,
    };
}
