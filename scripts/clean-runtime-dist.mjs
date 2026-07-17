import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const runtimeDist = fileURLToPath(new URL("../packages/runtime/dist/", import.meta.url));
await rm(runtimeDist, { recursive: true, force: true });
