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
import type { RigDocument } from './rig/armature';
import type { OutlineSection } from './outline';
export type { OutlinePosition, OutlineTaper, OutlineSection } from './outline';
export type { Armature, Bone, BoneWeight, BoundPoint, PathBinding, RigidAttachment, TwoBoneIKConstraint, RigDocument, WeightPointRef } from './rig/armature';
export declare const RUNTIME_VERSION: "1.5.0";
export declare const RUNTIME_BROWSER_GLOBAL: "SVGAnimatorRuntime";
export declare const RUNTIME_CAPABILITIES_V1: readonly ["tracks.numeric-v1", "rig.pose-v1", "composition.action-windows-v1", "composition.action-timing-v1", "tracks.color-v1", "tracks.discrete-v1", "render.transforms-v1", "render.geometry-v1", "render.paint-v1", "render.gradient-v1", "render.path-v1", "render.outline-sections-v1", "render.clipping-v1", "render.visible-clipping-v1", "render.motion-path-v1"];
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
export type CompiledRuntimeTrackV1 = (CompiledNumericTrackV1 | CompiledColorTrackV1 | CompiledDiscreteTrackV1) & {
    /** Action-local time during [start, end); the outer track supplies the underlying scene value. */
    actionWindows?: {
        timing?: {
            sourceStart: number;
            sourceEnd: number;
            rate: number;
        };
        start: number;
        end: number;
        track: CompiledRuntimeTrackV1;
    }[];
};
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
        clipPathId: string; /** Source visibility affects paint only; clipping geometry stays active. */
        sourceVisibility?: true;
    };
    path?: {
        contours: RuntimeContourV1[];
        fillRule: "nonzero" | "evenodd";
        drawProgress: number;
        rounded: boolean;
        outlineSections?: OutlineSection[];
        explicitClosure?: boolean;
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
        lineCap?: 'butt' | 'round' | 'square' | null;
        lineJoin?: 'miter' | 'round' | 'bevel' | null;
        miterLimit?: number;
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
    /** Rest-space rig data for authored bone pose channels; requires rig.pose-v1. */
    rigs?: RigDocument;
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

## curve-range.d.ts

```ts
/** Framework-free curve primitives shared by authoring and derived rendering. */
export interface CurvePoint {
    x: number;
    y: number;
}
export interface CurveLengthSample {
    t: number;
    length: number;
}
export interface CurveLine {
    type: 'line' | 'bezier';
    points: readonly CurvePoint[];
    controlStart?: CurvePoint;
    controlEnd?: CurvePoint;
}
export declare function lerpCurvePoint(a: CurvePoint, b: CurvePoint, t: number): CurvePoint;
export declare function cubicPoint(a: CurvePoint, b: CurvePoint, c: CurvePoint, d: CurvePoint, t: number): CurvePoint;
export declare function splitCubic(a: CurvePoint, b: CurvePoint, c: CurvePoint, d: CurvePoint, t: number): [[CurvePoint, CurvePoint, CurvePoint, CurvePoint], [CurvePoint, CurvePoint, CurvePoint, CurvePoint]];
export declare function cubicRange(a: CurvePoint, b: CurvePoint, c: CurvePoint, d: CurvePoint, start: number, end: number): [CurvePoint, CurvePoint, CurvePoint, CurvePoint];
export declare function curvePoint(line: CurveLine, t: number): CurvePoint;
export declare function curveLengthSamples(line: CurveLine, steps?: number): CurveLengthSample[];
export declare function curveTAtLength(samples: CurveLengthSample[], target: number): number;
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

## outline.d.ts

```ts
import type { RuntimeContourV1, RuntimeLineV1 } from './contracts';
import { CurvePoint } from './curve-range';
export interface OutlinePosition {
    segmentId: string;
    t: number;
}
export interface OutlineTaper {
    length: number;
    tipWidth: number;
}
export interface OutlineSection {
    id: string;
    contourId: string;
    start: OutlinePosition;
    end: OutlinePosition;
    startTaper?: OutlineTaper;
    endTaper?: OutlineTaper;
    /** Distinguishes a whole closed contour from an intentionally empty range. */
    fullContour?: boolean;
}
export interface OutlineStyle {
    width: number;
    alignment?: 'center' | 'inside' | 'outside';
    lineCap?: 'butt' | 'round' | 'square' | null;
    lineJoin?: 'miter' | 'round' | 'bevel' | null;
    miterLimit?: number;
    dasharray?: readonly number[];
    dashoffset?: number;
    drawProgress?: number;
    rounded?: boolean;
}
export interface OutlineProjectionSection {
    id: string;
    data: string;
    length: number;
    start: CurvePoint;
    end: CurvePoint;
}
export interface OutlineProjection {
    strokeData: string;
    sections: OutlineProjectionSection[];
    sourceBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    problem?: string;
}
/** Includes the implicit Z edge without ever adding an editable point. */
export declare function outlineContourSegments(contour: RuntimeContourV1): RuntimeLineV1[];
export declare function outlinePositionPoint(contour: RuntimeContourV1, position: OutlinePosition, rounded?: boolean): CurvePoint | undefined;
/** Nearest source-local address, used by endpoint dragging without changing topology. */
export declare function closestOutlinePosition(contour: RuntimeContourV1, point: CurvePoint, rounded?: boolean): OutlinePosition | undefined;
export declare function outlineSectionLines(contour: RuntimeContourV1, section: OutlineSection, rounded?: boolean): RuntimeLineV1[];
export declare function outlineSectionPathData(contour: RuntimeContourV1, section: OutlineSection, rounded?: boolean): string;
/** The only stroke projection used by editor, export and portable playback. */
export declare function projectOutlineSections(contours: RuntimeContourV1[], sections: readonly OutlineSection[], style: OutlineStyle): OutlineProjection;
export declare function fullOutlineSections(contours: RuntimeContourV1[]): OutlineSection[];
/** Validates authored addresses without projecting or silently repairing their geometry. */
export declare function outlineSectionsProblem(contours: RuntimeContourV1[], sections: readonly OutlineSection[]): string | undefined;
/** Prevent authoring or importing patterns that would create unbounded per-frame geometry. */
export declare function outlineDashComplexityProblem(length: number, input: readonly number[]): string | undefined;
export declare function outlineProjectionProblem(contours: RuntimeContourV1[], sections: readonly OutlineSection[], style: OutlineStyle): string | undefined;
```

## path-data.d.ts

```ts
import { RuntimeContourV1, RuntimeLineV1, RuntimePointV1 } from "./contracts";
/** Shared framework-free path reconstruction used by authoring and playback. */
export declare function buildRuntimePathData(contours: RuntimeContourV1[], rounded?: boolean): string;
/** The implicit Z edge, retaining the caller's endpoint identities without changing saved geometry. */
export declare function contourClosingPoints<T extends RuntimePointV1>(lines: readonly {
    points: readonly T[];
}[], closed: boolean): [T, T] | undefined;
/** Straight geometry may be encoded as a cubic with collapsed or collinear handles. */
export declare function isStraightPathSegment(line: {
    type: 'line' | 'bezier';
    points: readonly {
        x: number;
        y: number;
    }[];
    controlStart?: {
        x: number;
        y: number;
    };
    controlEnd?: {
        x: number;
        y: number;
    };
}): boolean;
export interface Corner {
    before: RuntimePointV1;
    after: RuntimePointV1;
    controlBefore: RuntimePointV1;
    controlAfter: RuntimePointV1;
}
export declare function roundedCorner(incoming: RuntimeLineV1, outgoing: RuntimeLineV1): Corner | null;
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
import { RigDocument } from './rig/armature';
export declare class RuntimeScene {
    private readonly root;
    readonly targets: RuntimeSceneTargetV1[];
    private readonly targetById;
    private readonly targetNodesById;
    private readonly rigs?;
    private readonly rigPlans;
    constructor(root: SVGSVGElement, sourceTargets: RuntimeSceneTargetV1[], rigs?: RigDocument);
    write(targetId: string, property: string, value: unknown): boolean;
    render(): void;
    clear(): void;
    /** Recompute from captured rest points on every seek; solved FK never replaces authored channels. */
    private applyRigs;
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
    private nodes;
}
```

## stroke-expansion.d.ts

```ts
import { CurvePoint } from './curve-range';
/** Shared offset/join primitives for generated stroke geometry and Stroke to Path. */
export declare function strokeNormal(direction: CurvePoint, side: number): CurvePoint;
export declare function strokeOffset(point: CurvePoint, normal: CurvePoint, distance: number): CurvePoint;
export declare function strokeIntersection(a: CurvePoint, directionA: CurvePoint, b: CurvePoint, directionB: CurvePoint, epsilon?: number): CurvePoint | null;
```
