import { EditorService } from "src/app/_services/editor.service";
import { ElementAttribute, SettingsFromAttributes } from "./element";
import { Color } from "../color.object";
import { Line, LineSave } from "../line.object";
import { defaultMotion, MotionSave, MotionState, restoreMotion, serializeMotion } from "../motion.object";
import { Point, PointSave } from "../point.object";
import { defaultTransform, restoreTransform, serializeTransform, TransformSave, TransformState } from "../transform.object";

export interface PathSave {
    type: 'path';
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    opacity?: number;
    drawProgress?: number;
    transform?: TransformSave;
    motion?: MotionSave;
    closed: boolean;
    settings: {
        stroke_width: number;
        fill_enabled: boolean;
        fill: string | null;
        stroke: string | null;
        line_cap: string | null;
        line_join: string | null;
    };
    lines: LineSave[];
}

const PathAttributes = [
    {
        label: 'Stroke Width',
        name: 'stroke-width',
        input: 'range',
        output: 'stroke_width',
        min: 0,
        max: 30
    },
    {
        label: 'Stroke Color',
        name: 'stroke',
        input: 'color',
        output: 'stroke',
    },
    {
        label: 'Fill',
        name: 'fill-enabled',
        input: 'bool',
        output: 'fill_enabled',
    },
    {
        label: 'Fill Color',
        name: 'fill',
        input: 'color',
        output: 'fill',
    },
    {
        label: 'Line Caps',
        name: 'stroke-linecap',
        input: 'select',
        output: 'line_cap',
        options: [
            {
                label: 'Butt',
                value: 'butt'
            },
            {
                label: 'Round',
                value: 'round',
            },
            {
                label: 'Square',
                value: 'square'
            }
        ]
    },
    {
        label: 'Line Joint',
        name: 'stroke-linejoin',
        input: 'select',
        output: 'line_join',
        options: [
            {
                label: 'Miter',
                value: 'miter'
            },
            {
                label: 'Bevel',
                value: 'bevel'
            },
            {
                label: 'Round',
                value: 'round'
            }
        ]
    }
] as const satisfies readonly ElementAttribute[];


export class Path {
    id: string;
    name: string;
    visible: boolean = true;
    locked: boolean = false;
    opacity: number = 1;
    drawProgress: number = 1;
    transform: TransformState = defaultTransform();
    motion: MotionState = defaultMotion();
    lines: Line[] = [];
    closed: boolean = false;

    settings: SettingsFromAttributes<typeof PathAttributes> = {
        stroke_width: 2,
        fill_enabled: false,
        fill: null,
        stroke: new Color('#dddde8'),
        line_cap: null,
        line_join: null
    };

    attributes: readonly ElementAttribute[] = PathAttributes;

    get raw() {
        return buildPathData(this, { rounded: true });
    }

    get rawUnrounded() {
        return buildPathData(this, { rounded: false });
    }

    segmentRaw(line: Line) {
        return buildPathSegmentData(this, line);
    }

    roundedCornerFor(anchor: Point): RoundedCorner | null {
        return roundedCornerForAnchor(this, anchor);
    }

    cornerEligible(anchor: Point): boolean {
        return !!roundedCornerForAnchor(this, anchor, 1);
    }

    constructor(private _editor: EditorService) {
        this.id = this._editor.ID;
        this.name = `Path ${this.id.slice(0, 4)}`;
    }

    moveElement(delta: Point) {
        let moved: Point[] = [];
        this.lines.forEach((l) => {
            l.points.forEach((p) => {
                if(moved.indexOf(p) < 0) {
                    p.addTo(delta);
                    moved.push(p);
                }
            });

            if(l.controlStart && moved.indexOf(l.controlStart) < 0) {
                l.controlStart.addTo(delta);
                moved.push(l.controlStart);
            }

            if(l.controlEnd && moved.indexOf(l.controlEnd) < 0) {
                l.controlEnd.addTo(delta);
                moved.push(l.controlEnd);
            }
        });
    }

    pathPoints(): Point[] {
        const points: Point[] = [];
        const add = (point?: Point) => {
            if(point && !points.some((candidate) => candidate.id === point.id)) {
                points.push(point);
            }
        };

        this.lines.forEach((line) => {
            line.points.forEach(add);
            add(line.controlStart);
            add(line.controlEnd);
        });

        return points;
    }

    findPointById(id: string): Point | undefined {
        return this.pathPoints().find((point) => point.id === id);
    }

    destroy() {
        this.lines = [];
        this._editor.removeElement(this.id);
    }

    save(): PathSave {
        return {
            type: 'path',
            id: this.id,
            name: this.name,
            visible: this.visible,
            locked: this.locked,
            opacity: this.opacity,
            drawProgress: this.drawProgress,
            transform: serializeTransform(this.transform),
            motion: serializeMotion(this.motion),
            closed: this.closed,
            settings: {
                stroke_width: this.settings.stroke_width,
                fill_enabled: this.settings.fill_enabled,
                fill: this.settings.fill?.hex ?? null,
                stroke: this.settings.stroke?.hex ?? null,
                line_cap: this.settings.line_cap ?? null,
                line_join: this.settings.line_join ?? null,
            },
            lines: this.lines.map((l) => l.toSave()),
        };
    }

