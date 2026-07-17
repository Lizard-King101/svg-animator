import packageInfo from "../../../../package.json";
import {
    CompiledColorTrackV1,
    CompiledNumericTrackV1,
    CompiledRuntimeTrackV1,
    evaluateRuntimeTrack,
    RUNTIME_BUNDLE_FORMAT_VERSION,
    RUNTIME_BUNDLE_KIND,
    RuntimeCapabilityV1,
    RuntimeCompileDiagnostic,
    RuntimeCompileResultV1,
    RuntimeContourV1,
    RuntimeGradientPaintV1,
    RuntimePaintV1,
    RuntimeSceneTargetV1,
    RuntimeSegmentMode,
} from "../../../../packages/runtime/src/index";
import { AnimationTrack, Keyframe, normalizedKeyframes, temporalSegmentCoefficients } from "../objects/animation.object";
import { GroupSave } from "../objects/elements/group.object";
import { PathSave } from "../objects/elements/path.object";
import { ShapeSave } from "../objects/elements/shape.object";
import { TextSave } from "../objects/elements/text.object";
import { ElementSave, SVGSave } from "../objects/svg.object";
import { GradientPaintSave, PaintSave } from "../objects/paint.object";

export type {
    CompiledColorTrackV1,
    CompiledNumericTrackV1,
    CompiledRuntimeTrackV1,
    RuntimeCompileDiagnostic,
    RuntimeCompileResultV1,
    RuntimeSegmentMode,
};

/** Pure deterministic compiler boundary shared by export and runtime equivalence tests. */
export function compileRuntimeAnimation(document: SVGSave, options: { bakeRoundedCorners?: boolean } = {}): RuntimeCompileResultV1 {
    const diagnostics: RuntimeCompileDiagnostic[] = [];
    const animation = document.animation;
    const animatedOrigins = animatedOriginTargets(animation?.tracks ?? []);
    const sceneTargets = compileScene(document.elements, options.bakeRoundedCorners ?? true, animatedOrigins);
    const sceneById = new Map(sceneTargets.map((target) => [target.id, target]));
    const targetNames = collectElementNames(document.elements);
    const targets: string[] = [];
    const properties: string[] = [];
    const targetIndexes = new Map<string, number>();
    const propertyIndexes = new Map<string, number>();
    const tracks: CompiledRuntimeTrackV1[] = [];

    const intern = (table: string[], indexes: Map<string, number>, value: string): number => {
        const existing = indexes.get(value);
        if(existing != null) return existing;
        const index = table.length;
        table.push(value);
        indexes.set(value, index);
        return index;
    };

    [...(animation?.tracks ?? [])]
        .filter((track) => track.enabled !== false)
        .sort((a, b) => compareStrings(a.targetId, b.targetId) || compareStrings(a.property, b.property) || compareStrings(a.id, b.id))
        .forEach((track) => {
            const target = sceneById.get(track.targetId);
            if(!target) {
                addDiagnostic(diagnostics, track, targetNames, "orphaned-target", `Target “${track.targetId}” does not exist.`, "Choose an existing layer or remove this track.");
                addSkipped(diagnostics, track, targetNames, "Track was skipped because its target is unavailable.");
                return;
            }
            if(!supportedProperty(track.property) || !targetSupportsProperty(target, track.property)) {
                addDiagnostic(diagnostics, track, targetNames, "unsupported-property", `Property “${track.property}” is not supported for this layer by runtime v1.`, "Retarget the track to a compatible property or remove it.");
                addSkipped(diagnostics, track, targetNames, "Track was skipped because its property is unsupported.");
                return;
            }
            const keyframes = normalizedKeyframes(track.keyframes);
            if(keyframes.length === 0) {
                addSkipped(diagnostics, track, targetNames, "Track has no valid keyframes.", "Add at least one valid keyframe or remove the track.");
                return;
            }
            const compiled = compileTrack(
                track,
                keyframes,
                intern(targets, targetIndexes, track.targetId),
                intern(properties, propertyIndexes, track.property),
                diagnostics,
                targetNames,
            );
            if(compiled) tracks.push(compiled);
        });

    const width = normalizedNumber(document.width);
    const height = normalizedNumber(document.height);
    const viewBox = [normalizedNumber(document.viewBoxX ?? 0), normalizedNumber(document.viewBoxY ?? 0), width, height] as [number, number, number, number];
    const normalizedTargets = normalizeValue(sceneTargets) as RuntimeSceneTargetV1[];
    const signature = artworkSignature({ id: document.id, width, height, viewBox, targets: normalizedTargets });
    const bundle = normalizeValue({
        kind: RUNTIME_BUNDLE_KIND,
        formatVersion: RUNTIME_BUNDLE_FORMAT_VERSION,
        generator: { name: "SVG Animator" as const, version: packageInfo.version },
        requiredCapabilities: requiredCapabilities(normalizedTargets, tracks),
        artwork: { id: document.id, signature, width, height, viewBox, targets: normalizedTargets },
        animation: {
            duration: animation?.duration ?? 0,
            loop: animation?.loop ?? false,
            markers: [...(animation?.markers ?? [])].map((marker) => ({ ...marker })).sort((a, b) => a.time - b.time || compareStrings(a.id, b.id)),
            variables: [...(animation?.variables ?? [])].map((variable) => ({ ...variable })).sort((a, b) => compareStrings(a.name, b.name)),
            targets,
            properties,
            tracks,
        },
    }) as RuntimeCompileResultV1["bundle"];
    return { bundle, diagnostics };
}

