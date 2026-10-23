import { findElementChain, localBounds } from './objects/element-bounds';
import { combinedMotionAdjustedMatrixFor } from './objects/motion-path.object';
import { AnyElement, SVG } from './objects/svg.object';
import { Bounds, Matrix, identityMatrix, invertMatrix, multiplyMatrix, transformedBounds, unionBounds } from './objects/transform.object';

/** One ordered session selection. History rebinds its IDs to restored objects. */
export class EditorSelection {
    private selected: AnyElement[] = [];

    get elements(): AnyElement[] { return [...this.selected]; }

    replace(elements: AnyElement[]): void { this.selected = [...new Map(elements.map((element) => [element.id, element])).values()]; }
}

/** Drop descendants of selected ancestors, and honor inherited visibility/locks. */
export function selectionRoots(svg: SVG, selected: AnyElement[]): AnyElement[] {
    const ids = new Set(selected.map((element) => element.id));
    return selected.filter((element) => {
        const chain = findElementChain(svg.elements, element);
        return chain && chain.every((item) => item.visible && !item.locked)
            && !chain.slice(0, -1).some((ancestor) => ids.has(ancestor.id));
    });
}

export interface SelectionFrame {
    elements: AnyElement[];
    bounds: Bounds;
    matrix: Matrix;
    canRotate: boolean;
    canTransform: boolean;
}

export function selectionFrame(svg: SVG, selected: AnyElement[]): SelectionFrame | undefined {
    const elements = selectionRoots(svg, selected);
    if(!elements.length) return undefined;
    const chains = elements.map((element) => findElementChain(svg.elements, element)!);
    const parents = chains.map((chain) => chain.at(-2));
    const sharedParent = parents.every((parent) => parent === parents[0]) ? parents[0] : undefined;
    const matrix = sharedParent ? combinedMotionAdjustedMatrixFor(svg, sharedParent) : identityMatrix();
    const inverse = invertMatrix(matrix);
    const bounds = unionBounds(elements.map((element) => transformedBounds(localBounds(element),
        multiplyMatrix(inverse, combinedMotionAdjustedMatrixFor(svg, element)))));
    const relativeParents = parents.map((parent) => multiplyMatrix(inverse,
        parent ? combinedMotionAdjustedMatrixFor(svg, parent) : identityMatrix()));
    const canTransform = chains.every((chain) => chain.every((element) => !element.motion.pathId))
        && Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) > 0.000001
        && relativeParents.every((parent) => Math.abs(parent.a * parent.d - parent.b * parent.c) > 0.000001);
    return { elements, bounds, matrix, canTransform, canRotate: relativeParents.every(isSimilarity) };
}

function isSimilarity(matrix: Matrix): boolean {
    const x = Math.hypot(matrix.a, matrix.b);
    const y = Math.hypot(matrix.c, matrix.d);
    return x > 0.000001 && Math.abs(x - y) < 0.000001 * Math.max(x, y)
        && Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) < 0.000001 * x * y;
}
