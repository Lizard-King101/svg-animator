import { Injectable } from "@angular/core";
import { GroupSave } from "../objects/elements/group.object";
import { PathSave } from "../objects/elements/path.object";
import { ShapeSave } from "../objects/elements/shape.object";
import { TextSave } from "../objects/elements/text.object";
import { ElementSave, ImportedSourceNode, SVGSave } from "../objects/svg.object";
import { TransformSave, identityMatrix, Matrix, multiplyMatrix, rotationMatrix, scaleMatrix, translationMatrix } from "../objects/transform.object";
import { parseSVGPathData, SVGPathParseError } from "./svg-path-parser";
import { sanitizeSVGText, SVGParseError } from "./svg-sanitizer";
import { GradientPaintSave, GradientSpreadMethod, GradientUnits, PaintSave } from "../objects/paint.object";
import { Color } from "../objects/color.object";

const UNSUPPORTED_NATIVE_ATTRIBUTES = [
    "clip-path", "mask", "filter", "marker", "marker-start", "marker-mid", "marker-end",
    "stroke-dasharray", "stroke-dashoffset", "vector-effect", "paint-order",
];

const EDITABLE_DEFINITION_TAGS = new Set([
    "clippath", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use",
    "lineargradient", "radialgradient", "stop",
]);

export interface SVGImportOptions { name?: string; }

export interface SVGImportResult {
    document: SVGSave;
    sanitizedMarkup: string;
    editability: "native" | "partial";
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
        const dimensions = rootDimensions(sanitized.root);
        const elements = context.normalizeViewBox(context.importChildren(sanitized.root, null), dimensions.minX, dimensions.minY);
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
            editability: context.sourceNodes.length === 0 ? "native" : "partial",
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
    private readonly definitions = new Map<string, Element>();
    private readonly resolvingDefinitions = new Set<string>();
    private counter = 0;

    constructor(root: SVGSVGElement, requestedName?: string) {
        this.documentId = this.id(root.getAttribute("id"), "document");
        this.documentName = cleanDocumentName(requestedName)
            || root.querySelector(":scope > title")?.textContent?.trim()
            || root.getAttribute("aria-label")?.trim()
            || this.documentId;
        Array.from(root.querySelectorAll("[id]")).forEach((element) => {
            const id = element.getAttribute("id")?.trim();
            if(id && !this.definitions.has(id)) this.definitions.set(id, element);
        });
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

    normalizeViewBox(elements: ElementSave[], minX: number, minY: number): ElementSave[] {
        if(Math.abs(minX) < 0.000001 && Math.abs(minY) < 0.000001) return elements;
        const id = this.id(undefined, "viewbox");
        this.sourceNodes.forEach((node) => {
            if(node.parentId === null) node.parentId = id;
        });
        return [{
            type: "group",
            id,
            name: "ViewBox",
            visible: true,
            locked: false,
            opacity: 1,
            transform: { translateX: -minX, translateY: -minY, scaleX: 1, scaleY: 1, rotation: 0, originX: 0, originY: 0 },
            clipElementId: null,
            elements,
        }];
    }

    private importElement(element: Element, parentId: string | null): ElementSave | undefined {
        try {
            return this.importResolvedElement(element, parentId);
        } catch(error) {
            const message = error instanceof Error ? error.message : String(error);
            this.preserve(element, parentId, `Preserved <${element.localName.toLowerCase()}> as source: ${message}`);
            return undefined;
        }
    }

    private importResolvedElement(element: Element, parentId: string | null): ElementSave | undefined {
        const tag = element.localName.toLowerCase();
        if(tag === "defs") {
            this.importDefinitions(element, parentId);
            return undefined;
        }

        const clipReference = localUrlReference(styleValue(element, "clip-path"));
        if(styleValue(element, "clip-path") != null && styleValue(element, "clip-path") !== "none") {
            if(!clipReference) throw new SVGImportError("Only local clip-path references can be edited.");
            return this.importClippedElement(element, clipReference);
        }

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
            case "use": return this.importUse(element);
            default: throw new SVGImportError(`Unsupported <${tag}> element.`);
        }
    }

    private importDefinitions(element: Element, parentId: string | null): void {
        const containsOpaqueDefinitions = Array.from(element.children)
            .some((child) => !canNormalizeDefinition(child));
        if(containsOpaqueDefinitions) {
            // Keep the complete definition scope so preserved resources can still
            // reference editable definitions (for example filter + clip-path).
            Array.from(element.querySelectorAll("[id]")).forEach((definition) => {
                const id = definition.getAttribute("id")?.trim();
                if(id) this.ids.add(id);
            });
            this.preserve(element, parentId, "Preserved definitions that are not editable yet.");
        }
    }

