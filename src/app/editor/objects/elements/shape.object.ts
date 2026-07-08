import { EditorService } from "src/app/_services/editor.service";
import { ElementAttribute, SettingsFromAttributes } from "./element";
import { Color } from "../color.object";
import { Point, PointSave } from "../point.object";
import { defaultTransform, restoreTransform, serializeTransform, TransformSave, TransformState } from "../transform.object";

export interface ShapeSave {
    type: 'shape';
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    transform?: TransformSave;
    shapeType: 'rectangle' | 'ellipse';
    position: PointSave;
    settings: {
        width: number;
        height: number;
        stroke_width: number;
        stroke: string | null;
        fill: string | null;
        corner_radius?: number;
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
        input: 'color',
        output: 'stroke',
    },
    {
        label: 'Fill Color',
        name: 'fill',
        input: 'color',
        output: 'fill',
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
    transform: TransformState = defaultTransform();
    position: Point;
    type: 'ellipse' | 'rectangle';

    settings: SettingsFromAttributes<typeof ShapeAttributes> = {
        width: 120,
        height: 120,
        stroke_width: 3,
        stroke: new Color('#2dd4bf'),
        fill: null,
        corner_radius: 0,
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
            transform: serializeTransform(this.transform),
            shapeType: this.type,
            position: this.position.toSave(),
            settings: {
                width: this.settings.width,
                height: this.settings.height,
                stroke_width: this.settings.stroke_width,
                stroke: this.settings.stroke?.hex ?? null,
                fill: this.settings.fill?.hex ?? null,
                corner_radius: this.settings.corner_radius,
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
        shape.transform = restoreTransform(s.transform);
        shape.settings = {
            width: s.settings.width,
            height: s.settings.height,
            stroke_width: s.settings.stroke_width,
            stroke: s.settings.stroke ? new Color(s.settings.stroke) : null,
            fill: s.settings.fill ? new Color(s.settings.fill) : null,
            corner_radius: s.settings.corner_radius ?? 0,
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
