import { prepareWithSegments, measureNaturalWidth, layoutWithLines } from '@chenglou/pretext';
import { EditorService } from 'src/app/_services/editor.service';
import { Color } from '../color.object';
import { Point, PointSave } from '../point.object';
import { ElementAttribute, SettingsFromAttributes } from './element';

export interface TextSave {
    type: 'text';
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    position: PointSave;
    settings: {
        content: string;
        text_align: string;
        font_family: string;
        font_size: number;
        font_weight: string;
        color: string | null;
    };
}

type TextAnchor = 'start' | 'middle' | 'end';

const TextAttributes = [
    {
        label: 'Content',
        name: 'content',
        input: 'text',
        output: 'content',
    },
    {
        label: 'Font Size',
        name: 'font-size',
        input: 'range',
        output: 'font_size',
        min: 6,
        max: 200,
    },
    {
        label: 'Text Align',
        name: 'text-align',
        input: 'select',
        output: 'text_align',
        options: [
            { label: 'Left',        value: 'start'   },
            { label: 'Center',      value: 'middle'  },
            { label: 'Right',       value: 'end'     }
        ],
    },
    {
        label: 'Font',
        name: 'font-family',
        input: 'select',
        output: 'font_family',
        options: [
            { label: 'Plus Jakarta Sans', value: "'Plus Jakarta Sans'" },
            { label: 'System UI',         value: 'system-ui'           },
            { label: 'Arial',             value: 'Arial'               },
            { label: 'Georgia',           value: 'Georgia'             },
            { label: 'Courier New',       value: "'Courier New'"       },
            { label: 'Impact',            value: 'Impact'              },
        ],
    },
    {
        label: 'Weight',
        name: 'font-weight',
        input: 'select',
        output: 'font_weight',
        options: [
            { label: 'Regular',    value: '400' },
            { label: 'Medium',     value: '500' },
            { label: 'SemiBold',   value: '600' },
            { label: 'Bold',       value: '700' },
            { label: 'ExtraBold',  value: '800' },
        ],
    },
    {
        label: 'Color',
        name: 'fill',
        input: 'color',
        output: 'color',
    },
] as const satisfies readonly ElementAttribute[];

export class TextElement {
    id: string;
    name: string;
    visible: boolean = true;
    locked: boolean = false;
    position: Point;

    settings: SettingsFromAttributes<typeof TextAttributes> = {
        content: 'Text',
        font_size: 32,
        text_align: 'start',
        font_family: "'Plus Jakarta Sans'",
        font_weight: '400',
        color: new Color('#000000'),
    };

    attributes: readonly ElementAttribute[] = TextAttributes;

    get x() { return this.position.x; }
    get y() { return this.position.y; }

    get textAnchor(): TextAnchor {
        return TextElement.normalizeTextAnchor(this.settings.text_align);
    }

    get boundsX(): number {
        if(this.textAnchor == 'middle') {
            return this.x - (this.width / 2);
        }

        if(this.textAnchor == 'end') {
            return this.x - this.width;
        }

        return this.x;
    }

    get fontString(): string {
        return `${this.settings.font_weight} ${this.settings.font_size}px ${this.settings.font_family}`;
    }

    get lineHeight(): number {
        return this.settings.font_size * 1.2;
    }

    private get _measured() {
        const content = this.settings.content || ' ';
        const prepared = prepareWithSegments(content, this.fontString);
        const nw = Math.max(measureNaturalWidth(prepared), 1);
        const { lines } = layoutWithLines(prepared, nw, this.lineHeight);
        return { lines: lines.map(l => l.text), width: nw };
    }

    get lines(): string[] { return this._measured.lines; }
    get width(): number   { return this._measured.width; }
    get height(): number  { return this.lines.length * this.lineHeight; }

    constructor(private _editor: EditorService, position: Point) {
        this.id = this._editor.ID;
        this.name = `Text ${this.id.slice(0, 4)}`;
        this.position = position;
    }

    moveElement(delta: Point) {
        this.position.addTo(delta);
    }

    save(): TextSave {
        return {
            type: 'text',
            id: this.id,
            name: this.name,
            visible: this.visible,
            locked: this.locked,
            position: this.position.toSave(),
            settings: {
                content: this.settings.content,
                font_family: this.settings.font_family ?? "'Plus Jakarta Sans'",
                font_size: this.settings.font_size,
                font_weight: this.settings.font_weight ?? '400',
                text_align: this.textAnchor,
                color: this.settings.color?.hex ?? null,
            },
        };
    }

    static fromSave(s: TextSave, editor: EditorService): TextElement {
        const t = new TextElement(editor, Point.fromSave(s.position));
        (t as any).id = s.id;
        t.name = s.name;
        t.visible = s.visible;
        t.locked = s.locked;
        t.settings = {
            content: s.settings.content,
            font_family: s.settings.font_family as any,
            font_size: s.settings.font_size,
            text_align: TextElement.normalizeTextAnchor(s.settings.text_align),
            font_weight: s.settings.font_weight as any,
            color: s.settings.color ? new Color(s.settings.color) : null,
        };
        return t;
    }

    private static normalizeTextAnchor(value?: string | null): TextAnchor {
        switch(value) {
            case 'center':
            case 'middle':
                return 'middle';
            case 'right':
            case 'end':
                return 'end';
            default:
                return 'start';
        }
    }
}
