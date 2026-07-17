export type ExportMimeType = "application/json" | "image/svg+xml" | "application/zip";

export interface ExportArtifact {
    filename: string;
    mimeType: ExportMimeType;
    content: string | Uint8Array;
}

export function downloadArtifact(artifact: ExportArtifact): void {
    const blob = new Blob([artifact.content as BlobPart], { type: artifact.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function sanitizeFilename(value: string): string {
    const sanitized = value.normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim();
    return (sanitized || "drawing").slice(0, 120);
}

export function stableJson(value: unknown): string {
    return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value: unknown): unknown {
    if(Array.isArray(value)) return value.map(sortValue);
    if(value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compareStrings(a, b)).map(([key, item]) => [key, sortValue(item)]));
    return value;
}

function compareStrings(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
