import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { migrateDocument } from "../src/app/editor/migrations/document-migrations";
import { SVG } from "../src/app/editor/objects/svg.object";
import { TextElement } from "../src/app/editor/objects/elements/text.object";
import { buildSVGMarkup } from "../src/app/editor/svg-markup";

const root = resolve(process.cwd());
const preloadedDirectory = resolve(root, "Preloaded");
const projectExports = [
    "Animation Example.svg-animator.json",
    "favicon.svg-animator.json",
];

// Thumbnail generation runs in Node, where canvas-based text measurement is not
// available. The gallery only needs the authored line breaks for its static preview.
Object.defineProperty(TextElement.prototype, "lines", {
    configurable: true,
    get(this: TextElement) { return this.settings.content.split(/\r?\n/); },
});

let generatedId = 0;
const thumbnails: Record<string, string> = {};

for(const filename of projectExports) {
    const source = JSON.parse(await readFile(resolve(preloadedDirectory, filename), "utf8"));
    const migrated = migrateDocument(source);
    if(migrated.status !== "ok") {
        throw new Error(`Invalid preloaded project ${filename}: ${migrated.warnings.join(" ")}`);
    }
    const svg = SVG.fromSave(migrated.value.data, {
        get ID() { return `preloaded-${++generatedId}`; },
    } as never);
    thumbnails[svg.id] = buildSVGMarkup(svg);
}

const output = `${JSON.stringify(thumbnails, Object.keys(thumbnails).sort(), 2)}\n`;
await writeFile(resolve(preloadedDirectory, "thumbnails.json"), output);
console.log(`Generated ${Object.keys(thumbnails).length} preloaded project thumbnails.`);
