import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const file = new URL("../packages/runtime/dist/svg-animator-runtime.min.js", import.meta.url);
const source = await readFile(file);
const gzipBytes = gzipSync(source, { level: 9 }).byteLength;
const budget = 30 * 1024;
if(gzipBytes > budget) {
    console.error(`Runtime gzip size ${gzipBytes} bytes exceeds the ${budget} byte budget.`);
    process.exit(1);
}
console.log(`Runtime gzip size: ${gzipBytes} bytes / ${budget} byte budget.`);