/** Evaluates one compiler payload track for authoring/runtime equivalence tests. */
export const evaluateCompiledRuntimeTrack = evaluateRuntimeTrack;

function compileTrack(
    track: AnimationTrack,
    keys: Keyframe[],
    target: number,
    property: number,
    diagnostics: RuntimeCompileDiagnostic[],
    names: Map<string, string>,
): CompiledRuntimeTrackV1 | undefined {
    const times = keys.map((key) => key.time);
    if(track.valueType === "number") {
        const values = keys.map((key) => Number(key.value));
        if(values.some((value) => !Number.isFinite(value))) {
            addInvalid(diagnostics, track, names, "Numeric track contains a non-finite value.");
            return undefined;
        }
        const segmentModes: RuntimeSegmentMode[] = [];
        const temporalCoefficients: number[] = [];
        for(let index = 0; index < keys.length - 1; index++) {
            const from = keys[index];
            const to = keys[index + 1];
            if(from.temporal?.out || to.temporal?.in) {
                segmentModes.push("temporal");
                const c = temporalSegmentCoefficients(from, to);
                temporalCoefficients.push(c.timeA, c.timeB, c.timeC, c.timeD, c.valueA, c.valueB, c.valueC, c.valueD);
            } else {
                segmentModes.push(from.easing?.type ?? "linear");
                temporalCoefficients.push(0, 0, 0, 0, 0, 0, 0, 0);
            }
        }
        return { kind: "number", target, property, times, values, segmentModes, temporalCoefficients };
    }
    if(track.valueType === "color") {
        const colors = keys.map((key) => parseColor(key.value));
        if(colors.some((color) => !color)) {
            addInvalid(diagnostics, track, names, "Color track contains an invalid color value.");
            return undefined;
        }
        return {
            kind: "color",
            target,
            property,
            times,
            values: colors.map((color) => color!.packed),
            interpolationSpaces: keys.slice(0, -1).map((_key, index) => colors[index + 1]!.space ?? colors[index]!.space),
            segmentModes: keys.slice(0, -1).map((key) => key.easing?.type ?? "linear"),
        };
    }
    const valid = track.valueType === "boolean"
        ? keys.every((key) => typeof key.value === "boolean")
        : keys.every((key) => typeof key.value === "string");
    if(!valid) {
        addInvalid(diagnostics, track, names, `Discrete ${track.valueType} track contains an invalid value.`);
        return undefined;
    }
    return { kind: track.valueType, target, property, times, values: keys.map((key) => key.value as boolean | string) };
}

