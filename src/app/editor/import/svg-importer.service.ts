import { Injectable } from "@angular/core";
import { GroupSave } from "../objects/elements/group.object";
import { PathSave } from "../objects/elements/path.object";
import { ShapeSave } from "../objects/elements/shape.object";
import { TextSave } from "../objects/elements/text.object";
import { ElementSave, ImportedSourceNode, SVGSave } from "../objects/svg.object";
import { TransformSave, identityMatrix, Matrix, multiplyMatrix, rotationMatrix, scaleMatrix, translationMatrix } from "../objects/transform.object";
import { parseSVGPathData, SVGPathParseError } from "./svg-path-parser";
import { sanitizeSVGText, SVGParseError } from "./svg-sanitizer";

const UNSUPPORTED_NATIVE_ATTRIBUTES = [
    "clip-path", "mask", "filter", "marker", "marker-start", "marker-mid", "marker-end",
    "stroke-dasharray", "stroke-dashoffset", "vector-effect", "paint-order",
];

export interface SVGImportOptions { name?: string; }

export interface SVGImportResult {
    document: SVGSave;
    sanitizedMarkup: string;
    warnings: string[];
    nativeElementCount: number;
    preservedNodeCount: number;
    removedUnsafeCount: number;
}

export class SVGImportError extends Error {}

@Injectable({ providedIn: "root" })
export class SVGImporterService {
    import(source: string, options: SVGImportOptions = {}): SVGImportResult {
        let sanitized;
        try {
            sanitized = sanitizeSVGText(source);
        } catch(error) {
            if(error instanceof SVGParseError) throw new SVGImportError(error.message);
            throw error;
        }

        const context = new ImportContext(sanitized.root, options.name);
        const elements = context.importChildren(sanitized.root, null);
        const dimensions = rootDimensions(sanitized.root);
        const document: SVGSave = {
            id: context.documentId,
            name: context.documentName,
            width: dimensions.width,
            height: dimensions.height,
            elements,
            importedSourceNodes: context.sourceNodes,
        };

        return {
            document,
            sanitizedMarkup: sanitized.markup,
            warnings: [...sanitized.warnings, ...context.warnings],
            nativeElementCount: countElements(elements),
            preservedNodeCount: context.sourceNodes.length,
            removedUnsafeCount: sanitized.removedCount,
        };
    }
}

class ImportContext {
    readonly sourceNodes: ImportedSourceNode[] = [];
    readonly warnings: string[] = [];
    readonly documentId: string;
    readonly documentName: string;
    private readonly ids = new Set<string>();
    private counter = 0;

    constructor(root: SVGSVGElement, requestedName?: string) {
        this.documentId = this.id(root.getAttribute("id"), "document");
        this.documentName = cleanDocumentName(requestedName)
            || root.querySelector(":scope > title")?.textContent?.trim()
            || root.getAttribute("aria-label")?.trim()
            || this.documentId;
    }

    importChildren(parent: Element, parentId: string | null): ElementSave[] {
        const elements: ElementSave[] = [];
        Array.from(parent.children).forEach((child) => {
            if(child.localName.toLowerCase() === "title" || child.localName.toLowerCase() === "desc") return;
            const imported = this.importElement(child, parentId);
            if(imported) elements.push(imported);
        });
        return elements;
    }

    private importElement(element: Element, parentId: string | null): ElementSave | undefined {
        const tag = element.localName.toLowerCase();
        try {
            switch(tag) {
                case "g": return this.importGroup(element);
                case "path": return this.importPath(element);
                case "rect": return this.importRect(element);
                case "circle": return this.importEllipse(element, true);
                case "ellipse": return this.importEllipse(element, false);
                case "line": return this.importLine(element);
                case "polyline": return this.importPoly(element, false);
                case "polygon": return this.importPoly(element, true);
                case "text": return this.importText(element);
                default:
                    this.preserve(element, parentId, `Preserved unsupported <${tag}> source.`);
                    return undefined;
            }
        } catch(error) {
            const message = error instanceof Error ? error.message : String(error);
            this.preserve(element, parentId, `Preserved <${tag}> as source: ${message}`);
            return undefined;
        }
    }

    private importGroup(element: Element): GroupSave {
        this.requireNativeFeatures(element);
        const id = this.id(element.getAttribute("id"), "group");
        const state = commonState(element, id, "Group", this.transform(element));
        return {
            type: "group",
            ...state,
            elements: this.importChildren(element, id),
            clipElementId: null,
        };
    }