    static fromSave(s: PathSave, editor: EditorService): Path {
        const p = new Path(editor);
        (p as any).id = s.id;
        p.name = s.name;
        p.visible = s.visible;
        p.locked = s.locked;
        p.opacity = s.opacity ?? 1;
        p.drawProgress = clamp01(s.drawProgress ?? 1);
        p.transform = restoreTransform(s.transform);
        p.motion = restoreMotion(s.motion);
        p.closed = s.closed;
        p.settings = {
            stroke_width: s.settings.stroke_width,
            // backward compat: old saves without fill_enabled default to false
            fill_enabled: s.settings.fill_enabled ?? false,
            fill: s.settings.fill ? new Color(s.settings.fill) : null,
            stroke: s.settings.stroke ? new Color(s.settings.stroke) : null,
            line_cap: s.settings.line_cap as any,
            line_join: s.settings.line_join as any,
        };

        // Rebuild shared-point references. Adjacent segments share endpoint Point
        // objects by reference, so we must reuse the same instance for the same
        // point ID rather than constructing a new one each time.
        const pointMap = new Map<string, Point>();
        const resolve = (ps: PointSave): Point => {
            let pt = pointMap.get(ps.id);
            if (!pt) {
                pt = Point.fromSave(ps);
                pointMap.set(ps.id, pt);
            }
            return pt;
        };

        p.lines = s.lines.map((ls) => Line.fromSave(ls, editor, resolve));
        return p;
    }
}

export interface RoundedCorner {
    anchor: Point;
    before: Point;
    after: Point;
    controlBefore: Point;
    controlAfter: Point;
    incoming: Line;
    outgoing: Line;
}

interface PathDataOptions {
    rounded: boolean;
}

function buildPathData(path: Path, options: PathDataOptions): string {
    const lines = completeLines(path);
    if(lines.length === 0) {
        return "";
    }
    const closed = isEffectivelyClosed(path, lines);

    if(!options.rounded) {
        let rawPath = "M ";
        for(let li = 0; li < path.lines.length; li++) {
            let l = path.lines[li];
            switch(l.type) {
                case "line":
                    for(let pi = 0; pi < l.points.length; pi++) {
                        let p = l.points[pi];
                        if(li == 0) {
                            if(pi == 0) {
                                rawPath += ` ${p.x} ${p.y}`;
                            } else {
                                rawPath += ` L ${p.x} ${p.y}`;
                            }
                        } else {
                            if(pi > 0) {
                                rawPath += ` L ${p.x} ${p.y}`;
                            }
                        }
                    }
                    break;
                case "bezier":
                    if(l.points.length >= 2) {
                        const start = l.points[0];
                        const end = l.points[1];
                        // Fall back to anchor positions for any handle that hasn't been
                        // placed yet (e.g. during an in-progress alt-drag conversion).
                        const cs = l.controlStart ?? start;
                        const ce = l.controlEnd ?? end;

                        if(li == 0) {
                            rawPath += ` ${start.x} ${start.y}`;
                        }

                        rawPath += ` C ${cs.x} ${cs.y} ${ce.x} ${ce.y} ${end.x} ${end.y}`;
                    }
                    break;
            }
        }
        if(closed) rawPath += ' Z';
        return rawPath;
    }

    const first = lines[0];
    const startCorner = roundedCornerForSegmentStart(path, first);
    const start = startCorner ? startCorner.after : first.points[0];
    const commands = [`M ${formatPoint(start)}`];

    for(const line of lines) {
        appendRenderedSegment(commands, path, line);
    }

    if(closed) commands.push('Z');
    return commands.join(' ');
}

function buildPathSegmentData(path: Path, line: Line): string {
    if(line.points.length < 2) {
        return '';
    }

    const startCorner = roundedCornerForSegmentStart(path, line);
    const start = startCorner ? startCorner.after : line.points[0];
    const commands = [`M ${formatPoint(start)}`];
    appendRenderedSegment(commands, path, line);
    return commands.join(' ');
}

function appendRenderedSegment(commands: string[], path: Path, line: Line) {
    if(line.points.length < 2) {
        return;
    }

    const endCorner = roundedCornerForSegmentEnd(path, line);
    const end = endCorner ? endCorner.before : line.points[1];

    if(line.type === "bezier" && line.controlStart && line.controlEnd) {
        commands.push(`C ${formatPoint(line.controlStart)} ${formatPoint(line.controlEnd)} ${formatPoint(end)}`);
    } else {
        commands.push(`L ${formatPoint(end)}`);
    }

    if(endCorner) {
        commands.push(`C ${formatPoint(endCorner.controlBefore)} ${formatPoint(endCorner.controlAfter)} ${formatPoint(endCorner.after)}`);
    }
}

