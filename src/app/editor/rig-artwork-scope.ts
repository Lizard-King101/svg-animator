import { AnyElement, SVG } from './objects/svg.object';
import { Path } from './objects/elements/path.object';
import { Group } from './objects/elements/group.object';
import { findElementChain } from './objects/element-bounds';
import { combinedMotionAdjustedMatrixFor } from './objects/motion-path.object';
import { allAnimationDocuments } from './objects/animation.object';

/** Includes native clipping paths; never changes the artwork hierarchy or draw order. */
export function nativeWeightPaths(target: AnyElement): Path[] {
    if(target instanceof Path) return [target];
    return target instanceof Group ? target.elements.flatMap(nativeWeightPaths) : [];
}

/** Entire-scope preflight: unsupported descendants cannot produce a partial group binding. */
export function weightScopeProblem(svg: SVG, target: AnyElement): string | undefined {
    if(!findElementChain(svg.elements,target)) return 'This artwork is no longer in the document.';
    const inspect = (element: AnyElement): string | undefined => {
        if(element instanceof Group) {
            if(!element.elements.length) return `${element.name} is empty. Add paths before binding this group.`;
            for(const child of element.elements) { const problem = inspect(child); if(problem) return problem; }
            return undefined;
        }
        if(!(element instanceof Path)) return `${element.name} is not a native path. Convert shapes or text to paths before weighted group binding.`;
        const chain = findElementChain(svg.elements,element) ?? [];
        if(!element.pathPoints().length || chain.some(item => item.locked || !item.visible || item.motion.pathId)) return `Show and unlock ${element.name} and its ancestors, and remove motion-path constraints before binding.`;
        const matrix = combinedMotionAdjustedMatrixFor(svg,element);
        if(Math.abs(matrix.a*matrix.d-matrix.b*matrix.c) < .000001) return `Restore a nonzero scale for ${element.name} before binding.`;
        if(allAnimationDocuments(svg.animation).some(animation => animation.tracks.some(track => chain.some(item => item.id === track.targetId)))) return `Remove existing animation on ${element.name} or its ancestors before binding. Rig animation channels are a later step.`;
        return undefined;
    };
    return inspect(target);
}
