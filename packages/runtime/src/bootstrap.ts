import { RuntimeBundleV1 } from "./contracts";
import { isSvgRoot, resolveSvgRoot } from "./dom.internal";
import { RuntimePlayerError } from "./errors";
import { createPlayer, RuntimePlayer, RuntimePlayerOptions, SvgRootInput } from "./player";

export interface AnimatedSvgBootstrapOptions extends RuntimePlayerOptions {
    root?: SVGSVGElement;
}

/** Mounts artwork whose matching runtime bundle is embedded as inert JSON. */
export function createEmbeddedPlayer(svgOrSelector: SvgRootInput, options?: RuntimePlayerOptions): RuntimePlayer {
    const root = resolveSvgRoot(svgOrSelector);
    return createPlayer(root, readEmbeddedBundle(root), options);
}

/** Starts a self-contained Animated SVG from its inert embedded JSON payload. */
export function bootstrapAnimatedSVG(options: AnimatedSvgBootstrapOptions = {}): RuntimePlayer {
    const root = options.root ?? document.documentElement;
    if(!isSvgRoot(root)) throw new RuntimePlayerError("svg-root-not-found", "Animated SVG bootstrap requires an SVG document root.");
    const { root: _root, ...playerOptions } = options;
    return createPlayer(root, readEmbeddedBundle(root), { autoPlay: true, ...playerOptions });
}

function readEmbeddedBundle(root: SVGSVGElement): RuntimeBundleV1 {
    const payload = root.querySelector<HTMLScriptElement>('script[type="application/json"][data-svg-animator-bundle]');
    if(!payload?.textContent) throw new RuntimePlayerError("invalid-bundle", "SVG contains no embedded runtime bundle.");
    try { return JSON.parse(payload.textContent) as RuntimeBundleV1; }
    catch(error) { throw new RuntimePlayerError("malformed-json", "Embedded runtime bundle is not valid JSON.", error); }
}
