import { RuntimePlayerError } from "./errors";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
/** Accepts SVG roots from the current window and same-origin object/iframe documents. */
export function isSvgRoot(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    const ownerConstructor = candidate.ownerDocument?.defaultView?.SVGSVGElement;
    if (typeof ownerConstructor === "function")
        return candidate instanceof ownerConstructor;
    return candidate.nodeType === 1
        && candidate.namespaceURI === SVG_NAMESPACE
        && candidate.localName === "svg"
        && typeof candidate.getAttribute === "function"
        && typeof candidate.querySelector === "function";
}
/** Resolves selector inputs while preserving support for same-origin object/iframe SVG roots. */
export function resolveSvgRoot(value) {
    const root = typeof value === "string" ? document.querySelector(value) : value;
    if (!isSvgRoot(root))
        throw new RuntimePlayerError("svg-root-not-found", `Could not resolve an SVG root from ${String(value)}.`);
    return root;
}
//# sourceMappingURL=dom.internal.js.map