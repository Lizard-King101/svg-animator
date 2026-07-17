import { Injectable } from "@angular/core";
import { strToU8, zipSync } from "fflate";
import { RuntimeCompileDiagnostic, RuntimeCompileResultV1 } from "../../../packages/runtime/src/contracts";
import { compileRuntimeAnimation } from "../editor/animation/runtime-animation-compiler";
import { SVG } from "../editor/objects/svg.object";
import { buildSVGMarkup } from "../editor/svg-markup";
import { buildEmbeddedAnimationSvg, buildSelfContainedAnimatedSvg } from "../editor/export/runtime-svg-template";
import { buildWebBundleHtml, buildWebBundleReadme } from "../editor/export/web-bundle-template";
import {
    downloadArtifact,
    ExportArtifact,
    sanitizeFilename,
    stableJson,
} from "../editor/export/export-artifact";

export { sanitizeFilename } from "../editor/export/export-artifact";

export type RuntimeExportKind = "static-svg" | "embedded-animation-svg" | "animated-svg" | "runtime-assets-zip" | "web-bundle-zip";
export type RuntimeExportProgress = "compiling" | "building-artwork" | "loading-runtime" | "packaging";

export interface RuntimeExportRequest {
    kind: RuntimeExportKind;
    bakeRoundedCorners: boolean;
    onProgress?: (progress: RuntimeExportProgress) => void;
}

export interface RuntimeExportArtifact extends ExportArtifact {
    manifest?: string[];
}

export interface RuntimeExportInspection {
    compile: RuntimeCompileResultV1;
    blockingDiagnostics: RuntimeCompileDiagnostic[];
    validTrackCount: number;
    canExportAnimation: boolean;
}

export class RuntimeExportError extends Error {
    override readonly name = "RuntimeExportError";
    constructor(
        message: string,
        public readonly code: "invalid-animation" | "runtime-artifact-unavailable" | "build-failed",
        public readonly diagnostics: RuntimeCompileDiagnostic[] = [],
        public override readonly cause?: unknown,
    ) { super(message); }
}

@Injectable({ providedIn: "root" })
export class RuntimeExportService {
    inspect(svg: SVG, bakeRoundedCorners = true): RuntimeExportInspection {
        const compile = compileRuntimeAnimation(svg.save(), { bakeRoundedCorners });
        const blockingDiagnostics = compile.diagnostics.filter((diagnostic) => diagnostic.code !== "skipped-track");
        const validTrackCount = compile.bundle.animation.tracks.length;
        return { compile, blockingDiagnostics, validTrackCount, canExportAnimation: validTrackCount > 0 && blockingDiagnostics.length === 0 };
    }

    async build(svg: SVG, request: RuntimeExportRequest): Promise<RuntimeExportArtifact> {
        const baseName = sanitizeFilename(svg.name ?? "drawing");
        request.onProgress?.("compiling");
        const inspection = this.inspect(svg, request.bakeRoundedCorners);
        if(request.kind === "static-svg") {
            request.onProgress?.("building-artwork");
            return {
                filename: `${baseName}.svg`,
                mimeType: "image/svg+xml",
                content: buildSVGMarkup(svg, { bakeRoundedCorners: request.bakeRoundedCorners }),
            };
        }
        if(!inspection.canExportAnimation) {
            const reason = inspection.validTrackCount === 0 ? "This document has no valid enabled animation tracks." : "Correct invalid animation tracks before exporting.";
            throw new RuntimeExportError(reason, "invalid-animation", inspection.blockingDiagnostics);
        }

        request.onProgress?.("building-artwork");
        const bundleJson = stableJson(inspection.compile.bundle);
        const artwork = buildSVGMarkup(svg, {
            bakeRoundedCorners: request.bakeRoundedCorners,
            runtime: { signature: inspection.compile.bundle.artwork.signature },
        });

        if(request.kind === "embedded-animation-svg") {
            return {
                filename: `${baseName}-animation.svg`,
                mimeType: "image/svg+xml",
                content: buildEmbeddedAnimationSvg(artwork, bundleJson),
            };
        }

        if(request.kind === "animated-svg") {
            request.onProgress?.("loading-runtime");
            const runtime = await this.loadText(runtimeAssetUrl("svg-animator-runtime.min.js"));
            return {
                filename: `${baseName}-animated.svg`,
                mimeType: "image/svg+xml",
                content: buildSelfContainedAnimatedSvg(artwork, bundleJson, runtime),
            };
        }

        request.onProgress?.("packaging");
        if(request.kind === "runtime-assets-zip") {
            const entries: ZipEntry[] = [
                ["animation.json", `${bundleJson}\n`],
                ["artwork.svg", artwork],
            ];
            return this.zipArtifact(`${baseName}-runtime-assets.zip`, entries);
        }

        request.onProgress?.("loading-runtime");
        const [browserRuntime, esmRuntime] = await Promise.all([
            this.loadText(runtimeAssetUrl("svg-animator-runtime.min.js")),
            this.loadText(runtimeAssetUrl("svg-animator-runtime.esm.js")),
        ]);
        request.onProgress?.("packaging");
        const entries: ZipEntry[] = [
            ["README.md", buildWebBundleReadme(baseName)],
            ["animation.json", `${bundleJson}\n`],
            ["artwork.svg", artwork],
            ["index.html", buildWebBundleHtml(baseName, { runtimeRevision: contentRevision(browserRuntime) })],
            ["runtime/svg-animator-runtime.esm.js", esmRuntime],
            ["runtime/svg-animator-runtime.min.js", browserRuntime],
        ];
        return this.zipArtifact(`${baseName}-web.zip`, entries);
    }

    download(artifact: RuntimeExportArtifact): void {
        downloadArtifact(artifact);
    }

    private zipArtifact(filename: string, entries: ZipEntry[]): RuntimeExportArtifact {
        const sorted = [...entries].sort(([a], [b]) => compareStrings(a, b));
        const archiveEntries: Record<string, [Uint8Array, { level: 9; mtime: Date }]> = {};
        sorted.forEach(([name, content]) => archiveEntries[name] = [strToU8(content), { level: 9, mtime: new Date(1980, 0, 1, 0, 0, 0) }]);
        return { filename, mimeType: "application/zip", content: zipSync(archiveEntries), manifest: sorted.map(([name]) => name) };
    }

    private async loadText(url: string): Promise<string> {
        try {
            const response = await fetch(url, { cache: "no-store" });
            if(!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } catch(error) {
            throw new RuntimeExportError(`Required runtime artifact is unavailable: ${url}`, "runtime-artifact-unavailable", [], error);
        }
    }
}

type ZipEntry = [name: string, content: string];

function runtimeAssetUrl(filename: string): string { return new URL(`assets/runtime/${filename}`, document.baseURI).toString(); }
function compareStrings(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function contentRevision(value: string): string {
    let hash = 0x811c9dc5;
    for(let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
