/**
 * Authors the "Welcome Banner" preloaded project: the animation played on the home page,
 * shipped as an ordinary editable project. Run with `npm run preloaded:banner`, then
 * `npm run preloaded:thumbnails`. IDs are deterministic so regenerating is a no-op diff.
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileRuntimeAnimation } from "../src/app/editor/animation/runtime-animation-compiler";
import { createDocumentEnvelope, migrateDocument } from "../src/app/editor/migrations/document-migrations";
import { stableJson } from "../src/app/editor/export/export-artifact";
import { AnimationTrack, EasingType, Keyframe } from "../src/app/editor/objects/animation.object";
import { Color } from "../src/app/editor/objects/color.object";
import { GroupSave } from "../src/app/editor/objects/elements/group.object";
import { PathSave } from "../src/app/editor/objects/elements/path.object";
import { ShapeSave } from "../src/app/editor/objects/elements/shape.object";
import { LineSave } from "../src/app/editor/objects/line.object";
import { PointSave } from "../src/app/editor/objects/point.object";
import { SVG, SVGSave } from "../src/app/editor/objects/svg.object";

export const WELCOME_BANNER_ID = "welcome-banner";
const WIDTH = 640;
const HEIGHT = 320;
const DURATION = 6;

const counters = new Map<string, number>();
function id(prefix: string): string {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `wb-${prefix}-${next}`;
}

const point = (x: number, y: number, cornerRadius?: number): PointSave => ({ id: id("pt"), x, y, ...(cornerRadius ? { cornerRadius } : {}) });

const strokeDefaults = {
    line_cap: null, line_join: null, stroke_alignment: "center" as const,
    stroke_dasharray: [], stroke_dashoffset: 0, stroke_miterlimit: 4,
};

function rectangle(name: string, x: number, y: number, width: number, height: number, fill: string, cornerRadius: number, extra: Partial<ShapeSave> = {}): ShapeSave {
    return {
        type: "shape", shapeType: "rectangle", id: id("shape"), name, visible: true, locked: false, opacity: 1,
        position: point(x, y),
        transform: { originX: x + width / 2, originY: y + height / 2 },
        settings: { width, height, fill, stroke: null, stroke_width: 0, corner_radius: cornerRadius, ...strokeDefaults },
        ...extra,
    };
}

function ellipse(name: string, cx: number, cy: number, diameter: number, fill: ShapeSave["settings"]["fill"], stroke: string | null, strokeWidth: number, extra: Partial<ShapeSave> = {}): ShapeSave {
    const x = cx - diameter / 2, y = cy - diameter / 2;
    return {
        type: "shape", shapeType: "ellipse", id: id("shape"), name, visible: true, locked: false, opacity: 1,
        position: point(x, y),
        transform: { originX: cx, originY: cy },
        settings: { width: diameter, height: diameter, fill, stroke, stroke_width: strokeWidth, ...strokeDefaults },
        ...extra,
    };
}

/** A closed polygon whose consecutive segments share point identity, as authored paths do. */
function polygon(name: string, points: PointSave[], fill: string, center: { x: number; y: number }): PathSave {
    const lines: LineSave[] = points.map((start, index) => ({ id: id("line"), type: "line", points: [start, points[(index + 1) % points.length]] }));
    return {
        type: "path", id: id("path"), name, visible: true, locked: false, opacity: 1, drawProgress: 1, closed: true, fillRule: "nonzero",
        transform: { originX: center.x, originY: center.y },
        settings: { stroke_width: 0, fill_enabled: true, fill, stroke: null, ...strokeDefaults },
        contours: [{ id: id("contour"), closed: true, lines }],
    };
}

/** Four-pointed sparkle with softened inner corners. */
function sparkle(name: string, cx: number, cy: number, radius: number, fill: string): PathSave {
    const inner = radius * 0.28;
    const points: PointSave[] = [];
    for(let index = 0; index < 8; index++) {
        const angle = (index * Math.PI) / 4 - Math.PI / 2;
        const r = index % 2 === 0 ? radius : inner;
        points.push(point(round(cx + Math.cos(angle) * r), round(cy + Math.sin(angle) * r), index % 2 === 0 ? 1 : inner * 0.9));
    }
    return polygon(name, points, fill, { x: cx, y: cy });
}

