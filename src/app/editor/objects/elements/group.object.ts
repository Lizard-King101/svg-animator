import { EditorService } from "src/app/_services/editor.service";
import { ElementAttribute } from "./element";
import { Path, PathSave } from "./path.object";
import { Shape, ShapeSave } from "./shape.object";
import { Point } from "../point.object";

export interface GroupSave {
    type: 'group';
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    elements: (PathSave | ShapeSave | GroupSave)[];
}

const GroupAttributes: Array<ElementAttribute> = [

]

export class Group {
    id: string;
    name: string;
    visible: boolean = true;
    locked: boolean = false;
    elements: (Path | Shape | Group)[] = [];

    attributes: ElementAttribute[] = GroupAttributes;

    settings: {[key:string]: any} = {};

    get raw() {
        return '';
    }

    constructor(private editor: EditorService) {
        this.id = this.editor.ID;
        this.name = `Group ${this.id.slice(0, 4)}`;
    }

    moveElement(delta: Point) {
        this.elements.forEach((e) => {
            e.moveElement(delta);
        });
    }

    save(): GroupSave {
        return {
            type: 'group',
            id: this.id,
            name: this.name,
            visible: this.visible,
            locked: this.locked,
            elements: this.elements.map((e) => e.save()).filter((s): s is PathSave | ShapeSave | GroupSave => s !== undefined),
        };
    }
}
