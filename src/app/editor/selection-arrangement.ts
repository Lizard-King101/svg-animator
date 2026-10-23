import { findElementChain, parentMatrixFor, resolvedOrigin } from './objects/element-bounds';
import { arrangementBounds } from './objects/arrangement-bounds';
import { AnyElement, SVG } from './objects/svg.object';
import { Bounds, invertMatrix, unionBounds } from './objects/transform.object';
import { selectionFrame } from './selection';

export type Alignment = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
export type AlignmentReference = 'selection' | 'canvas' | 'last';
export interface SelectionTranslation { element: AnyElement; x: number; y: number; }

/** Plan in canvas coordinates before moving anything, including automatic parent origins. */
export function alignmentTranslations(svg: SVG, selected: AnyElement[], action: Alignment, reference: AlignmentReference): SelectionTranslation[] {
    const items = arrangementItems(svg, selected);
    if(!items.length) return [];
    const target = reference === 'canvas' ? svg.canvasBounds
        : reference === 'last' ? items[items.length - 1].bounds : unionBounds(items.map((item) => item.bounds));
    const horizontal = ['left', 'centerX', 'right'].includes(action);
    return items.map(({ element, bounds }) => {
        const delta = edge(target, action) - edge(bounds, action);
        return { element, x: horizontal ? delta : 0, y: horizontal ? 0 : delta };
    });
}

/** Equal edge-to-edge gaps; the two outer objects stay fixed, even for overlapping artwork. */
export function distributionTranslations(svg: SVG, selected: AnyElement[], axis: 'x' | 'y'): SelectionTranslation[] {
    const items = arrangementItems(svg, selected).sort((a, b) => a.bounds[axis] - b.bounds[axis]);
    if(items.length < 3) return [];
    const size = axis === 'x' ? 'width' : 'height';
    const first = items[0].bounds, last = items[items.length - 1].bounds;
    const gap = (last[axis] + last[size] - first[axis] - items.reduce((sum, item) => sum + item.bounds[size], 0)) / (items.length - 1);
    let position = first[axis];
    return items.map(({ element, bounds }, index) => {
        const delta = index === 0 || index === items.length - 1 ? 0 : position - bounds[axis];
        position += bounds[size] + gap;
        return { element, x: axis === 'x' ? delta : 0, y: axis === 'y' ? delta : 0 };
    });
}

/** Shared translation boundary for keyboard nudges and arrangement commands. */
export function translateSelection(svg: SVG, translations: SelectionTranslation[]): boolean {
    const moves = translations.filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x, y) > 0.000001);
    if(!moves.length) return false;
    const frame = selectionFrame(svg, moves.map(({ element }) => element));
    if(!frame?.canTransform || frame.elements.length !== moves.length) return false;
    const ancestors = new Map<AnyElement, { x: number; y: number }>();
    const next = moves.map(({ element, x, y }) => {
        findElementChain(svg.elements, element)!.slice(0, -1).forEach((parent) => {
            if(!ancestors.has(parent)) ancestors.set(parent, resolvedOrigin(parent));
        });
        const inverse = invertMatrix(parentMatrixFor(svg.elements, element));
        return { element, x: inverse.a * x + inverse.c * y, y: inverse.b * x + inverse.d * y };
    });
    ancestors.forEach((origin, element) => {
        element.transform.originX = origin.x;
        element.transform.originY = origin.y;
    });
    next.forEach(({ element, x, y }) => { element.transform.translateX += x; element.transform.translateY += y; });
    return true;
}

function arrangementItems(svg: SVG, selected: AnyElement[]): { element: AnyElement; bounds: Bounds }[] {
    const frame = selectionFrame(svg, selected);
    return frame?.canTransform ? frame.elements.map((element) => ({ element,
        bounds: arrangementBounds(svg, element) })) : [];
}

function edge(bounds: Bounds, action: Alignment): number {
    switch(action) {
        case 'left': return bounds.x;
        case 'centerX': return bounds.x + bounds.width / 2;
        case 'right': return bounds.x + bounds.width;
        case 'top': return bounds.y;
        case 'centerY': return bounds.y + bounds.height / 2;
        case 'bottom': return bounds.y + bounds.height;
    }
}