    private importPath(element: Element): PathSave {
        this.requireNativeFeatures(element);
        const data = element.getAttribute("d")?.trim();
        if(!data) throw new SVGImportError("Path has no geometry.");
        const contours = parseSVGPathData(data, (prefix) => this.id(undefined, prefix));
        if(contours.length === 0) throw new SVGImportError("Path has no drawable segments.");
        const id = this.id(element.getAttribute("id"), "path");
        const paint = pathPaint(element);
        return {
            type: "path",
            ...commonState(element, id, "Path", this.transform(element)),
            closed: contours[0].closed,
            fillRule: paint.fillRule,
            settings: paint.settings,
            lines: contours[0].lines,
            contours,
        };
    }

    private importRect(element: Element): ShapeSave {
        this.requireNativeFeatures(element);
        const x = numberAttribute(element, "x", 0);
        const y = numberAttribute(element, "y", 0);
        const width = requiredNumberAttribute(element, "width");
        const height = requiredNumberAttribute(element, "height");
        const id = this.id(element.getAttribute("id"), "rectangle");
        const paint = shapePaint(element);
        return {
            type: "shape",
            ...commonState(element, id, "Rectangle", this.transform(element)),
            shapeType: "rectangle",
            position: { id: this.id(undefined, "point"), x, y },
            settings: {
                width,
                height,
                ...paint,
                corner_radius: Math.max(0, numberAttribute(element, "rx", numberAttribute(element, "ry", 0))),
            },
        };
    }

    private importEllipse(element: Element, circle: boolean): ShapeSave {
        this.requireNativeFeatures(element);
        const cx = numberAttribute(element, "cx", 0);
        const cy = numberAttribute(element, "cy", 0);
        const rx = circle ? requiredNumberAttribute(element, "r") : requiredNumberAttribute(element, "rx");
        const ry = circle ? rx : requiredNumberAttribute(element, "ry");
        const id = this.id(element.getAttribute("id"), circle ? "circle" : "ellipse");
        return {
            type: "shape",
            ...commonState(element, id, circle ? "Circle" : "Ellipse", this.transform(element)),
            shapeType: "ellipse",
            position: { id: this.id(undefined, "point"), x: cx - rx, y: cy - ry },
            settings: {
                width: rx * 2,
                height: ry * 2,
                ...shapePaint(element),
                corner_radius: 0,
            },
        };
    }

    private importLine(element: Element): PathSave {
        const x1 = numberAttribute(element, "x1", 0);
        const y1 = numberAttribute(element, "y1", 0);
        const x2 = numberAttribute(element, "x2", 0);
        const y2 = numberAttribute(element, "y2", 0);
        return this.importPointPath(element, [[x1, y1], [x2, y2]], false, "Line");
    }

    private importPoly(element: Element, closed: boolean): PathSave {
        const values = (element.getAttribute("points") ?? "").match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
        if(values.length < 4 || values.length % 2 !== 0) throw new SVGImportError("Point list is invalid.");
        const points: Array<[number, number]> = [];
        for(let i = 0; i < values.length; i += 2) points.push([values[i], values[i + 1]]);
        return this.importPointPath(element, points, closed, closed ? "Polygon" : "Polyline");
    }

    private importPointPath(element: Element, values: Array<[number, number]>, closed: boolean, fallbackName: string): PathSave {
        this.requireNativeFeatures(element);
        const id = this.id(element.getAttribute("id"), fallbackName.toLowerCase());
        const points = values.map(([x, y]) => ({ id: this.id(undefined, "point"), x, y }));
        const lines = points.slice(1).map((end, index) => ({
            id: this.id(undefined, "line"),
            type: "line" as const,
            points: [points[index], end],
        }));
        const paint = pathPaint(element, fallbackName === "Line" || fallbackName === "Polyline");
        const contour = { id: this.id(undefined, "contour"), closed, lines };
        return {
            type: "path",
            ...commonState(element, id, fallbackName, this.transform(element)),
            closed,
            fillRule: paint.fillRule,
            settings: paint.settings,
            lines,
            contours: [contour],
        };
    }