    private importClippedElement(element: Element, referenceId: string): GroupSave {
        const unclipped = withoutStyleProperty(element, "clip-path");
        const artwork = this.importResolvedElement(unclipped, null);
        if(!artwork) throw new SVGImportError("Clipped artwork is not editable yet.");
        const clipElement = this.importClipPath(referenceId);
        const id = this.id(undefined, "clip-group");
        const state = commonState(element, id, `Clip ${artwork.name}`, this.transform(element));
        // The referencing element's transform and opacity affect its clip as a unit.
        // Hoist them to the native clipping group instead of applying them twice.
        artwork.transform = undefined;
        artwork.opacity = 1;
        artwork.visible = true;
        return {
            type: "group",
            ...state,
            name: `Clip ${artwork.name}`,
            elements: [artwork, clipElement],
            clipElementId: clipElement.id,
        };
    }

    private importClipPath(referenceId: string): ElementSave {
        const definition = this.definitions.get(referenceId);
        if(!definition || definition.localName.toLowerCase() !== "clippath") {
            throw new SVGImportError(`Clip path #${referenceId} was not found.`);
        }
        if(this.resolvingDefinitions.has(referenceId)) {
            throw new SVGImportError(`Clip path #${referenceId} contains a reference cycle.`);
        }
        const units = definition.getAttribute("clipPathUnits")?.trim() || "userSpaceOnUse";
        if(units !== "userSpaceOnUse") {
            throw new SVGImportError(`Clip path #${referenceId} uses unsupported ${units} units.`);
        }

        this.resolvingDefinitions.add(referenceId);
        try {
            const children = Array.from(definition.children).map((child) => {
                const imported = this.importResolvedElement(child.cloneNode(true) as Element, null);
                if(!imported) throw new SVGImportError(`Clip path #${referenceId} contains unsupported geometry.`);
                return imported;
            });
            if(children.length === 0) throw new SVGImportError(`Clip path #${referenceId} is empty.`);

            let geometry: ElementSave;
            if(children.length === 1 && !definition.getAttribute("transform")) {
                geometry = children[0];
            } else {
                geometry = this.definitionGroup(definition, children, "clip-shapes");
            }

            const nestedReference = localUrlReference(styleValue(definition, "clip-path"));
            if(!nestedReference) return geometry;
            const nestedClip = this.importClipPath(nestedReference);
            const intersection = this.definitionGroup(definition, [geometry, nestedClip], "clip-intersection");
            intersection.clipElementId = nestedClip.id;
            return intersection;
        } finally {
            this.resolvingDefinitions.delete(referenceId);
        }
    }

    private importUse(element: Element): GroupSave {
        const referenceId = localFragmentReference(element.getAttribute("href") ?? element.getAttribute("xlink:href"));
        if(!referenceId) throw new SVGImportError("Only local use references can be expanded for editing.");
        const definition = this.definitions.get(referenceId);
        if(!definition) throw new SVGImportError(`Referenced element #${referenceId} was not found.`);
        if(this.resolvingDefinitions.has(referenceId)) throw new SVGImportError(`Use reference #${referenceId} contains a cycle.`);

        this.resolvingDefinitions.add(referenceId);
        try {
            const expanded = this.importResolvedElement(definition.cloneNode(true) as Element, null);
            if(!expanded) throw new SVGImportError(`Referenced element #${referenceId} is not editable yet.`);
            const id = this.id(element.getAttribute("id"), "use");
            return {
                type: "group",
                ...commonState(element, id, `Use ${expanded.name}`, this.useTransform(element)),
                elements: [expanded],
                clipElementId: null,
            };
        } finally {
            this.resolvingDefinitions.delete(referenceId);
        }
    }

    private useTransform(element: Element): TransformSave | undefined {
        const source = element.getAttribute("transform")?.trim();
        const transform = source ? parseTransform(source) : identityMatrix();
        if(!transform) throw new SVGImportError("Use transform contains skew or unsupported syntax.");
        const positioned = multiplyMatrix(
            transform,
            translationMatrix(numberAttribute(element, "x", 0), numberAttribute(element, "y", 0)),
        );
        const decomposed = decomposeTransform(positioned);
        if(!decomposed) throw new SVGImportError("Use position cannot be represented natively.");
        return decomposed;
    }