function compileScene(elements: ElementSave[], rounded: boolean, animatedOrigins: ReadonlySet<string>, parentId: string | null = null): RuntimeSceneTargetV1[] {
    const result: RuntimeSceneTargetV1[] = [];
    elements.forEach((element) => {
        const geometry = elementGeometry(element);
        const transform = element.transform ?? {};
        const motion = element.motion ?? {};
        const origin = {
            x: transform.originX ?? geometry.x + geometry.width / 2,
            y: transform.originY ?? geometry.y + geometry.height / 2,
        };
        const target: RuntimeSceneTargetV1 = {
            id: element.id,
            parentId,
            type: element.type === "shape" ? element.shapeType : element.type,
            visible: element.visible,
            opacity: element.opacity ?? 1,
            transform: {
                translateX: transform.translateX ?? 0,
                translateY: transform.translateY ?? 0,
                scaleX: transform.scaleX ?? 1,
                scaleY: transform.scaleY ?? 1,
                rotation: transform.rotation ?? 0,
                originX: origin.x,
                originY: origin.y,
                autoOrigin: (transform.originX == null || transform.originY == null) && !animatedOrigins.has(element.id),
            },
            motion: {
                pathId: typeof motion.pathId === "string" ? motion.pathId : null,
                progress: motion.progress ?? 0,
                offsetX: motion.offsetX ?? 0,
                offsetY: motion.offsetY ?? 0,
                rotateToPath: motion.rotateToPath ?? false,
                offsetAngle: motion.offsetAngle ?? 0,
            },
            geometry,
            paints: elementPaints(element),
        };
        if(element.type === "path") {
            target.path = {
                contours: pathContours(element),
                fillRule: element.fillRule ?? "evenodd",
                drawProgress: element.drawProgress ?? 1,
                rounded,
            };
            target.stroke = strokeDescriptor(element.settings);
        } else if(element.type === "shape") {
            target.stroke = strokeDescriptor(element.settings);
        } else if(element.type === "group" && element.clipElementId) {
            target.clipping = { clipElementId: element.clipElementId, clipPathId: `clip-${element.id}` };
        }
        result.push(target);
        if(element.type === "group") result.push(...compileScene(element.elements, rounded, animatedOrigins, element.id));
    });
    return result;
}

function animatedOriginTargets(tracks: AnimationTrack[]): Set<string> {
    const axes = new Map<string, Set<string>>();
    tracks.filter((track) => track.enabled !== false && (track.property === "transform.originX" || track.property === "transform.originY"))
        .forEach((track) => {
            const properties = axes.get(track.targetId) ?? new Set<string>();
            properties.add(track.property);
            axes.set(track.targetId, properties);
        });
    return new Set([...axes].filter(([, properties]) => properties.size === 2).map(([targetId]) => targetId));
}

function pathContours(path: PathSave): RuntimeContourV1[] {
    const contours = path.contours?.length ? path.contours : [{ id: `${path.id}-contour`, closed: path.closed ?? false, lines: path.lines ?? [] }];
    return contours.map((contour) => ({
        id: contour.id,
        closed: contour.closed,
        lines: contour.lines.filter((line) => line.points.length >= 2).map((line) => ({
            id: line.id,
            type: line.type,
            points: [plainPoint(line.points[0]), plainPoint(line.points[1])],
            ...(line.controlStart ? { controlStart: plainPoint(line.controlStart) } : {}),
            ...(line.controlEnd ? { controlEnd: plainPoint(line.controlEnd) } : {}),
        })),
    }));
}

function elementPaints(element: ElementSave): RuntimeSceneTargetV1["paints"] {
    if(element.type === "group") return {};
    if(element.type === "text") return { color: runtimePaint(element.settings.color) };
    return { fill: runtimePaint(element.settings.fill), stroke: runtimePaint(element.settings.stroke) };
}

function runtimePaint(paint: PaintSave | undefined): RuntimePaintV1 {
    if(paint == null) return null;
    if(typeof paint === "string") {
        const color = parseCssHex(paint);
        return color ? { kind: "solid", color: color.color, opacity: color.opacity } : null;
    }
    const gradient = paint as GradientPaintSave;
    return {
        kind: "gradient",
        id: gradient.id,
        gradientType: gradient.type,
        units: gradient.units,
        spreadMethod: gradient.spreadMethod,
        transform: gradient.transform ? [...gradient.transform] : [1, 0, 0, 1, 0, 0],
        coordinates: { ...gradient.coordinates },
        stops: gradient.stops.map((stop) => {
            const color = parseCssHex(stop.color) ?? { color: "#000000", opacity: 1 };
            return { id: stop.id, offset: stop.offset, color: color.color, opacity: color.opacity * (stop.opacity ?? 1) };
        }),
    } as RuntimeGradientPaintV1;
}

