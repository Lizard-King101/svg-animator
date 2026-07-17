# SVG Animator Runtime public API report

Generated from runtime v1 TypeScript declarations. Changes require SemVer review.

## bootstrap.d.ts

```ts
import { RuntimePlayer, RuntimePlayerOptions, SvgRootInput } from "./player";
export interface AnimatedSvgBootstrapOptions extends RuntimePlayerOptions {
    root?: SVGSVGElement;
}
/** Mounts artwork whose matching runtime bundle is embedded as inert JSON. */
export declare function createEmbeddedPlayer(svgOrSelector: SvgRootInput, options?: RuntimePlayerOptions): RuntimePlayer;
/** Starts a self-contained Animated SVG from its inert embedded JSON payload. */
export declare function bootstrapAnimatedSVG(options?: AnimatedSvgBootstrapOptions): RuntimePlayer;
```

## contracts.d.ts

```ts
export declare const RUNTIME_BUNDLE_KIND: "svg-animator/runtime-bundle";
export declare const RUNTIME_BUNDLE_FORMAT_VERSION: 1;
export declare const RUNTIME_VERSION: "1.0.0";
export declare const RUNTIME_BROWSER_GLOBAL: "SVGAnimatorRuntime";
export declare const RUNTIME_CAPABILITIES_V1: readonly ["tracks.numeric-v1", "tracks.color-v1", "tracks.discrete-v1", "render.transforms-v1", "render.geometry-v1", "render.paint-v1", "render.gradient-v1", "render.path-v1", "render.clipping-v1", "render.motion-path-v1"];
export type RuntimeCapabilityV1 = typeof RUNTIME_CAPABILITIES_V1[number];
export type RuntimeSegmentMode = "linear" | "hold" | "ease-in" | "ease-out" | "ease-in-out" | "temporal";
export interface CompiledNumericTrackV1 {
    kind: "number";
    target: number;
    property: number;
    times: number[];
    values: number[];
    segmentModes: RuntimeSegmentMode[];
    /** Eight polynomial coefficients per temporal segment, otherwise eight zeroes. */
    temporalCoefficients: number[];
}
export interface CompiledColorTrackV1 {
    kind: "color";
    target: number;
    property: number;
    times: number[];
    /** RGBA packed as 0xRRGGBBAA. */
    values: number[];
    interpolationSpaces: ("rgb" | "hsl")[];
    segmentModes: RuntimeSegmentMode[];
}
export interface CompiledDiscreteTrackV1 {
    kind: "boolean" | "string";
    target: number;
    property: number;
    times: number[];
    values: (boolean | string)[];
}
export type CompiledRuntimeTrackV1 = CompiledNumericTrackV1 | CompiledColorTrackV1 | CompiledDiscreteTrackV1;
export interface RuntimePointV1 {
    id: string;
    x: number;
    y: number;
    cornerRadius?: number;
}
export interface RuntimeLineV1 {
    id: string;
    type: "line" | "bezier";
    points: [RuntimePointV1, RuntimePointV1];
    controlStart?: RuntimePointV1;
    controlEnd?: RuntimePointV1;
}
export interface RuntimeContourV1 {
    id: string;
    closed: boolean;
    lines: RuntimeLineV1[];
}
export interface RuntimeTransformV1 {
    translateX: number;
    translateY: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    originX: number;
    originY: number;
    /** True when the resolved origin follows native geometry bounds. */
    autoOrigin: boolean;
}
export interface RuntimeMotionV1 {
    pathId: string | null;
    progress: number;
    offsetX: number;
    offsetY: number;
    rotateToPath: boolean;
    offsetAngle: number;
}
export interface RuntimeSolidPaintV1 {
    kind: "solid";
    color: string;
    opacity: number;
}
export interface RuntimeGradientStopV1 {
    id: string;
    offset: number;
    color: string;
    opacity: number;
}
export interface RuntimeGradientPaintV1 {
    kind: "gradient";
    id: string;
    gradientType: "linear-gradient" | "radial-gradient";
    units: "objectBoundingBox" | "userSpaceOnUse";
    spreadMethod: "pad" | "reflect" | "repeat";
    transform: [number, number, number, number, number, number];
    coordinates: Partial<Record<"x1" | "y1" | "x2" | "y2" | "cx" | "cy" | "r" | "fx" | "fy", number>>;
    stops: RuntimeGradientStopV1[];
}
export type RuntimePaintV1 = RuntimeSolidPaintV1 | RuntimeGradientPaintV1 | null;
export interface RuntimeSceneTargetV1 {
    id: string;
    parentId: string | null;
    type: "group" | "path" | "rectangle" | "ellipse" | "text";
    visible: boolean;
    opacity: number;
    transform: RuntimeTransformV1;
    motion: RuntimeMotionV1;
    geometry: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    clipping?: {
        clipElementId: string;
        clipPathId: string;
    };
    path?: {
        contours: RuntimeContourV1[];
        fillRule: "nonzero" | "evenodd";
        drawProgress: number;
        rounded: boolean;
    };
    paints: {
        fill?: RuntimePaintV1;
        stroke?: RuntimePaintV1;
        color?: RuntimePaintV1;
    };
    stroke?: {
        width: number;
        alignment: "inside" | "center" | "outside";
        dasharray: number[];
        dashoffset: number;
    };
}
export interface RuntimeMarkerV1 {
    id: string;
    time: number;
    name: string;
}
export interface RuntimeVariableV1 {
    name: string;
    value: number | string | boolean;
}
export interface RuntimeBundleV1 {
    kind: typeof RUNTIME_BUNDLE_KIND;
    formatVersion: typeof RUNTIME_BUNDLE_FORMAT_VERSION;
    generator: {
        name: "SVG Animator";
        version: string;
    };
    requiredCapabilities: RuntimeCapabilityV1[];
    artwork: {
        id: string;
        signature: string;
        width: number;
        height: number;
        viewBox: [number, number, number, number];
        targets: RuntimeSceneTargetV1[];
    };
    animation: {
        duration: number;
        loop: boolean;
        markers: RuntimeMarkerV1[];
        variables: RuntimeVariableV1[];
        targets: string[];
        properties: string[];
        tracks: CompiledRuntimeTrackV1[];
    };
}
export interface RuntimeCompileDiagnostic {
    code: "orphaned-target" | "unsupported-property" | "invalid-value" | "skipped-track";
    trackId: string;
    targetId: string;
    property: string;
    layerName?: string;
    message: string;
    correction: string;
}
export interface RuntimeCompileResultV1 {
    bundle: RuntimeBundleV1;
    diagnostics: RuntimeCompileDiagnostic[];
}
```

