import { Group, GroupElement } from "./elements/group.object";
import { Path } from "./elements/path.object";
import { Shape } from "./elements/shape.object";
import { TextElement } from "./elements/text.object";
import { AnyElement } from "./svg.object";
import {
    Bounds,
    Matrix,
    boundsCenter,
    identityMatrix,
    multiplyMatrix,
    transformMatrix,
    transformedBounds,
    unionBounds,
} from "./transform.object";

export function localBounds(element: AnyElement): Bounds {
    if(element instanceof Path) {
        const points = element.lines.flatMap((line) => {
            return [
                ...line.points,
                ...(line.controlStart ? [line.controlStart] : []),
                ...(line.controlEnd ? [line.controlEnd] : []),
            ];
        });

        if(points.length === 0) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }

        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    if(element instanceof Shape) {
        return {
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
        };
    }

    if(element instanceof TextElement) {
        return {
            x: element.boundsX,
            y: element.y,
            width: element.width,
            height: element.height,
        };
    }

    return groupLocalBounds(element);
}

export function resolvedOrigin(element: AnyElement): { x: number; y: number } {
    const transform = element.transform;
    if(transform.originX != null && transform.originY != null) {
        return { x: transform.originX, y: transform.originY };
    }

    return boundsCenter(localBounds(element));
}

export function pinTransformOrigin(element: AnyElement): { x: number; y: number } {
    const origin = resolvedOrigin(element);
    element.transform.originX = origin.x;
    element.transform.originY = origin.y;
    return origin;
}

export function pinAncestorTransformOrigins(rootElements: AnyElement[], element: AnyElement) {
    const chain = findElementChain(rootElements, element);
    if(!chain) {
        return;
    }

    chain.slice(0, -1).forEach((ancestor) => {
        if(ancestor instanceof Group && hasNonTranslateTransform(ancestor)) {
            pinTransformOrigin(ancestor);
        }
    });
}

export function ownMatrix(element: AnyElement): Matrix {
    return transformMatrix(element.transform, resolvedOrigin(element));
}

export function ownTransformBounds(element: AnyElement): Bounds {
    return transformedBounds(localBounds(element), ownMatrix(element));
}

export function combinedMatrixFor(rootElements: AnyElement[], element: AnyElement): Matrix {
    const chain = findElementChain(rootElements, element);
    if(!chain) {
        return ownMatrix(element);
    }

    return chain.reduce((matrix, item) => {
        return multiplyMatrix(matrix, ownMatrix(item));
    }, identityMatrix());
}

export function parentMatrixFor(rootElements: AnyElement[], element: AnyElement): Matrix {
    const chain = findElementChain(rootElements, element);
    if(!chain) {
        return identityMatrix();
    }

    return chain.slice(0, -1).reduce((matrix, item) => {
        return multiplyMatrix(matrix, ownMatrix(item));
    }, identityMatrix());
}

export function transformedElementBounds(rootElements: AnyElement[], element: AnyElement): Bounds {
    return transformedBounds(localBounds(element), combinedMatrixFor(rootElements, element));
}

function groupLocalBounds(group: Group): Bounds {
    const bounds = group.elements
        .filter((element): element is GroupElement => element.visible)
        .map((element) => ownTransformBounds(element));
    return unionBounds(bounds);
}

function findElementChain(elements: AnyElement[], element: AnyElement, chain: AnyElement[] = []): AnyElement[] | undefined {
    for(const candidate of elements) {
        const nextChain = [...chain, candidate];
        if(candidate === element) {
            return nextChain;
        }

        if(candidate instanceof Group) {
            const found = findElementChain(candidate.elements, element, nextChain);
            if(found) {
                return found;
            }
        }
    }

    return undefined;
}

function hasNonTranslateTransform(element: AnyElement): boolean {
    return Math.abs(element.transform.scaleX - 1) > 0.000001
        || Math.abs(element.transform.scaleY - 1) > 0.000001
        || Math.abs(element.transform.rotation) > 0.000001;
}
