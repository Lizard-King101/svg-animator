const FORBIDDEN_ELEMENTS = new Set([
    "script", "foreignobject", "iframe", "object", "embed", "audio", "video",
    "style", "animate", "animatemotion", "animatetransform", "set",
]);

const SAFE_STYLE_PROPERTIES = new Set([
    "display", "visibility", "opacity", "fill", "fill-opacity", "fill-rule",
    "stroke", "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin",
    "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "paint-order",
    "vector-effect", "font-family", "font-size", "font-style", "font-weight",
    "letter-spacing", "word-spacing", "text-anchor", "dominant-baseline",
    "transform", "transform-origin", "clip-path", "mask", "filter", "mix-blend-mode",
    "marker", "marker-start", "marker-mid", "marker-end", "stop-color", "stop-opacity",
    "flood-color", "flood-opacity", "lighting-color", "color", "background-color",
    "enable-background", "overflow", "cursor", "text-decoration", "baseline-shift",
    "shape-rendering", "color-rendering", "image-rendering", "color-interpolation",
]);

export interface SanitizedSVG {
    root: SVGSVGElement;
    markup: string;
    warnings: string[];
    removedCount: number;
}

export class SVGParseError extends Error {}

/** Parses into an inert XML document and strips active/external content. */
export function sanitizeSVGText(source: string): SanitizedSVG {
    const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
    const parserError = parsed.querySelector("parsererror");
    if(parserError) throw new SVGParseError(parserError.textContent?.trim() || "Invalid SVG XML.");
    const root = parsed.documentElement;
    if(root.localName.toLowerCase() !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg") {
        throw new SVGParseError("The selected file does not have an SVG root element.");
    }

    const warnings: string[] = [];
    let removedCount = 0;
    const remove = (message: string) => {
        removedCount += 1;
        warnings.push(message);
    };

    const sanitizeElement = (element: Element): boolean => {
        const tagName = element.localName.toLowerCase();
        if(FORBIDDEN_ELEMENTS.has(tagName)) {
            remove(`Removed active <${tagName}> content.`);
            element.remove();
            return false;
        }

        Array.from(element.attributes).forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim();
            if(name.startsWith("on")) {
                element.removeAttributeNode(attribute);
                remove(`Removed event attribute ${attribute.name}.`);
                return;
            }
            if(name === "href" || name === "xlink:href" || name === "src") {
                if(!isSafeResourceReference(value)) {
                    element.removeAttributeNode(attribute);
                    remove(`Removed unsafe resource reference from ${attribute.name}.`);
                }
                return;
            }
            if(name === "style") {
                const sanitized = sanitizeStyle(value);
                if(sanitized.value) element.setAttribute(attribute.name, sanitized.value);
                else element.removeAttributeNode(attribute);
                if(sanitized.removed) remove("Removed unsupported or unsafe inline styles.");
                return;
            }
            if(containsUnsafeUrl(value)) {
                element.removeAttributeNode(attribute);
                remove(`Removed unsafe URL value from ${attribute.name}.`);
            }
        });

        Array.from(element.children).forEach(sanitizeElement);
        return true;
    };

    sanitizeElement(root);
    return {
        root: root as unknown as SVGSVGElement,
        markup: new XMLSerializer().serializeToString(root),
        warnings: unique(warnings),
        removedCount,
    };
}

function sanitizeStyle(style: string): { value: string; removed: boolean } {
    const declarations: string[] = [];
    let removed = false;
    style.split(";").forEach((entry) => {
        const separator = entry.indexOf(":");
        if(!entry.trim()) return;
        if(separator < 1) {
            removed = true;
            return;
        }
        const property = entry.slice(0, separator).trim().toLowerCase();
        const value = entry.slice(separator + 1).trim();
        if(!SAFE_STYLE_PROPERTIES.has(property) || !value || containsUnsafeUrl(value)) {
            removed = true;
            return;
        }
        declarations.push(`${property}: ${value}`);
    });
    return { value: declarations.join("; "), removed };
}

function isSafeResourceReference(value: string): boolean {
    if(value.startsWith("#")) return true;
    return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
}

function containsUnsafeUrl(value: string): boolean {
    if(/(?:javascript|vbscript)\s*:/i.test(value) || /expression\s*\(/i.test(value) || /@import/i.test(value)) return true;
    const urls = [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)];
    return urls.some((match) => !match[2].trim().startsWith("#"));
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}