## errors.d.ts

```ts
export type RuntimeErrorCode = "invalid-bundle" | "unsupported-bundle-version" | "unsupported-capability" | "artwork-signature-mismatch" | "svg-root-not-found" | "fetch-failed" | "malformed-json" | "player-destroyed";
export declare class RuntimePlayerError extends Error {
    readonly code: RuntimeErrorCode;
    readonly cause?: unknown | undefined;
    readonly name = "RuntimePlayerError";
    constructor(code: RuntimeErrorCode, message: string, cause?: unknown | undefined);
}
```

## evaluator.d.ts

```ts
import { CompiledRuntimeTrackV1 } from "./contracts";
export declare function evaluateRuntimeTrack(track: CompiledRuntimeTrackV1, time: number): number | boolean | string | undefined;
export declare function packedColorValue(value: number): {
    color: string;
    opacity: number;
};
```

## index.d.ts

```ts
export * from "./contracts";
export * from "./errors";
export * from "./evaluator";
export * from "./player";
export * from "./bootstrap";
```

## path-data.d.ts

```ts
import { RuntimeContourV1 } from "./contracts";
/** Shared framework-free path reconstruction used by authoring and playback. */
export declare function buildRuntimePathData(contours: RuntimeContourV1[], rounded?: boolean): string;
```

## player.d.ts

