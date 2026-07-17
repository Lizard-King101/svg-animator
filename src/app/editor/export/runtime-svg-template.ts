import { escapeXmlText } from "../svg-markup";

/** Adds a portable runtime bundle as inert data without including executable player code. */
export function buildEmbeddedAnimationSvg(artwork: string, bundleJson: string): string {
    const inertJson = bundleJson.replace(/<\//g, "<\\/").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    return appendToSvg(artwork, `  <script type="application/json" data-svg-animator-bundle="">${escapeXmlText(inertJson)}</script>`);
}

/** Adds the matching browser runtime and autoplay bootstrap to an embedded-animation SVG. */
export function buildSelfContainedAnimatedSvg(artwork: string, bundleJson: string, browserRuntime: string): string {
    const embedded = buildEmbeddedAnimationSvg(artwork, bundleJson);
    const safeRuntime = browserRuntime.replace(/]]>/g, "]]\\x3e");
    return appendToSvg(embedded, `  <script><![CDATA[${safeRuntime}\nSVGAnimatorRuntime.bootstrapAnimatedSVG();]]></script>`);
}

function appendToSvg(markup: string, content: string): string { return markup.replace("</svg>", `${content}\n</svg>`); }