/** An open curve through cubic segments: [start, c1, c2, end, c1, c2, end, …]. */
function curve(name: string, coordinates: [number, number][], stroke: string, width: number): PathSave {
    const anchors: PointSave[] = [point(...coordinates[0])];
    const lines: LineSave[] = [];
    for(let index = 1; index + 2 < coordinates.length; index += 3) {
        const end = point(...coordinates[index + 2]);
        lines.push({
            id: id("line"), type: "bezier", points: [anchors.at(-1)!, end],
            controlStart: point(...coordinates[index]), controlEnd: point(...coordinates[index + 1]),
        });
        anchors.push(end);
    }
    return {
        type: "path", id: id("path"), name, visible: true, locked: false, opacity: 1, drawProgress: 1, closed: false, fillRule: "nonzero",
        settings: { stroke_width: width, fill_enabled: false, fill: null, stroke, ...strokeDefaults, line_cap: "round", line_join: "round" },
        contours: [{ id: id("contour"), closed: false, lines }],
    };
}

type Key = [time: number, value: unknown, easing?: EasingType];

function track(targetId: string, property: string, keys: Key[]): AnimationTrack {
    const sample = keys[0][1];
    const valueType = typeof sample === "number" ? "number" : typeof sample === "boolean" ? "boolean" : "color";
    const keyframes: Keyframe[] = keys.map(([time, value, easing]) => ({
        id: id("key"), time, value: valueType === "color" ? colorValue(value as string) : value,
        easing: { type: easing ?? "linear" },
    }));
    return { id: id("track"), targetId, property, valueType, keyframes, enabled: true };
}

function colorValue(hex: string) {
    const color = new Color(hex);
    return { type: "color" as const, space: "rgb" as const, hex: color.hex, rgb: { ...color.rgb }, hsl: { ...color.hsl }, alpha: color.alpha };
}

/** Pops an element in with a little overshoot at `start`. */
function popIn(targetId: string, start: number): AnimationTrack[] {
    const keys: Key[] = [[0, 0, "hold"], [start, 0, "ease-out"], [start + 0.28, 1.18, "ease-in-out"], [start + 0.46, 1]];
    return [track(targetId, "transform.scaleX", keys), track(targetId, "transform.scaleY", keys)];
}

function round(value: number): number { return Math.round(value * 100) / 100; }

// ── Artwork ──────────────────────────────────────────────────────────────────

// Square corners: the home page rounds its stage, and rounded corners would show the white artboard elsewhere.
const backdrop = rectangle("Backdrop", 0, 0, WIDTH, HEIGHT, "#17171f", 0);
const glow = ellipse("Glow", 330, 168, 340, null, null, 0);
glow.settings.fill = {
    type: "radial-gradient", id: id("gradient"), units: "objectBoundingBox", spreadMethod: "pad",
    coordinates: { cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.5 },
    stops: [
        { id: id("stop"), offset: 0, color: "#2dd4bf", opacity: 0.22 },
        { id: id("stop"), offset: 1, color: "#2dd4bf", opacity: 0 },
    ],
};
const swoosh = curve("Swoosh", [
    [56, 236],
    [150, 262], [176, 86], [300, 108],
    [418, 130], [430, 258], [588, 92],
], "#2dd4bf", 12);
const nib = ellipse("Pen Nib", 56, 236, 26, "#f8fafc", "#2dd4bf", 5, {
    motion: { pathId: swoosh.id, progress: 0, offsetX: 0, offsetY: 0, rotateToPath: false, offsetAngle: 0 },
});
const square = rectangle("Rounded Square", 84, 54, 70, 70, "#818cf8", 18);
const circle = ellipse("Circle", 528, 236, 74, "#f472b6", null, 0);
const sparkles = [
    sparkle("Sparkle Large", 214, 70, 30, "#fde68a"),
    sparkle("Sparkle Small", 262, 44, 15, "#a5f3fc"),
    sparkle("Sparkle Medium", 440, 268, 22, "#c4b5fd"),
];
const scene: GroupSave = {
    type: "group", id: id("group"), name: "Scene", visible: true, locked: false, opacity: 1, clipElementId: null,
    transform: { originX: WIDTH / 2, originY: HEIGHT / 2 },
    elements: [glow, swoosh, square, circle, ...sparkles, nib],
};