    private definitionGroup(definition: Element, elements: ElementSave[], prefix: string): GroupSave {
        const id = this.id(definition.getAttribute("id"), prefix);
        return {
            type: "group",
            ...commonState(definition, id, "Clip Path", this.transform(definition)),
            elements,
            clipElementId: null,
        };
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
        const paint = pathPaint(element, false, (value) => this.paint(value));
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
        const paint = shapePaint(element, (value) => this.paint(value));
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
                ...shapePaint(element, (value) => this.paint(value)),
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
        const paint = pathPaint(element, fallbackName === "Line" || fallbackName === "Polyline", (value) => this.paint(value));
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
    }

    private paint(source: string): PaintSave | undefined {
        const referenceId = localUrlReference(source);
        if(referenceId) return this.importGradient(referenceId);
        return colorValue(source);
    }

    private importGradient(referenceId: string): GradientPaintSave {
        const definition = this.definitions.get(referenceId);
        const tag = definition?.localName.toLowerCase();
        if(!definition || (tag !== "lineargradient" && tag !== "radialgradient")) {
            throw new SVGImportError(`Paint server #${referenceId} is not an editable gradient.`);
        }
        if(this.resolvingDefinitions.has(referenceId)) {
            throw new SVGImportError(`Gradient #${referenceId} contains a reference cycle.`);
        }

        this.resolvingDefinitions.add(referenceId);
        try {
            const inheritedId = localFragmentReference(definition.getAttribute("href") ?? definition.getAttribute("xlink:href"));
            const inherited = inheritedId ? this.importGradient(inheritedId) : undefined;
            const type = tag === "lineargradient" ? "linear-gradient" as const : "radial-gradient" as const;
            const units = gradientUnits(definition.getAttribute("gradientUnits"), inherited?.units);
            const spreadMethod = gradientSpreadMethod(definition.getAttribute("spreadMethod"), inherited?.spreadMethod);
            let coordinates: GradientPaintSave["coordinates"];
            if(type === "linear-gradient") {
                coordinates = {
                    x1: gradientCoordinate(definition, "x1", inherited?.coordinates.x1 ?? 0),
                    y1: gradientCoordinate(definition, "y1", inherited?.coordinates.y1 ?? 0),
                    x2: gradientCoordinate(definition, "x2", inherited?.coordinates.x2 ?? 1),
                    y2: gradientCoordinate(definition, "y2", inherited?.coordinates.y2 ?? 0),
                };
            } else {
                const cx = gradientCoordinate(definition, "cx", inherited?.coordinates.cx ?? 0.5);
                const cy = gradientCoordinate(definition, "cy", inherited?.coordinates.cy ?? 0.5);
                coordinates = {
                    cx,
                    cy,
                    r: gradientCoordinate(definition, "r", inherited?.coordinates.r ?? 0.5),
                    fx: gradientCoordinate(definition, "fx", inherited?.coordinates.fx ?? cx),
                    fy: gradientCoordinate(definition, "fy", inherited?.coordinates.fy ?? cy),
                };
            }
            const ownStops = Array.from(definition.children).filter((child) => child.localName.toLowerCase() === "stop");
            const stops = ownStops.length > 0
                ? ownStops.map((stop) => this.importGradientStop(stop))
                : inherited?.stops.map((stop) => ({ ...stop, id: this.id(undefined, "stop") })) ?? [];
            if(stops.length === 0) throw new SVGImportError(`Gradient #${referenceId} has no stops.`);

            return {
                type,
                id: this.id(definition.getAttribute("id"), "gradient"),
                units,
                spreadMethod,
                transform: gradientTransform(definition.getAttribute("gradientTransform"), inherited?.transform),
                coordinates,
                stops,
            };
        } finally {
            this.resolvingDefinitions.delete(referenceId);
        }
    }

