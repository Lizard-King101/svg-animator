import { copyFile, mkdir, readdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceDirectory = fileURLToPath(new URL("../packages/runtime/dist/", import.meta.url));
const destinationDirectory = fileURLToPath(new URL("../public/assets/runtime/", import.meta.url));
const browserArtifact = /^svg-animator-runtime(?:\.esm|\.min)?\.js(?:\.map)?$/;

const sourceEntries = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && browserArtifact.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareStrings);

if(sourceEntries.length === 0) {
    throw new Error(`No browser runtime artifacts were found in ${sourceDirectory}. Run the runtime package build first.`);
}

await mkdir(destinationDirectory, { recursive: true });
const staleEntries = (await readdir(destinationDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && browserArtifact.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => !sourceEntries.includes(name));
await Promise.all(staleEntries.map((name) => unlink(`${destinationDirectory}/${name}`)));
await Promise.all(sourceEntries.map((name) => copyFile(`${sourceDirectory}/${name}`, `${destinationDirectory}/${name}`)));

console.log(`Copied ${sourceEntries.length} runtime browser artifacts to public/assets/runtime.`);

function compareStrings(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
