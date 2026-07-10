import { IconName } from "@fortawesome/fontawesome-common-types";
import { EditorService } from "../editor.service";
import { Tool } from "./tool";

import { Rectangle } from './shapes/rectangle.tool';
import { Ellipse } from './shapes/ellipse.tool';

const shapeTools = [
    Rectangle,
    Ellipse
]

export class Shapes extends Tool {
    override readonly preferenceKey = 'shapes';
    override icon: IconName = 'shapes';

    override children: Tool[];

    constructor(editor: EditorService) {
        super(editor);

        let tools: Tool[] = [];
        shapeTools.forEach((t) => {
            let tool = new t(editor, this);
            tools.push(tool);
        })
        this.children = tools;
    }

    override onselect() {
        if(this.selectedChild) {
            return true;
        }
        this.showChildren = true;
        return false;
    }

    override click(event: MouseEvent) {
        this.selectedChild?.click(event);
    }

    override down(event: MouseEvent) {
        this.selectedChild?.down(event);
    }

    override drag(event: MouseEvent) {
        this.selectedChild?.drag(event);
    }

    override up(event: MouseEvent) {
        this.selectedChild?.up(event);
    }

    override reset(): void {
        this.children.forEach((tool) => {
            tool.reset();
        });
    }

    override deselect(): void {
        super.deselect();
        this.showChildren = false;
        this.children.forEach((tool) => {
            tool.deselect();
        });
    }
}
