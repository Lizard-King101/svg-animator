import { Injectable } from "@angular/core";
import { Group } from "../editor/objects/elements/group.object";
import { Path } from "../editor/objects/elements/path.object";
import { Shape } from "../editor/objects/elements/shape.object";
import { TextElement } from "../editor/objects/elements/text.object";
import { Line } from "../editor/objects/line.object";
import { Point } from "../editor/objects/point.object";
import { AnyElement, SVG, SVGSave } from "../editor/objects/svg.object";
import { EditorService } from "./editor.service";
import { clonePaint } from "../editor/objects/paint.object";

export interface ElementCloneSelection {
    roots: AnyElement[];
    elements: Map<string, { original: AnyElement; duplicate: AnyElement }>;
    /** Includes artwork, contours, segments, implicit closing edges, and every path point. */
    ids: Map<string, string>;
}

/**
 * Constructs editor elements while the persisted model still requires an
 * EditorService in each constructor. Keeping that dependency here makes the
 * later schema/model decoupling a contained change.
 */
@Injectable()
export class ElementFactory {
    constructor(private editor: EditorService) {}

    restoreDocument(save: SVGSave): SVG {
        return SVG.fromSave(save, this.editor);
    }

    createPath(): Path { return new Path(this.editor); }

    createGroup(): Group {
        return new Group(this.editor);
    }

    clone(element: AnyElement): AnyElement {
        return this.cloneSelection([element]).roots[0];
    }

    cloneSelection(elements: readonly AnyElement[]): ElementCloneSelection {
        const result: ElementCloneSelection = { roots: [], elements: new Map(), ids: new Map() };
        result.roots = elements.map(element => this.cloneElement(element, result));
        for(const { duplicate } of result.elements.values()) {
            if(duplicate.motion.pathId) duplicate.motion.pathId = result.ids.get(duplicate.motion.pathId) ?? duplicate.motion.pathId;
            if(duplicate instanceof Group && duplicate.clipElementId) {
                duplicate.clipElementId = result.ids.get(duplicate.clipElementId) ?? duplicate.clipElementId;
            }
        }
        return result;
    }

    private cloneElement(element: AnyElement, result: ElementCloneSelection): AnyElement {
        const duplicate = element instanceof Path ? this.clonePath(element, result.ids)
            : element instanceof Shape ? this.cloneShape(element)
            : element instanceof TextElement ? this.cloneText(element) : this.cloneGroup(element, result);
        result.elements.set(element.id, { original: element, duplicate });
        result.ids.set(element.id, duplicate.id);
        return duplicate;
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

    private clonePath(path: Path, ids: Map<string, string>): Path {
        const clone = new Path(this.editor);
        const pointMap = new Map<string, Point>();

        clone.name = `${path.name} Copy`;
        clone.visible = path.visible;
        clone.locked = false;
        clone.opacity = path.opacity;
        clone.drawProgress = path.drawProgress;
        clone.closed = path.closed;
        clone.fillRule = path.fillRule;
        clone.transform = { ...path.transform };
        clone.motion = { ...path.motion };
        clone.settings = {
            ...path.settings,
            stroke_dasharray: [...path.settings.stroke_dasharray],
            stroke: clonePaint(path.settings.stroke, this.editor.ID),
            fill: clonePaint(path.settings.fill, this.editor.ID),
        };
        clone.contours = path.contours.map((contour) => {
            const copied = clone.createContour(contour.lines.map((line) => {
                const copiedLine = new Line(this.editor, {
                    type: line.type,
                    points: line.points.map((point) => this.clonePoint(point, pointMap)),
                    controlStart: line.controlStart ? this.clonePoint(line.controlStart, pointMap) : undefined,
                    controlEnd: line.controlEnd ? this.clonePoint(line.controlEnd, pointMap) : undefined,
                });
                ids.set(line.id, copiedLine.id);
                return copiedLine;
            }), contour.closed);
            ids.set(contour.id, copied.id);
            ids.set(`${contour.id}:close`, `${copied.id}:close`);
            return copied;
        });
        pointMap.forEach((point, id) => ids.set(id, point.id));
        clone.outlineSections = path.outlineSections?.map(section => ({
            ...structuredClone(section), id: this.editor.ID,
            contourId: ids.get(section.contourId)!,
            start: { ...section.start, segmentId: ids.get(section.start.segmentId)! },
            end: { ...section.end, segmentId: ids.get(section.end.segmentId)! },
        }));
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
            stroke_dasharray: [...shape.settings.stroke_dasharray],
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
            color: clonePaint(text.settings.color, this.editor.ID),
        };
        return clone;
    }

    private cloneGroup(group: Group, result: ElementCloneSelection): Group {
        const clone = this.createGroup();
        clone.name = `${group.name} Copy`;
        clone.visible = group.visible;
        clone.locked = false;
        clone.opacity = group.opacity;
        clone.transform = { ...group.transform };
        clone.motion = { ...group.motion };
        clone.elements = group.elements.map(element => this.cloneElement(element, result));
        clone.clipElementId = group.clipElementId;
        return clone;
    }
}