// ── Timeline (6 s loop) ─────────────────────────────────────────────────────
// 0.2–2.0 s the swoosh draws while the nib rides its tip; 2.0–3.4 s the shapes and
// sparkles pop in; everything breathes until 5.4 s, then the scene fades for the loop.

const tracks: AnimationTrack[] = [
    track(scene.id, "opacity", [[0, 0, "ease-out"], [0.25, 1, "hold"], [5.4, 1, "ease-in"], [5.9, 0, "hold"], [DURATION, 0]]),
    track(glow.id, "transform.scaleX", [[0, 0.6, "ease-in-out"], [3, 1.08, "ease-in-out"], [DURATION, 0.6]]),
    track(glow.id, "transform.scaleY", [[0, 0.6, "ease-in-out"], [3, 1.08, "ease-in-out"], [DURATION, 0.6]]),
    track(swoosh.id, "path.drawProgress", [[0, 0, "hold"], [0.2, 0, "ease-in-out"], [2, 1]]),
    track(swoosh.id, "settings.stroke", [[0, "#2dd4bf", "ease-in-out"], [2.6, "#38bdf8", "ease-in-out"], [4.6, "#818cf8", "ease-in-out"], [DURATION, "#2dd4bf"]]),
    track(nib.id, "motion.progress", [[0, 0, "hold"], [0.2, 0, "ease-in-out"], [2, 1]]),
    track(nib.id, "opacity", [[0, 1, "hold"], [2, 1, "ease-in"], [2.35, 0]]),
    ...popIn(square.id, 2.05),
    track(square.id, "transform.rotation", [[0, -90, "hold"], [2.05, -90, "ease-out"], [2.6, 0, "ease-in-out"], [4.4, 12, "ease-in-out"], [5.4, 0]]),
    track(square.id, "settings.fill", [[0, "#818cf8", "ease-in-out"], [3.8, "#a78bfa", "ease-in-out"], [DURATION, "#818cf8"]]),
    ...popIn(circle.id, 2.3),
    track(circle.id, "transform.translateY", [[0, -36, "hold"], [2.3, -36, "ease-out"], [2.7, 0, "ease-in-out"], [4, -8, "ease-in-out"], [5.2, 0]]),
    ...sparkles.flatMap((item, index) => [
        ...popIn(item.id, 2.6 + index * 0.25),
        track(item.id, "transform.rotation", [[0, 0, "hold"], [2.6 + index * 0.25, 0, "ease-in-out"], [5.4, 90]]),
    ]),
];

const banner: SVGSave = {
    id: WELCOME_BANNER_ID,
    name: "Welcome Banner",
    width: WIDTH,
    height: HEIGHT,
    viewBoxX: 0,
    viewBoxY: 0,
    elements: [backdrop, scene],
    guides: [],
    guidesLocked: false,
    animation: { version: 2, duration: DURATION, fpsHint: 60, loop: true, markers: [], variables: [], tracks, workArea: { start: 0, end: DURATION } },
};

// ── Validate and write ──────────────────────────────────────────────────────

const envelope = createDocumentEnvelope(banner);
const migrated = migrateDocument(JSON.parse(stableJson(envelope)));
if(migrated.status !== "ok") throw new Error(`Banner failed migration: ${migrated.warnings.join(" ")}`);
let restoredId = 0;
const restored = SVG.fromSave(migrated.value.data, { get ID() { return `restored-${++restoredId}`; } } as never);
if(restored.elements.length !== banner.elements.length) throw new Error("Banner elements did not round-trip.");
const compiled = compileRuntimeAnimation(restored.save());
if(compiled.diagnostics.length) {
    throw new Error(`Banner animation has runtime diagnostics:\n${compiled.diagnostics.map((item) => `${item.property}: ${item.message}`).join("\n")}`);
}
if(compiled.bundle.animation.tracks.length !== tracks.length) throw new Error("Some banner tracks were dropped by the runtime compiler.");

await writeFile(resolve(process.cwd(), "Preloaded", "Welcome Banner.svg-animator.json"), `${stableJson(envelope)}\n`);
console.log(`Generated Welcome Banner with ${tracks.length} tracks.`);