    private importText(element: Element): TextSave {
        this.requireNativeFeatures(element);
        if(element.querySelector("textPath")) throw new SVGImportError("Text-on-path is not native yet.");
        const id = this.id(element.getAttribute("id"), "text");
        const fill = colorValue(styleValue(element, "fill") ?? "#000000");
        if(fill === undefined) throw new SVGImportError("Text uses an unsupported paint.");
        return {
            type: "text",
            ...commonState(element, id, "Text", this.transform(element)),
            position: {
                id: this.id(undefined, "point"),
                x: firstNumber(styleValue(element, "x"), 0),
                y: firstNumber(styleValue(element, "y"), 0),
            },
            settings: {
                content: element.textContent ?? "",
                text_align: textAlign(styleValue(element, "text-anchor")),
                font_family: styleValue(element, "font-family") ?? "system-ui",
                font_size: firstNumber(styleValue(element, "font-size"), 16),
                font_weight: styleValue(element, "font-weight") ?? "400",
                color: fill,
            },
        };
    }

    private transform(element: Element): TransformSave | undefined {
        const source = element.getAttribute("transform")?.trim();
        if(!source) return undefined;
        const matrix = parseTransform(source);
        const decomposed = matrix ? decomposeTransform(matrix) : undefined;
        if(!decomposed) throw new SVGImportError("Transform contains skew or unsupported syntax.");
        return decomposed;
    }

    private requireNativeFeatures(element: Element): void {
        for(const attribute of UNSUPPORTED_NATIVE_ATTRIBUTES) {
            if(styleValue(element, attribute) != null && styleValue(element, attribute) !== "none") {
                throw new SVGImportError(`Attribute ${attribute} is not native yet.`);
            }
        }
        ["fill", "stroke"].forEach((attribute) => {
            const value = styleValue(element, attribute);
            if(value?.includes("url(")) throw new SVGImportError(`${attribute} paint servers are not native yet.`);
        });
    }

    private preserve(element: Element, parentId: string | null, warning: string): void {
        this.sourceNodes.push({
            id: this.id(undefined, "source"),
            parentId,
            tagName: element.localName.toLowerCase(),
            markup: new XMLSerializer().serializeToString(element),
        });
        this.warnings.push(warning);
    }

    private id(requested: string | null | undefined, prefix: string): string {
        const normalized = requested?.trim();
        if(normalized && /^[A-Za-z_][\w:.-]*$/.test(normalized) && !this.ids.has(normalized)) {
            this.ids.add(normalized);
            return normalized;
        }
        let generated: string;
        do {
            this.counter += 1;
            generated = `${prefix}-${this.counter}`;
        } while(this.ids.has(generated));
        this.ids.add(generated);
        return generated;
    }
}

function commonState(element: Element, id: string, fallbackName: string, transform?: TransformSave) {
    return {
        id,
        name: element.getAttribute("aria-label")?.trim() || element.getAttribute("data-name")?.trim() || element.getAttribute("id")?.trim() || fallbackName,
        visible: styleValue(element, "display") !== "none" && styleValue(element, "visibility") !== "hidden",
        locked: false,
        opacity: clamp01(firstNumber(styleValue(element, "opacity"), 1)),
        transform,
    };
}

function pathPaint(element: Element, openByDefault = false): Pick<PathSave, "settings" | "fillRule"> {
    const fillSource = styleValue(element, "fill") ?? (openByDefault ? "none" : "#000000");
    const strokeSource = styleValue(element, "stroke") ?? "none";
    const fill = colorValue(fillSource);
    const stroke = colorValue(strokeSource);
    if(fill === undefined || stroke === undefined) throw new SVGImportError("Paint value cannot be represented natively.");
    return {
        fillRule: styleValue(element, "fill-rule") === "nonzero" ? "nonzero" : "evenodd",
        settings: {
            stroke_width: Math.max(0, firstNumber(styleValue(element, "stroke-width"), 1)),
            fill_enabled: fill !== null,
            fill,
            stroke,
            line_cap: nullableStyle(element, "stroke-linecap"),
            line_join: nullableStyle(element, "stroke-linejoin"),
        },
    };
}

function shapePaint(element: Element): Pick<ShapeSave["settings"], "stroke_width" | "stroke" | "fill"> {
    const fill = colorValue(styleValue(element, "fill") ?? "#000000");
    const stroke = colorValue(styleValue(element, "stroke") ?? "none");
    if(fill === undefined || stroke === undefined) throw new SVGImportError("Paint value cannot be represented natively.");
    return {
        stroke_width: Math.max(0, firstNumber(styleValue(element, "stroke-width"), 1)),
        stroke,
        fill,
    };
}

function styleValue(element: Element, property: string): string | undefined {
    const inline = element.getAttribute("style")?.split(";").map((entry) => entry.split(":"))
        .find(([name]) => name?.trim().toLowerCase() === property)?.slice(1).join(":").trim();
    return inline || element.getAttribute(property)?.trim() || undefined;
}

