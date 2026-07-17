import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileRuntimeAnimation } from "../src/app/editor/animation/runtime-animation-compiler";
import { SVG, SVGSave } from "../src/app/editor/objects/svg.object";
import { TextElement } from "../src/app/editor/objects/elements/text.object";
import { buildEmbeddedAnimationSvg, buildSelfContainedAnimatedSvg } from "../src/app/editor/export/runtime-svg-template";
import { buildSVGMarkup } from "../src/app/editor/svg-markup";

const root = resolve(process.cwd());
const fixtureDirectory = resolve(root, "fixtures/runtime-showcase-v1");
const envelope = JSON.parse(await readFile(resolve(fixtureDirectory, "document-v5.json"), "utf8")) as { data: SVGSave };
Object.defineProperty(TextElement.prototype, "lines", {
    configurable: true,
    get(this: TextElement) { return this.settings.content.split(/\r?\n/); },
});
let generatedId = 0;
const svg = SVG.fromSave(envelope.data, { get ID() { return `fixture-${++generatedId}`; } } as never);
const compile = compileRuntimeAnimation(svg.save(), { bakeRoundedCorners: true });
if(compile.diagnostics.length) throw new Error(`Showcase fixture has compiler diagnostics: ${JSON.stringify(compile.diagnostics, null, 2)}`);
const bundle = `${JSON.stringify(compile.bundle, null, 2)}\n`;
const artwork = buildSVGMarkup(svg, { bakeRoundedCorners: true, runtime: { signature: compile.bundle.artwork.signature } });
const browserRuntime = await readFile(resolve(root, "packages/runtime/dist/svg-animator-runtime.min.js"), "utf8");
const embedded = buildEmbeddedAnimationSvg(artwork, bundle);
const animated = buildSelfContainedAnimatedSvg(artwork, bundle, browserRuntime);
const outputs = new Map([
    [resolve(fixtureDirectory, "runtime-bundle-v1.json"), bundle],
    [resolve(fixtureDirectory, "runtime-artwork.svg"), artwork],
    [resolve(fixtureDirectory, "embedded-showcase.svg"), embedded],
    [resolve(fixtureDirectory, "animated-showcase.svg"), animated],
]);

for(const [path, content] of outputs) {
    if(process.argv.includes("--check")) {
        const current = await readFile(path, "utf8").catch(() => "");
        if(current !== content) throw new Error(`Runtime golden is stale: ${path}`);
    } else {
        await writeFile(path, content);
    }
}
console.log(process.argv.includes("--check") ? "Runtime golden fixtures are current." : "Runtime golden fixtures updated.");