function strokeDescriptor(settings: PathSave["settings"] | ShapeSave["settings"]): NonNullable<RuntimeSceneTargetV1["stroke"]> {
    return {
        width: settings.stroke_width,
        alignment: settings.stroke_alignment ?? "center",
        dasharray: [...(settings.stroke_dasharray ?? [])],
        dashoffset: settings.stroke_dashoffset ?? 0,
    };
}

function elementGeometry(element: ElementSave): RuntimeSceneTargetV1["geometry"] {
    if(element.type === "shape") return { x: element.position.x, y: element.position.y, width: element.settings.width, height: element.settings.height };
    if(element.type === "text") return { x: element.position.x, y: element.position.y, width: 0, height: element.settings.font_size * 1.2 };
    if(element.type === "path") {
        const points = pathContours(element).flatMap((contour) => contour.lines).flatMap((line) => [...line.points, ...(line.controlStart ? [line.controlStart] : []), ...(line.controlEnd ? [line.controlEnd] : [])]);
        return boundsForPoints(points);
    }
    const childBounds = element.elements.filter((child) => child.visible).map(elementGeometry);
    if(!childBounds.length) return { x: 0, y: 0, width: 0, height: 0 };
    const minX = Math.min(...childBounds.map((bound) => bound.x));
    const minY = Math.min(...childBounds.map((bound) => bound.y));
    const maxX = Math.max(...childBounds.map((bound) => bound.x + bound.width));
    const maxY = Math.max(...childBounds.map((bound) => bound.y + bound.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function boundsForPoints(points: Array<{ x: number; y: number }>): RuntimeSceneTargetV1["geometry"] {
    if(!points.length) return { x: 0, y: 0, width: 0, height: 0 };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function targetSupportsProperty(target: RuntimeSceneTargetV1, property: string): boolean {
    if(/^path\.points\./.test(property)) return !!target.path && !!/^path\.points\.([^.]+)\.(x|y)$/.exec(property)?.[1]
        && target.path.contours.some((contour) => contour.lines.some((line) => [...line.points, line.controlStart, line.controlEnd].some((point) => point?.id === /^path\.points\.([^.]+)/.exec(property)?.[1])));
    const gradient = /^settings\.(fill|stroke|color)\.gradient\.(?:([a-z0-9]+)|transform\.([a-f])|stops\.(.+)\.(offset|color|opacity))$/.exec(property);
    if(gradient) {
        const paint = target.paints[gradient[1] as keyof RuntimeSceneTargetV1["paints"]];
        return !!paint && paint.kind === "gradient";
    }
    if(property === "geometry.width" || property === "geometry.height") return target.type === "rectangle" || target.type === "ellipse";
    if(property === "geometry.x" || property === "geometry.y") return target.type !== "group";
    if(property === "path.drawProgress") return !!target.path;
    if(property === "settings.fill") return "fill" in target.paints;
    if(property === "settings.stroke" || property === "settings.stroke_width" || property === "settings.stroke_dashoffset") return !!target.stroke;
    if(property === "settings.color") return "color" in target.paints;
    return true;
}

function supportedProperty(property: string): boolean {
    return /^(geometry\.(x|y|width|height)|transform\.(translateX|translateY|scaleX|scaleY|rotation|originX|originY)|opacity|visible|settings\.(fill|stroke|color|stroke_width|stroke_dashoffset)|path\.drawProgress|motion\.(pathId|progress|rotateToPath|offsetAngle|offsetX|offsetY)|path\.points\.[^.]+\.(x|y)|settings\.(fill|stroke|color)\.gradient\.(x1|y1|x2|y2|cx|cy|r|fx|fy|transform\.(a|b|c|d|e|f)|stops\..+\.(offset|color|opacity)))$/.test(property);
}

function requiredCapabilities(targets: RuntimeSceneTargetV1[], tracks: CompiledRuntimeTrackV1[]): RuntimeCapabilityV1[] {
    const capabilities = new Set<RuntimeCapabilityV1>(["render.transforms-v1", "render.geometry-v1", "render.paint-v1"]);
    tracks.forEach((track) => capabilities.add(track.kind === "number" ? "tracks.numeric-v1" : track.kind === "color" ? "tracks.color-v1" : "tracks.discrete-v1"));
    if(targets.some((target) => target.path)) capabilities.add("render.path-v1");
    if(targets.some((target) => target.clipping)) capabilities.add("render.clipping-v1");
    if(targets.some((target) => Object.values(target.paints).some((paint) => paint?.kind === "gradient"))) capabilities.add("render.gradient-v1");
    if(targets.some((target) => target.motion.pathId) || tracks.some((track) => track.kind === "string")) capabilities.add("render.motion-path-v1");
    return [...capabilities].sort(compareStrings);
}

function addDiagnostic(diagnostics: RuntimeCompileDiagnostic[], track: AnimationTrack, names: Map<string, string>, code: RuntimeCompileDiagnostic["code"], message: string, correction: string): void {
    diagnostics.push({ code, trackId: track.id, targetId: track.targetId, property: track.property, layerName: names.get(track.targetId), message, correction });
}
function addSkipped(diagnostics: RuntimeCompileDiagnostic[], track: AnimationTrack, names: Map<string, string>, message: string, correction = "Correct the track before exporting."): void {
    addDiagnostic(diagnostics, track, names, "skipped-track", message, correction);
}
function addInvalid(diagnostics: RuntimeCompileDiagnostic[], track: AnimationTrack, names: Map<string, string>, message: string): void {
    addDiagnostic(diagnostics, track, names, "invalid-value", message, "Replace invalid keyframe values with values matching the track type.");
    addSkipped(diagnostics, track, names, "Invalid track was skipped.");
}
function collectElementNames(elements: ElementSave[], result = new Map<string, string>()): Map<string, string> {
    elements.forEach((element) => { result.set(element.id, element.name); if(element.type === "group") collectElementNames(element.elements, result); });
    return result;
}
function plainPoint(point: { id: string; x: number; y: number; cornerRadius?: number }) { return { id: point.id, x: point.x, y: point.y, ...(point.cornerRadius ? { cornerRadius: point.cornerRadius } : {}) }; }
function parseColor(value: unknown): { packed: number; space: "rgb" | "hsl" } | undefined {
    let hex: string | undefined;
    let alpha = 255;
    let space: "rgb" | "hsl" = "rgb";
    if(typeof value === "string") hex = value;
    else if(value && typeof value === "object") {
        const color = value as { hex?: unknown; alpha?: unknown; space?: unknown };
        if(typeof color.hex === "string") hex = color.hex;
        if(typeof color.alpha === "number" && Number.isFinite(color.alpha)) alpha = Math.round(Math.max(0, Math.min(1, color.alpha)) * 255);
        if(color.space === "hsl") space = "hsl";
    }
    if(!hex) return undefined;
    const parsed = parseCssHex(hex);
    if(!parsed) return undefined;
    if(/^#[0-9a-f]{8}$/i.test(expandHex(hex))) alpha = Math.round(parsed.opacity * 255);
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(parsed.color)!;
    return { packed: ((parseInt(match[1], 16) << 24) | (parseInt(match[2], 16) << 16) | (parseInt(match[3], 16) << 8) | alpha) >>> 0, space };
}
function parseCssHex(value: string): { color: string; opacity: number } | undefined {
    const expanded = expandHex(value);
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(expanded);
    return match ? { color: `#${match[1]}${match[2]}${match[3]}`.toLowerCase(), opacity: match[4] ? parseInt(match[4], 16) / 255 : 1 } : undefined;
}
function expandHex(value: string): string {
    const match = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(value);
    return match ? `#${match[1]}${match[1]}${match[2]}${match[2]}${match[3]}${match[3]}${match[4] ? match[4] + match[4] : ""}` : value;
}
function normalizedNumber(value: number, precision = 1e6): number { return Object.is(value, -0) ? 0 : Math.round(value * precision) / precision; }
function normalizeValue(value: unknown, precision = 1e6): unknown {
    if(typeof value === "number") return normalizedNumber(value, precision);
    if(Array.isArray(value)) return value.map((item) => normalizeValue(item, precision));
    if(value && typeof value === "object") return Object.fromEntries(Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => compareStrings(a, b))
        .map(([key, item]) => [key, normalizeValue(item, key === "times" || key === "values" || key === "temporalCoefficients" ? 1e12 : precision)]));
    return value;
}
function artworkSignature(value: unknown): string {
    const input = JSON.stringify(normalizeValue(value));
    let hash = 0x811c9dc5;
    for(let index = 0; index < input.length; index++) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
    return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function compareStrings(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