function nullableStyle(element: Element, property: string): string | null {
    return styleValue(element, property) ?? null;
}

function colorValue(input: string): string | null | undefined {
    const value = input.trim().toLowerCase();
    if(value === "none" || value === "transparent") return null;
    if(value.startsWith("url(")) return undefined;
    if(/^#[0-9a-f]{6}$/i.test(value)) return value;
    if(/^#[0-9a-f]{3}$/i.test(value)) return `#${value.slice(1).split("").map((part) => part + part).join("")}`;
    const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
    if(rgb) {
        const alpha = rgb[4]?.endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4] ?? 1);
        if(alpha !== 1) return undefined;
        return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, "0")).join("")}`;
    }
    if(typeof CSS !== "undefined" && CSS.supports("color", value)) {
        const canvas = document.createElement("canvas").getContext("2d");
        if(canvas) {
            canvas.fillStyle = value;
            const normalized = canvas.fillStyle;
            if(/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
        }
    }
    return undefined;
}

function rootDimensions(root: Element): { width: number; height: number } {
    const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if(viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
        return { width: viewBox[2], height: viewBox[3] };
    }
    return {
        width: Math.max(1, firstNumber(root.getAttribute("width") ?? undefined, 300)),
        height: Math.max(1, firstNumber(root.getAttribute("height") ?? undefined, 150)),
    };
}

function requiredNumberAttribute(element: Element, name: string): number {
    const value = numberAttribute(element, name, Number.NaN);
    if(!Number.isFinite(value) || value < 0) throw new SVGImportError(`${name} is missing or invalid.`);
    return value;
}

function numberAttribute(element: Element, name: string, fallback: number): number {
    return firstNumber(element.getAttribute(name) ?? undefined, fallback);
}

function firstNumber(value: string | undefined, fallback: number): number {
    if(value == null) return fallback;
    const match = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/i.exec(value);
    const numeric = match ? Number(match[0]) : Number.NaN;
    return Number.isFinite(numeric) ? numeric : fallback;
}

function textAlign(value?: string): string {
    return value === "middle" || value === "end" ? value : "start";
}

function cleanDocumentName(value?: string): string | undefined {
    return value?.trim().replace(/\.svg$/i, "") || undefined;
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }

function countElements(elements: ElementSave[]): number {
    return elements.reduce((count, element) => count + 1 + (element.type === "group" ? countElements(element.elements) : 0), 0);
}

function parseTransform(source: string): Matrix | undefined {
    const pattern = /([a-z]+)\s*\(([^)]*)\)/gi;
    let matrix = identityMatrix();
    let lastIndex = 0;
    for(const match of source.matchAll(pattern)) {
        if(!/^\s*$/.test(source.slice(lastIndex, match.index))) return undefined;
        const values = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
        if(values.some((value) => !Number.isFinite(value))) return undefined;
        let next: Matrix | undefined;
        switch(match[1].toLowerCase()) {
            case "matrix": if(values.length === 6) next = { a: values[0], b: values[1], c: values[2], d: values[3], e: values[4], f: values[5] }; break;
            case "translate": if(values.length === 1 || values.length === 2) next = translationMatrix(values[0], values[1] ?? 0); break;
            case "scale": if(values.length === 1 || values.length === 2) next = scaleMatrix(values[0], values[1] ?? values[0]); break;
            case "rotate":
                if(values.length === 1) next = rotationMatrix(values[0]);
                else if(values.length === 3) next = multiplyMatrix(translationMatrix(values[1], values[2]), multiplyMatrix(rotationMatrix(values[0]), translationMatrix(-values[1], -values[2])));
                break;
        }
        if(!next) return undefined;
        matrix = multiplyMatrix(matrix, next);
        lastIndex = (match.index ?? 0) + match[0].length;
    }
    return /^\s*$/.test(source.slice(lastIndex)) ? matrix : undefined;
}

function decomposeTransform(matrix: Matrix): TransformSave | undefined {
    const scaleX = Math.hypot(matrix.a, matrix.b);
    if(scaleX < 0.000001) return undefined;
    const dot = matrix.a * matrix.c + matrix.b * matrix.d;
    if(Math.abs(dot) > 0.00001 * Math.max(1, scaleX)) return undefined;
    const scaleY = (matrix.a * matrix.d - matrix.b * matrix.c) / scaleX;
    return {
        translateX: matrix.e,
        translateY: matrix.f,
        scaleX,
        scaleY,
        rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
        originX: 0,
        originY: 0,
    };
}
