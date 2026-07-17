import { RuntimePlayer, RuntimePlayerOptions, SvgRootInput } from "./player";
export interface AnimatedSvgBootstrapOptions extends RuntimePlayerOptions {
    root?: SVGSVGElement;
}
/** Mounts artwork whose matching runtime bundle is embedded as inert JSON. */
export declare function createEmbeddedPlayer(svgOrSelector: SvgRootInput, options?: RuntimePlayerOptions): RuntimePlayer;
/** Starts a self-contained Animated SVG from its inert embedded JSON payload. */
export declare function bootstrapAnimatedSVG(options?: AnimatedSvgBootstrapOptions): RuntimePlayer;
//# sourceMappingURL=bootstrap.d.ts.map