```ts
import { RuntimeBundleV1, RuntimeMarkerV1 } from "./contracts";
import { RuntimePlayerError } from "./errors";
export type RuntimePlayerState = "paused" | "playing" | "stopped" | "destroyed";
export type RuntimeMarkerDirection = "forward" | "reverse";
export interface RuntimePlayerEventMap {
    ready: {
        player: RuntimePlayer;
    };
    play: {
        time: number;
    };
    pause: {
        time: number;
    };
    stop: {
        time: number;
    };
    seek: {
        time: number;
        previousTime: number;
    };
    complete: {
        time: number;
    };
    loop: {
        time: number;
        iteration: number;
        direction: RuntimeMarkerDirection;
    };
    marker: {
        marker: RuntimeMarkerV1;
        direction: RuntimeMarkerDirection;
    };
    error: {
        error: RuntimePlayerError;
    };
    destroy: Record<string, never>;
}
export type RuntimePlayerEventType = keyof RuntimePlayerEventMap;
export type RuntimePlayerListener<K extends RuntimePlayerEventType> = (event: RuntimePlayerEventMap[K]) => void;
export interface RuntimePlayerOptions {
    autoPlay?: boolean;
    loop?: boolean;
    playbackRate?: number;
    /** Allows generated autoplay even when the user prefers reduced motion. */
    autoplayWhenReducedMotion?: boolean;
}
export type SvgRootInput = SVGSVGElement | string;
export declare class RuntimePlayer {
    readonly root: SVGSVGElement;
    readonly bundle: RuntimeBundleV1;
    private _time;
    private _state;
    private _playbackRate;
    private _loop;
    private frameId?;
    private lastFrameTime?;
    private loopIteration;
    private readonly listeners;
    private readonly scene;
    private readonly initialAttributes;
    constructor(root: SVGSVGElement, bundle: RuntimeBundleV1, options?: RuntimePlayerOptions);
    get time(): number;
    get duration(): number;
    get state(): RuntimePlayerState;
    get playbackRate(): number;
    set playbackRate(value: number);
    get loop(): boolean;
    set loop(value: boolean);
    setPlaybackRate(value: number): this;
    setLoop(value: boolean): this;
    play(): this;
    pause(): this;
    stop(): this;
    seek(time: number): this;
    destroy(): void;
    on<K extends RuntimePlayerEventType>(type: K, listener: RuntimePlayerListener<K>): () => void;
    off<K extends RuntimePlayerEventType>(type: K, listener: RuntimePlayerListener<K>): void;
    private tick;
    private advance;
    private applyAt;
    private emitMarkers;
    private emit;
    private assertActive;
}
export declare function createPlayer(svgOrSelector: SvgRootInput, bundle: RuntimeBundleV1, options?: RuntimePlayerOptions): RuntimePlayer;
export declare function loadPlayer(svgOrSelector: SvgRootInput, bundleUrl: string | URL, options?: RuntimePlayerOptions): Promise<RuntimePlayer>;
export declare function validateRuntimeBundle(value: unknown): asserts value is RuntimeBundleV1;
```

## scene.d.ts

```ts
import { RuntimeSceneTargetV1 } from "./contracts";
export declare class RuntimeScene {
    private readonly root;
    readonly targets: RuntimeSceneTargetV1[];
    private readonly targetById;
    private readonly nodeById;
    constructor(root: SVGSVGElement, sourceTargets: RuntimeSceneTargetV1[]);
    write(targetId: string, property: string, value: unknown): boolean;
    render(): void;
    clear(): void;
    private writeGeometryPosition;
    private writeGeometrySize;
    /** Mirrors the editor's native-geometry mutation contract for pinned origins and user-space paints. */
    private transformAttachedGeometry;
    private writePathPoint;
    private writeSolidPaint;
    private writeGradient;
    private renderGeometry;
    private renderAppearance;
    private renderGradients;
    private roleNodes;
    private motionAdjustedMatrix;
    private sampleMotion;
    private combinedMatrix;
    private parentMatrix;
    private chain;
    private ownMatrix;
    private node;
}
```
