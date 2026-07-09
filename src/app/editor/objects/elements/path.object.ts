import { EditorService } from "src/app/_services/editor.service";
import { ElementAttribute, SettingsFromAttributes } from "./element";
import { Color } from "../color.object";
import { Line, LineSave } from "../line.object";
import { Point, PointSave } from "../point.object";
import { defaultTransform, restoreTransform, serializeTransform, TransformSave, TransformState } from "../transform.object";

export interface PathSave {
    type: 'path';
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    opacity?: number;
    transform?: TransformSave;
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
    transform: TransformState = defaultTransform();
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
        let rawPath = "M ";
        for(let li = 0; li < this.lines.length; li++) {
            let l = this.lines[li];
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
        if(this.closed) rawPath += ' Z';
        return rawPath;
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
            transform: serializeTransform(this.transform),
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
        p.transform = restoreTransform(s.transform);
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