    private importGradientStop(element: Element) {
        const color = colorValue(styleValue(element, "stop-color") ?? "#000000");
        if(typeof color !== "string") throw new SVGImportError("Gradient stop color is unsupported.");
        return {
            id: this.id(element.getAttribute("id"), "stop"),
            offset: clamp01(gradientOffset(element.getAttribute("offset"))),
            color,
            opacity: clamp01(firstNumber(styleValue(element, "stop-opacity"), 1)),
        };
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

function localUrlReference(value?: string): string | undefined {
    if(!value) return undefined;
    const match = /^url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)$/i.exec(value.trim());
    return match?.[2];
}

function canNormalizeDefinition(element: Element): boolean {
    const tag = element.localName.toLowerCase();
    if(!EDITABLE_DEFINITION_TAGS.has(tag)) return false;
    if(tag === "clippath") {
        const units = element.getAttribute("clipPathUnits")?.trim() || "userSpaceOnUse";
        if(units !== "userSpaceOnUse") return false;
    }
    if(tag === "clippath" || tag === "g") {
        return Array.from(element.children).every(canNormalizeDefinition);
    }
    return true;
}

function localFragmentReference(value: string | null): string | undefined {
    const match = /^#([^\s]+)$/.exec(value?.trim() ?? "");
    return match?.[1];
}

function withoutStyleProperty(element: Element, property: string): Element {
    const clone = element.cloneNode(true) as Element;
    clone.removeAttribute(property);
    const declarations = (clone.getAttribute("style") ?? "").split(";").filter((entry) => {
        const separator = entry.indexOf(":");
        return separator < 0 || entry.slice(0, separator).trim().toLowerCase() !== property;
    });
    const style = declarations.map((entry) => entry.trim()).filter(Boolean).join("; ");
    if(style) clone.setAttribute("style", style);
    else clone.removeAttribute("style");
    return clone;
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

function pathPaint(element: Element, openByDefault = false, resolvePaint: (value: string) => PaintSave | undefined = colorValue): Pick<PathSave, "settings" | "fillRule"> {
    const fillSource = styleValue(element, "fill") ?? (openByDefault ? "none" : "#000000");
    const strokeSource = styleValue(element, "stroke") ?? "none";
    const fill = resolvePaint(fillSource);
    const stroke = resolvePaint(strokeSource);
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

function shapePaint(element: Element, resolvePaint: (value: string) => PaintSave | undefined = colorValue): Pick<ShapeSave["settings"], "stroke_width" | "stroke" | "fill"> {
    const fill = resolvePaint(styleValue(element, "fill") ?? "#000000");
    const stroke = resolvePaint(styleValue(element, "stroke") ?? "none");
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

function gradientUnits(value: string | null, inherited?: GradientUnits): GradientUnits {
    const normalized = value?.trim();
    if(!normalized) return inherited ?? "objectBoundingBox";
    if(normalized === "objectBoundingBox" || normalized === "userSpaceOnUse") return normalized;
    throw new SVGImportError(`Unsupported gradientUnits value ${normalized}.`);
}

function gradientSpreadMethod(value: string | null, inherited?: GradientSpreadMethod): GradientSpreadMethod {
    const normalized = value?.trim();
    if(!normalized) return inherited ?? "pad";
    if(normalized === "pad" || normalized === "reflect" || normalized === "repeat") return normalized;
    throw new SVGImportError(`Unsupported gradient spread method ${normalized}.`);
}

function gradientCoordinate(element: Element, name: string, fallback: number): number {
    const source = element.getAttribute(name)?.trim();
    if(!source) return fallback;
    if(source.endsWith("%")) {
        const value = Number(source.slice(0, -1));
        if(Number.isFinite(value)) return value / 100;
    }
    const value = Number(source);
    if(Number.isFinite(value)) return value;
    throw new SVGImportError(`Gradient coordinate ${name} is invalid.`);
}

function gradientOffset(value: string | null): number {
    const source = value?.trim() ?? "0";
    if(source.endsWith("%")) return Number(source.slice(0, -1)) / 100;
    const numeric = Number(source);
    if(!Number.isFinite(numeric)) throw new SVGImportError("Gradient stop offset is invalid.");
    return numeric;
}

function gradientTransform(value: string | null, inherited?: GradientPaintSave["transform"]): GradientPaintSave["transform"] {
    if(!value?.trim()) return inherited ? [...inherited] : undefined;
    const matrix = parseTransform(value.trim());
    if(!matrix) throw new SVGImportError("Gradient transform contains unsupported syntax.");
    return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
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
    if(/^#[0-9a-f]{4}(?:[0-9a-f]{4})?$/i.test(value)) return new Color(value).serialized;
    const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
    if(rgb) {
        const alpha = rgb[4]?.endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4] ?? 1);
        const hex = `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, "0")).join("")}`;
        const color = new Color(hex);
        color.alpha = clamp01(alpha);
        return color.serialized;
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

function rootDimensions(root: Element): { minX: number; minY: number; width: number; height: number } {
    const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if(viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
        return { minX: viewBox[0], minY: viewBox[1], width: viewBox[2], height: viewBox[3] };
    }
    return {
        minX: 0,
        minY: 0,
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
