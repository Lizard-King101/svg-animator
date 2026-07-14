import { EditorService } from "src/app/_services/editor.service";
import { ElementAttribute, SettingsFromAttributes } from "./element";
import { Color } from "../color.object";
import { defaultMotion, MotionSave, MotionState, restoreMotion, serializeMotion } from "../motion.object";
import { Point, PointSave } from "../point.object";
import { defaultTransform, restoreTransform, serializeTransform, TransformSave, TransformState } from "../transform.object";
import { PaintSave, restorePaint, serializePaint } from "../paint.object";
import { DEFAULT_STROKE_STYLE, restoreStrokeStyle, StrokeAlignment } from "../stroke-style.object";

export interface ShapeSave {
    type: 'shape';
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    opacity?: number;
    transform?: TransformSave;
    motion?: MotionSave;
    shapeType: 'rectangle' | 'ellipse';
    position: PointSave;
    settings: {
        width: number;
        height: number;
        stroke_width: number;
        stroke: PaintSave;
        fill: PaintSave;
        corner_radius?: number;
        line_cap: string | null;
        line_join: string | null;
        stroke_alignment: StrokeAlignment;
        stroke_dasharray: number[];
        stroke_dashoffset: number;
        stroke_miterlimit: number;
    };
}

const ShapeGeometryAttributes = [
    {
        label: 'Width',
        name: 'width',
        input: 'range',
        output: 'width',
        min: 1,
        max: 300
    },
    {
        label: 'Height',
        name: 'height',
        input: 'range',
        output: 'height',
        min: 1,
        max: 300
    },
] as const satisfies readonly ElementAttribute[];

const ShapeBaseAttributes = [
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
        input: 'paint',
        output: 'stroke',
    },
    {
        label: 'Fill Color',
        name: 'fill',
        input: 'paint',
        output: 'fill',
    },
    {
        label: 'Line Caps',
        name: 'stroke-linecap',
        input: 'select',
        output: 'line_cap',
        options: [{ label: 'Butt', value: 'butt' }, { label: 'Round', value: 'round' }, { label: 'Square', value: 'square' }]
    },
    {
        label: 'Line Joint',
        name: 'stroke-linejoin',
        input: 'select',
        output: 'line_join',
        options: [{ label: 'Miter', value: 'miter' }, { label: 'Bevel', value: 'bevel' }, { label: 'Round', value: 'round' }]
    }
] as const satisfies readonly ElementAttribute[];

const RectAttributes = [
    ...ShapeBaseAttributes,
    {
        label: 'Corner Radius',
        name: 'rx',
        input: 'range',
        output: 'corner_radius',
        min: 0,
        max: 200,
    }
] as const satisfies readonly ElementAttribute[];

// Used only for settings type derivation — includes all possible keys
const ShapeAttributes = [
    ...ShapeGeometryAttributes,
    ...RectAttributes,
] as const satisfies readonly ElementAttribute[];

export class Shape {
    id: string;
    name: string;
    visible: boolean = true;
    locked: boolean = false;
    opacity: number = 1;
    transform: TransformState = defaultTransform();
    motion: MotionState = defaultMotion();
    position: Point;
    type: 'ellipse' | 'rectangle';

    settings: SettingsFromAttributes<typeof ShapeAttributes> & Pick<ShapeSave["settings"], "stroke_alignment" | "stroke_dasharray" | "stroke_dashoffset" | "stroke_miterlimit"> = {
        width: 120,
        height: 120,
        stroke_width: 3,
        stroke: new Color('#2dd4bf'),
        fill: null,
        corner_radius: 0,
        line_cap: null,
        line_join: null,
        stroke_alignment: DEFAULT_STROKE_STYLE.stroke_alignment,
        stroke_dasharray: [],
        stroke_dashoffset: DEFAULT_STROKE_STYLE.stroke_dashoffset,
        stroke_miterlimit: DEFAULT_STROKE_STYLE.stroke_miterlimit,
    };

    attributes: readonly ElementAttribute[] = ShapeBaseAttributes;

    get raw() {
        return '';
    }

    get x() {
        return this.position.x;
    }

    get y() {
        return this.position.y;
    }

    get width() {
        return this.settings.width;
    }

    get height() {
        return this.settings.height;
    }

    get radiusX() {
        return this.width / 2;
    }

    get radiusY() {
        return this.height / 2;
    }

    get centerX() {
        return this.x + this.radiusX;
    }

    get centerY() {
        return this.y + this.radiusY;
    }

    constructor(private editor: EditorService, options: ShapeOptions) {
        this.id = this.editor.ID;
        this.position = options.position;
        this.type = options.type;
        this.name = `${this.type == 'rectangle' ? 'Rectangle' : 'Ellipse'} ${this.id.slice(0, 4)}`;
        this.settings.width = options.width ?? this.settings.width;
        this.settings.height = options.height ?? this.settings.height;
        if (this.type === 'rectangle') {
            this.attributes = RectAttributes;
        }
    }

    moveElement(delta: Point) {
        this.position.addTo(delta);
    }

    save(): ShapeSave {
        return {
            type: 'shape',
            id: this.id,
            name: this.name,
            visible: this.visible,
            locked: this.locked,
            opacity: this.opacity,
            transform: serializeTransform(this.transform),
            motion: serializeMotion(this.motion),
            shapeType: this.type,
            position: this.position.toSave(),
            settings: {
                width: this.settings.width,
                height: this.settings.height,
                stroke_width: this.settings.stroke_width,
                stroke: serializePaint(this.settings.stroke),
                fill: serializePaint(this.settings.fill),
                corner_radius: this.settings.corner_radius,
                line_cap: this.settings.line_cap,
                line_join: this.settings.line_join,
                stroke_alignment: this.settings.stroke_alignment,
                stroke_dasharray: [...this.settings.stroke_dasharray],
                stroke_dashoffset: this.settings.stroke_dashoffset,
                stroke_miterlimit: this.settings.stroke_miterlimit,
            },
        };
    }

    static fromSave(s: ShapeSave, editor: EditorService): Shape {
        const shape = new Shape(editor, {
            type: s.shapeType,
            position: Point.fromSave(s.position),
            width: s.settings.width,
            height: s.settings.height,
        });
        (shape as any).id = s.id;
        shape.name = s.name;
        shape.visible = s.visible;
        shape.locked = s.locked;
        shape.opacity = s.opacity ?? 1;
        shape.transform = restoreTransform(s.transform);
        shape.motion = restoreMotion(s.motion);
        const strokeStyle = restoreStrokeStyle(s.settings);
        shape.settings = {
            width: s.settings.width,
            height: s.settings.height,
            stroke_width: s.settings.stroke_width,
            stroke: restorePaint(s.settings.stroke),
            fill: restorePaint(s.settings.fill),
            corner_radius: s.settings.corner_radius ?? 0,
            line_cap: strokeStyle.line_cap as any,
            line_join: strokeStyle.line_join as any,
            stroke_alignment: strokeStyle.stroke_alignment,
            stroke_dasharray: strokeStyle.stroke_dasharray,
            stroke_dashoffset: strokeStyle.stroke_dashoffset,
            stroke_miterlimit: strokeStyle.stroke_miterlimit,
        };
        return shape;
    }
}

export interface ShapeOptions {
    type: 'ellipse' | 'rectangle';
    position: Point;
    width?: number;
    height?: number;
}
