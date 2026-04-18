import { IconName } from "@fortawesome/fontawesome-common-types";
import { EditorService } from "../../editor.service";
import { Point } from "src/app/editor/objects/point.object";
import { Shape } from "src/app/editor/objects/elements/shape.object";
import { Tool } from "../tool";

export class Ellipse extends Tool {
    override icon: IconName = 'circle';
    private startPoint?: Point;

    private clearActiveEllipse() {
        if(this.editor.activeElement instanceof Shape && this.editor.activeElement.type == 'ellipse') {
            this.editor.removeElement(this.editor.activeElement.id);
            this.editor.activeElement = undefined;
        }
    }

    constructor(editor: EditorService, parentTool: Tool) {
        super(editor, parentTool);
    }

    override down(event: MouseEvent) {
        if(this.editor.selectedSVG) {
            const point = this.editor.toCanvasPoint(event.clientX, event.clientY);
            const shape = new Shape(this.editor, {
                type: 'ellipse',
                position: point,
                width: 1,
                height: 1,
            });

            this.startPoint = point;
            this.editor.activeElement = shape;
            this.editor.selectedElement = undefined;
            this.editor.selectedSVG.tempElements.push(shape);
        }
    }

    override onselect() {
        if(this.parentTool) {
            this.parentTool.showChildren = false;
            this.parentTool.selectedChild = this;
            this.parentTool.deselectOtherChildren(this);
        }
        return true;
    }

    override drag(event: MouseEvent) {
        if(this.startPoint && this.editor.activeElement instanceof Shape && this.editor.activeElement.type == 'ellipse') {
            const point = this.editor.toCanvasPoint(event.clientX, event.clientY);
            const constrained = this.editor.keysDown['Shift'];
            const centered = this.editor.keysDown['Alt'];
            const width = Math.max(Math.abs(point.x - this.startPoint.x) * (centered ? 2 : 1), 1);
            const height = Math.max(Math.abs(point.y - this.startPoint.y) * (centered ? 2 : 1), 1);
            const nextWidth = constrained ? Math.max(width, height) : width;
            const nextHeight = constrained ? nextWidth : height;

            this.editor.activeElement.position = centered
                ? new Point(
                    this.startPoint.x - (nextWidth / 2),
                    this.startPoint.y - (nextHeight / 2),
                )
                : new Point(
                    point.x < this.startPoint.x ? this.startPoint.x - nextWidth : this.startPoint.x,
                    point.y < this.startPoint.y ? this.startPoint.y - nextHeight : this.startPoint.y,
                );
            this.editor.activeElement.settings.width = nextWidth;
            this.editor.activeElement.settings.height = nextHeight;
        }
    }

    override up() {
        if(this.editor.selectedSVG && this.editor.activeElement instanceof Shape && this.editor.activeElement.type == 'ellipse') {
            const shape = this.editor.activeElement;
            this.editor.removeElement(shape.id);
            this.editor.selectedSVG.elements.push(shape);
            this.editor.selectedElement = shape;
            this.editor.activeElement = undefined;
        }

        this.startPoint = undefined;
    }

    override click() {}

    override reset() {
        this.clearActiveEllipse();
        this.startPoint = undefined;
    }

    override deselect(): void {
        super.deselect();
        this.clearActiveEllipse();
        this.startPoint = undefined;
    }
}
