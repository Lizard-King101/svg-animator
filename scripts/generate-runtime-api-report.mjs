import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const declarationsDirectory = resolve(root, "packages/runtime/dist");
const reportPath = resolve(root, "packages/runtime/API_REPORT.md");
const files = (await readdir(declarationsDirectory)).filter((file) => file.endsWith(".d.ts") && !file.endsWith(".internal.d.ts")).sort();
const sections = [];
for(const file of files) {
    const content = (await readFile(resolve(declarationsDirectory, file), "utf8"))
        .replace(/^\/\/# sourceMappingURL=.*$/gm, "")
        .trim();
    sections.push(`## ${file}\n\n\`\`\`ts\n${content}\n\`\`\``);
}
const report = `# SVG Animator Runtime public API report\n\nGenerated from runtime v1 TypeScript declarations. Changes require SemVer review.\n\n${sections.join("\n\n")}\n`;
if(process.argv.includes("--write")) {
    await writeFile(reportPath, report);
    console.log(`Wrote ${reportPath}`);
} else {
    const current = await readFile(reportPath, "utf8").catch(() => "");
    if(current !== report) {
        console.error("Runtime public API report is stale. Run npm run api:report and review the change.");
        process.exit(1);
    }
    console.log("Runtime public API report is current.");
}
