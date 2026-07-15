import { Injectable } from "@angular/core";
import { combinedMatrixFor } from "../editor/objects/element-bounds";
import { Group } from "../editor/objects/elements/group.object";
import { Path } from "../editor/objects/elements/path.object";
import { Line } from "../editor/objects/line.object";
import { Point } from "../editor/objects/point.object";
import { convertStrokeToPath, StrokeToPathProfile } from "../editor/objects/stroke-outline.object";
import { AnyElement } from "../editor/objects/svg.object";
import { applyMatrix, invertMatrix, multiplyMatrix } from "../editor/objects/transform.object";
import { makeAnimationId } from "../editor/objects/animation.object";
import { matchingAnimationProperty } from "../editor/objects/animation-targets";
import { EditorService } from "./editor.service";
import { ElementFactory } from "./element-factory.service";

export interface LayerContext {
    element: AnyElement;
    elements: AnyElement[];
    index: number;
    parent?: Group;
}

/** Structural document operations. UI selection and gesture state stay outside. */
@Injectable()
export class LayerOperationsService {
    constructor(
        private editor: EditorService,
        private elements: ElementFactory,
    ) {}

    context(element: AnyElement): LayerContext | undefined {
        const roots = this.editor.selectedSVG?.elements;
        return roots ? this.findContext(roots, element) : undefined;
    }

    findContext(elements: AnyElement[], element: AnyElement, parent?: Group): LayerContext | undefined {
        const index = elements.indexOf(element);
        if(index >= 0) return { element, elements, index, parent };

        for(const candidate of elements) {
            if(candidate instanceof Group) {
                const found = this.findContext(candidate.elements, element, candidate);
                if(found) return found;
            }
        }
        return undefined;
    }

    contains(parent: AnyElement, child: AnyElement): boolean {
        return parent instanceof Group && parent.elements.some((element) => {
            return element === child || this.contains(element, child);
        });
    }

    contexts(selected: AnyElement[]): LayerContext[] {
        return selected.map((element) => this.context(element)).filter((value): value is LayerContext => !!value);
    }

    canGroup(selected: AnyElement[]): boolean {
        if(selected.length < 2) return false;
        const contexts = this.contexts(selected);
        return contexts.length === selected.length
            && contexts.every((context) => context.elements === contexts[0].elements);
    }

    group(selected: AnyElement[]): Group | undefined {
        if(!this.canGroup(selected)) return undefined;
        const contexts = this.contexts(selected);
        const siblings = contexts[0].elements;
        const selectedSet = new Set(selected);
        const drawOrder = siblings.filter((element) => selectedSet.has(element));
        const firstIndex = siblings.findIndex((element) => selectedSet.has(element));
        const group = this.elements.createGroup();
        group.name = `Group ${drawOrder.length} Layers`;
        group.elements = drawOrder;
        drawOrder.forEach((element) => siblings.splice(siblings.indexOf(element), 1));
        siblings.splice(firstIndex, 0, group);
        return group;
    }

    canCombine(selected: AnyElement[], target: AnyElement): target is Path {
        return target instanceof Path
            && selected.length >= 2
            && selected.includes(target)
            && selected.every((element) => element instanceof Path)
            && this.canGroup(selected);
    }

    combine(selected: AnyElement[], target: Path): boolean {
        if(!this.canCombine(selected, target) || !this.editor.selectedSVG) return false;
        const contexts = this.contexts(selected);
        const sources = contexts
            .filter((context) => context.element !== target && context.element instanceof Path)
            .sort((a, b) => a.index - b.index);
        sources.forEach((context) => this.appendContours(target, context.element as Path));
        [...sources].sort((a, b) => b.index - a.index).forEach((context) => context.elements.splice(context.index, 1));
        target.fillRule = "evenodd";
        return true;
    }

    duplicate(element: AnyElement): AnyElement | undefined {
        const context = this.context(element);
        if(!context) return undefined;
        const duplicate = this.elements.clone(element);
        context.elements.splice(context.index + 1, 0, duplicate);
        this.duplicateAnimation(element, duplicate);
        return duplicate;
    }

    private duplicateAnimation(original: AnyElement, duplicate: AnyElement): void {
        const animation = this.editor.selectedSVG?.animation;
        if(!animation) return;

        const elements = new Map<string, { original: AnyElement; duplicate: AnyElement }>();
        this.mapDuplicateElements(original, duplicate, elements);
        const tracks = animation.tracks
            .filter((track) => elements.has(track.targetId))
            .flatMap((track) => {
                const pair = elements.get(track.targetId)!;
                const property = matchingAnimationProperty(pair.original, pair.duplicate, track.property);
                if(!property) return [];
                return [{
                    id: makeAnimationId("track"),
                    targetId: pair.duplicate.id,
                    property,
                    valueType: track.valueType,
                    enabled: track.enabled,
                    keyframes: track.keyframes.map((keyframe) => ({
                        id: makeAnimationId("key"),
                        time: keyframe.time,
                        value: cloneValue(keyframe.value),
                        easing: cloneValue(keyframe.easing),
                        temporal: cloneValue(keyframe.temporal),
                    })),
                }];
            });
        animation.tracks.push(...tracks);
    }

