import { EditorService } from "src/app/_services/editor.service";
import { ElementAttribute } from "./element";
import { Path, PathSave } from "./path.object";
import { Shape, ShapeSave } from "./shape.object";
import { TextElement, TextSave } from "./text.object";
import { Point } from "../point.object";
import { defaultTransform, restoreTransform, serializeTransform, TransformSave, TransformState } from "../transform.object";

export interface GroupSave {
    type: 'group';
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    opacity?: number;
    transform?: TransformSave;
    clipElementId?: string | null;
    elements: GroupElementSave[];
}

export type GroupElementSave = PathSave | ShapeSave | TextSave | GroupSave;
export type GroupElement = Path | Shape | TextElement | Group;

const GroupAttributes: Array<ElementAttribute> = [

]

export class Group {
    id: string;
    name: string;
    visible: boolean = true;
    locked: boolean = false;
    opacity: number = 1;
    transform: TransformState = defaultTransform();
    clipElementId?: string | null;
    elements: GroupElement[] = [];

    attributes: ElementAttribute[] = GroupAttributes;

    settings: {[key:string]: any} = {};

    get raw() {
        return '';
    }

    get clipPathId() {
        return `clip-${this.id}`;
    }

    get clipElement(): GroupElement | undefined {
        return this.clipElementId
            ? this.elements.find((element) => element.id === this.clipElementId)
            : undefined;
    }

    get renderedElements(): GroupElement[] {
        return this.clipElementId
            ? this.elements.filter((element) => element.id !== this.clipElementId)
            : this.elements;
    }

    constructor(private editor: EditorService) {
        this.id = this.editor.ID;
        this.name = `Group ${this.id.slice(0, 4)}`;
    }

    moveElement(delta: Point) {
        this.transform.translateX += delta.x;
        this.transform.translateY += delta.y;
    }

    save(): GroupSave {
        return {
            type: 'group',
            id: this.id,
            name: this.name,
            visible: this.visible,
            locked: this.locked,
            opacity: this.opacity,
            transform: serializeTransform(this.transform),
            clipElementId: this.clipElementId ?? null,
            elements: this.elements.map((e) => e.save()) as GroupElementSave[],
        };
    }

    static fromSave(s: GroupSave, editor: EditorService): Group {
        const group = new Group(editor);
        (group as any).id = s.id;
        group.name = s.name;
        group.visible = s.visible;
        group.locked = s.locked;
        group.opacity = s.opacity ?? 1;
        group.transform = restoreTransform(s.transform);
        group.clipElementId = s.clipElementId ?? null;
        group.elements = s.elements.map((element) => {
            if(element.type === 'path') return Path.fromSave(element, editor);
            if(element.type === 'shape') return Shape.fromSave(element, editor);
            if(element.type === 'text') return TextElement.fromSave(element, editor);
            return Group.fromSave(element, editor);
        });
        if(group.clipElementId && !group.clipElement) {
            group.clipElementId = null;
        }
        return group;
    }
}
