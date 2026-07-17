export const RUNTIME_BUNDLE_KIND = "svg-animator/runtime-bundle" as const;
export const RUNTIME_BUNDLE_FORMAT_VERSION = 1 as const;
export const RUNTIME_VERSION = "1.0.0" as const;
export const RUNTIME_BROWSER_GLOBAL = "SVGAnimatorRuntime" as const;

export const RUNTIME_CAPABILITIES_V1 = [
    "tracks.numeric-v1",
    "tracks.color-v1",
    "tracks.discrete-v1",
    "render.transforms-v1",
    "render.geometry-v1",
    "render.paint-v1",
    "render.gradient-v1",
    "render.path-v1",
    "render.clipping-v1",
    "render.motion-path-v1",
] as const;

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

export interface RuntimePointV1 { id: string; x: number; y: number; cornerRadius?: number; }
export interface RuntimeLineV1 {
    id: string;
    type: "line" | "bezier";
    points: [RuntimePointV1, RuntimePointV1];
    controlStart?: RuntimePointV1;
    controlEnd?: RuntimePointV1;
}
export interface RuntimeContourV1 { id: string; closed: boolean; lines: RuntimeLineV1[]; }
export interface RuntimeTransformV1 {
    translateX: number; translateY: number; scaleX: number; scaleY: number; rotation: number;
    originX: number; originY: number;
    /** True when the resolved origin follows native geometry bounds. */
    autoOrigin: boolean;
}
export interface RuntimeMotionV1 {
    pathId: string | null; progress: number; offsetX: number; offsetY: number;
    rotateToPath: boolean; offsetAngle: number;
}
export interface RuntimeSolidPaintV1 { kind: "solid"; color: string; opacity: number; }
export interface RuntimeGradientStopV1 { id: string; offset: number; color: string; opacity: number; }
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
    geometry: { x: number; y: number; width: number; height: number };
    clipping?: { clipElementId: string; clipPathId: string };
    path?: { contours: RuntimeContourV1[]; fillRule: "nonzero" | "evenodd"; drawProgress: number; rounded: boolean };
    paints: { fill?: RuntimePaintV1; stroke?: RuntimePaintV1; color?: RuntimePaintV1 };
    stroke?: {
        width: number;
        alignment: "inside" | "center" | "outside";
        dasharray: number[];
        dashoffset: number;
    };
}

export interface RuntimeMarkerV1 { id: string; time: number; name: string; }
export interface RuntimeVariableV1 { name: string; value: number | string | boolean; }

export interface RuntimeBundleV1 {
    kind: typeof RUNTIME_BUNDLE_KIND;
    formatVersion: typeof RUNTIME_BUNDLE_FORMAT_VERSION;
    generator: { name: "SVG Animator"; version: string };
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
