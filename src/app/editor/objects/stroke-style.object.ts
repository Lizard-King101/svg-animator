export type StrokeAlignment = "center" | "inside" | "outside";

export interface StrokeStyleSave {
    stroke_alignment: StrokeAlignment;
    stroke_dasharray: number[];
    stroke_dashoffset: number;
    stroke_miterlimit: number;
    line_cap: string | null;
    line_join: string | null;
}

export const DEFAULT_STROKE_STYLE: StrokeStyleSave = {
    stroke_alignment: "center",
    stroke_dasharray: [],
    stroke_dashoffset: 0,
    stroke_miterlimit: 4,
    line_cap: null,
    line_join: null,
};

export function normalizeDashArray(value: unknown): number[] {
    if(!Array.isArray(value)) return [];
    const values = value.map(Number);
    if(values.length === 0 || values.some((entry) => !Number.isFinite(entry) || entry < 0)) return [];
    return values.some((entry) => entry > 0) ? values : [];
}

export function parseDashArray(value: string): number[] | null {
    const trimmed = value.trim();
    if(!trimmed || trimmed.toLowerCase() === "none") return [];
    const parts = trimmed.split(/[\s,]+/).filter(Boolean);
    if(parts.length === 0) return [];
    const values = parts.map((part) => Number(part));
    if(values.some((entry) => !Number.isFinite(entry) || entry < 0)) return null;
    return values.some((entry) => entry > 0) ? values : [];
}

export function formatDashArray(value: unknown): string {
    return normalizeDashArray(value).join(" ");
}

export function effectiveStrokeAlignment(element: { settings: { stroke_alignment: StrokeAlignment }; contours?: Array<{ closed: boolean; lines: unknown[] }> }): StrokeAlignment {
    if(element.contours?.some((contour) => contour.lines.length > 0 && !contour.closed)) return "center";
    return element.settings.stroke_alignment;
}

export function strokeDasharrayAttr(value: unknown): string | null {
    const pattern = normalizeDashArray(value);
    return pattern.length ? pattern.join(" ") : null;
}

export function restoreStrokeStyle(value: Partial<StrokeStyleSave> | null | undefined): StrokeStyleSave {
    const alignment = value?.stroke_alignment;
    return {
        stroke_alignment: alignment === "inside" || alignment === "outside" ? alignment : "center",
        stroke_dasharray: normalizeDashArray(value?.stroke_dasharray),
        stroke_dashoffset: finiteNumber(value?.stroke_dashoffset, 0),
        stroke_miterlimit: Math.max(1, finiteNumber(value?.stroke_miterlimit, 4)),
        line_cap: value?.line_cap ?? null,
        line_join: value?.line_join ?? null,
    };
}

function finiteNumber(value: unknown, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