    private mapDuplicateElements(
        original: AnyElement,
        duplicate: AnyElement,
        elements: Map<string, { original: AnyElement; duplicate: AnyElement }>,
    ): void {
        elements.set(original.id, { original, duplicate });

        if(original instanceof Group && duplicate instanceof Group) {
            original.elements.forEach((child, index) => {
                const cloned = duplicate.elements[index];
                if(cloned) this.mapDuplicateElements(child, cloned, elements);
            });
        }
    }

    convertStroke(path: Path, profile: StrokeToPathProfile): Path | undefined {
        const context = this.context(path);
        if(!context) return undefined;
        const converted = convertStrokeToPath(path, this.editor, profile) ?? undefined;
        if(converted) context.elements.splice(context.index, 1, converted);
        return converted;
    }

    delete(element: AnyElement): boolean {
        const context = this.context(element);
        if(!context) return false;
        context.elements.splice(context.index, 1);
        return true;
    }

    deleteMany(selected: AnyElement[]): boolean {
        const topLevelSelected = selected.filter((layer) => {
            return !selected.some((candidate) => candidate !== layer && this.contains(candidate, layer));
        });
        let changed = false;
        topLevelSelected.forEach((layer) => { changed = this.delete(layer) || changed; });
        return changed;
    }

    moveBackward(element: AnyElement): boolean {
        const context = this.context(element);
        if(!context || context.index <= 0) return false;
        context.elements.splice(context.index, 1);
        context.elements.splice(context.index - 1, 0, element);
        return true;
    }

    moveForward(element: AnyElement): boolean {
        const context = this.context(element);
        if(!context || context.index >= context.elements.length - 1) return false;
        context.elements.splice(context.index, 1);
        context.elements.splice(context.index + 1, 0, element);
        return true;
    }

    groupWithBelow(element: AnyElement, clipping = false): Group | undefined {
        const context = this.context(element);
        if(!context || context.index <= 0) return undefined;
        const below = context.elements[context.index - 1];
        const group = this.elements.createGroup();
        group.name = clipping ? `Clip ${below.name} With ${element.name}` : `Group ${below.name}, ${element.name}`;
        group.elements = [below, element];
        if(clipping) {
            element.visible = true;
            group.clipElementId = element.id;
        }
        context.elements.splice(context.index - 1, 2, group);
        return group;
    }

    ungroup(group: Group): AnyElement[] | undefined {
        const context = this.context(group);
        if(!context) return undefined;
        context.elements.splice(context.index, 1, ...group.elements);
        return [...group.elements];
    }

    useAsClippingMask(element: AnyElement): boolean {
        const parent = this.context(element)?.parent;
        if(!parent) return false;
        element.visible = true;
        parent.clipElementId = element.id;
        return true;
    }

    releaseClippingMask(group: Group): boolean {
        if(!group.clipElementId) return false;
        group.clipElementId = null;
        return true;
    }

    availableMotionPaths(element: AnyElement): Path[] {
        const paths: Path[] = [];
        const collect = (elements: AnyElement[]) => elements.forEach((candidate) => {
            if(candidate instanceof Path && candidate !== element && !this.contains(element, candidate)) paths.push(candidate);
            if(candidate instanceof Group) collect(candidate.elements);
        });
        collect(this.editor.selectedSVG?.elements ?? []);
        return paths;
    }

    attachMotionPath(element: AnyElement, path: Path): boolean {
        if(element.motion.pathId === path.id) return false;
        element.motion.pathId = path.id;
        element.motion.progress = 0;
        element.motion.offsetX = 0;
        element.motion.offsetY = 0;
        return true;
    }

    detachMotionPath(element: AnyElement): boolean {
        if(!element.motion.pathId) return false;
        element.motion.pathId = null;
        return true;
    }

    toggleVisibility(element: AnyElement): void { element.visible = !element.visible; }
    toggleLock(element: AnyElement): void { element.locked = !element.locked; }

    private appendContours(target: Path, source: Path): void {
        const roots = this.editor.selectedSVG!.elements;
        const sourceToTarget = multiplyMatrix(
            invertMatrix(combinedMatrixFor(roots, target)),
            combinedMatrixFor(roots, source),
        );
        source.contours.forEach((contour) => {
            const pointMap = new Map<string, Point>();
            const clonePoint = (point: Point): Point => {
                let cloned = pointMap.get(point.id);
                if(!cloned) {
                    const transformed = applyMatrix(sourceToTarget, point.x, point.y);
                    cloned = new Point(transformed.x, transformed.y);
                    cloned.cornerRadius = point.cornerRadius;
                    pointMap.set(point.id, cloned);
                }
                return cloned;
            };
            target.contours.push(target.createContour(contour.lines.map((segment) => new Line(this.editor, {
                type: segment.type,
                points: segment.points.map(clonePoint),
                controlStart: segment.controlStart ? clonePoint(segment.controlStart) : undefined,
                controlEnd: segment.controlEnd ? clonePoint(segment.controlEnd) : undefined,
            })), contour.closed));
        });
    }
}

function cloneValue<T>(value: T): T {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}