function completeLines(path: Path): Line[] {
    return path.lines.filter((line) => line.points.length >= 2);
}

function roundedCornerForSegmentStart(path: Path, line: Line): RoundedCorner | null {
    const lines = completeLines(path);
    const closed = isEffectivelyClosed(path, lines);
    const index = lines.indexOf(line);
    if(index < 0 || line.points.length < 2) {
        return null;
    }

    if(index === 0 && !closed) {
        return null;
    }

    const incoming = index === 0 ? lines[lines.length - 1] : lines[index - 1];
    return computeRoundedCorner(incoming, line);
}

function roundedCornerForSegmentEnd(path: Path, line: Line): RoundedCorner | null {
    const lines = completeLines(path);
    const closed = isEffectivelyClosed(path, lines);
    const index = lines.indexOf(line);
    if(index < 0 || line.points.length < 2) {
        return null;
    }

    if(index === lines.length - 1 && !closed) {
        return null;
    }

    const outgoing = index === lines.length - 1 ? lines[0] : lines[index + 1];
    return computeRoundedCorner(line, outgoing);
}

function roundedCornerForAnchor(path: Path, anchor: Point, radiusOverride?: number): RoundedCorner | null {
    const lines = completeLines(path);
    const closed = isEffectivelyClosed(path, lines);
    const outgoingIndex = lines.findIndex((line) => line.points[0] === anchor);
    const incomingIndex = lines.findIndex((line) => line.points[1] === anchor);
    if(incomingIndex < 0 || outgoingIndex < 0) {
        return null;
    }

    if(!closed && (incomingIndex === lines.length - 1 || outgoingIndex === 0)) {
        return null;
    }

    return computeRoundedCorner(lines[incomingIndex], lines[outgoingIndex], radiusOverride);
}

function computeRoundedCorner(incoming: Line | undefined, outgoing: Line | undefined, radiusOverride?: number): RoundedCorner | null {
    if(!incoming || !outgoing || incoming.type !== 'line' || outgoing.type !== 'line') {
        return null;
    }

    if(incoming.points.length < 2 || outgoing.points.length < 2 || !samePoint(incoming.points[1], outgoing.points[0])) {
        return null;
    }

    const anchor = outgoing.points[0];
    const radius = radiusOverride ?? Math.max(incoming.points[1].cornerRadius, anchor.cornerRadius);
    if(radius <= 0) {
        return null;
    }

    const previous = incoming.points[0];
    const next = outgoing.points[1];
    const previousLength = distance(anchor, previous);
    const nextLength = distance(anchor, next);
    if(previousLength <= 0.0001 || nextLength <= 0.0001) {
        return null;
    }

    const previousUnit = unitVector(anchor, previous);
    const nextUnit = unitVector(anchor, next);
    const dot = Math.max(-1, Math.min(1, (previousUnit.x * nextUnit.x) + (previousUnit.y * nextUnit.y)));
    const angle = Math.acos(dot);
    if(angle <= 0.001 || angle >= Math.PI - 0.001) {
        return null;
    }

    const tangent = Math.tan(angle / 2);
    if(Math.abs(tangent) <= 0.0001) {
        return null;
    }

    const maxOffset = Math.min(previousLength, nextLength) * 0.45;
    const offset = Math.min(radius / tangent, maxOffset);
    if(offset <= 0.0001) {
        return null;
    }

    const actualRadius = offset * tangent;
    const sweep = Math.PI - angle;
    const controlLength = (4 / 3) * Math.tan(sweep / 4) * actualRadius;

    const before = new Point(
        anchor.x + (previousUnit.x * offset),
        anchor.y + (previousUnit.y * offset),
    );
    const after = new Point(
        anchor.x + (nextUnit.x * offset),
        anchor.y + (nextUnit.y * offset),
    );

    return {
        anchor,
        before,
        after,
        controlBefore: new Point(
            before.x - (previousUnit.x * controlLength),
            before.y - (previousUnit.y * controlLength),
        ),
        controlAfter: new Point(
            after.x - (nextUnit.x * controlLength),
            after.y - (nextUnit.y * controlLength),
        ),
        incoming,
        outgoing,
    };
}

function isEffectivelyClosed(path: Path, lines = completeLines(path)): boolean {
    if(path.closed) {
        return true;
    }

    if(lines.length < 2) {
        return false;
    }

    return samePoint(lines[0].points[0], lines[lines.length - 1].points[1]);
}

function samePoint(a?: Point, b?: Point): boolean {
    if(!a || !b) {
        return false;
    }

    return a === b || a.id === b.id || (Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001);
}

function unitVector(from: Point, to: Point): { x: number; y: number } {
    const length = distance(from, to);
    return {
        x: (to.x - from.x) / length,
        y: (to.y - from.y) / length,
    };
}

function distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt((dx * dx) + (dy * dy));
}

function formatPoint(point: Point): string {
    return `${round(point.x)} ${round(point.y)}`;
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function clamp01(value: unknown): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 1;
}
