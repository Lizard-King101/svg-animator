import { Injectable } from "@angular/core";
import { Group } from "../editor/objects/elements/group.object";
import { Path } from "../editor/objects/elements/path.object";
import { Shape } from "../editor/objects/elements/shape.object";
import { TextElement } from "../editor/objects/elements/text.object";
import { Color } from "../editor/objects/color.object";
import { Line } from "../editor/objects/line.object";
import { Point } from "../editor/objects/point.object";
import { AnyElement } from "../editor/objects/svg.object";
import { EditorService } from "./editor.service";
import { clonePaint } from "../editor/objects/paint.object";

/**
 * Constructs editor elements while the persisted model still requires an
 * EditorService in each constructor. Keeping that dependency here makes the
 * later schema/model decoupling a contained change.
 */
@Injectable()
export class ElementFactory {
    constructor(private editor: EditorService) {}

    createGroup(): Group {
        return new Group(this.editor);
    }

    clone(element: AnyElement): AnyElement {
        if(element instanceof Path) return this.clonePath(element);
        if(element instanceof Shape) return this.cloneShape(element);
        if(element instanceof TextElement) return this.cloneText(element);
        return this.cloneGroup(element);
    }

    private clonePoint(point: Point, pointMap: Map<string, Point>): Point {
        let cloned = pointMap.get(point.id);
        if(!cloned) {
            cloned = new Point(point.x, point.y);
            cloned.cornerRadius = point.cornerRadius;
            pointMap.set(point.id, cloned);
        }
        return cloned;
    }

    private cloneColor(value: unknown): unknown {
        return value instanceof Color ? new Color(value.serialized) : value;
    }

    private clonePath(path: Path): Path {
        const clone = new Path(this.editor);
        const pointMap = new Map<string, Point>();

        clone.name = `${path.name} Copy`;
        clone.visible = path.visible;
        clone.locked = false;
        clone.opacity = path.opacity;
        clone.closed = path.closed;
        clone.fillRule = path.fillRule;
        clone.transform = { ...path.transform };
        clone.motion = { ...path.motion };
        clone.settings = {
            ...path.settings,
            stroke: clonePaint(path.settings.stroke, this.editor.ID),
            fill: clonePaint(path.settings.fill, this.editor.ID),
        };
        clone.contours = path.contours.map((contour) => clone.createContour(
            contour.lines.map((line) => new Line(this.editor, {
                type: line.type,
                points: line.points.map((point) => this.clonePoint(point, pointMap)),
                controlStart: line.controlStart ? this.clonePoint(line.controlStart, pointMap) : undefined,
                controlEnd: line.controlEnd ? this.clonePoint(line.controlEnd, pointMap) : undefined,
            })),
            contour.closed,
        ));
        return clone;
    }

    private cloneShape(shape: Shape): Shape {
        const clone = new Shape(this.editor, {
            type: shape.type,
            position: new Point(shape.position.x, shape.position.y),
            width: shape.width,
            height: shape.height,
        });

        clone.name = `${shape.name} Copy`;
        clone.visible = shape.visible;
        clone.locked = false;
        clone.opacity = shape.opacity;
        clone.transform = { ...shape.transform };
        clone.motion = { ...shape.motion };
        clone.settings = {
            ...shape.settings,
            stroke: clonePaint(shape.settings.stroke, this.editor.ID),
            fill: clonePaint(shape.settings.fill, this.editor.ID),
        };
        return clone;
    }

    private cloneText(text: TextElement): TextElement {
        const clone = new TextElement(this.editor, new Point(text.position.x, text.position.y));
        clone.name = `${text.name} Copy`;
        clone.visible = text.visible;
        clone.locked = false;
        clone.opacity = text.opacity;
        clone.transform = { ...text.transform };
        clone.motion = { ...text.motion };
        clone.settings = {
            ...text.settings,
            color: text.settings.color ? new Color(text.settings.color.serialized) : null,
        };
        return clone;
    }

    private cloneGroup(group: Group): Group {
        const clone = this.createGroup();
        clone.name = `${group.name} Copy`;
        clone.visible = group.visible;
        clone.locked = false;
        clone.opacity = group.opacity;
        clone.transform = { ...group.transform };
        clone.motion = { ...group.motion };
        const clonedElements = group.elements.map((element) => ({
            original: element,
            clone: this.clone(element),
        }));
        clone.elements = clonedElements.map((entry) => entry.clone);
        clone.clipElementId = clonedElements.find((entry) => entry.original.id === group.clipElementId)?.clone.id ?? null;
        return clone;
    }
}
