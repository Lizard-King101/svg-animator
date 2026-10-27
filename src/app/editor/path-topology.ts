import { findElementChain } from './objects/element-bounds';
import { Path } from './objects/elements/path.object';
import { AnyElement, SVG } from './objects/svg.object';

export type PathTopologyOperation = 'split' | 'break' | 'close' | 'delete' | 'convert' | 'trim';

/** Shared refusal policy for commands which change editable point/segment identities. */
export function pathTopologyProblem(svg: SVG | undefined, element: AnyElement, operation: PathTopologyOperation): string | undefined {
    if(!svg) return 'Open a document before editing paths.';
    const chain = findElementChain(svg.elements, element) ?? [element];
    if(chain.some(item => item.locked || !item.visible)) return 'Show and unlock this artwork before editing its geometry.';
    const ancestry = new Set(chain.map(item => item.id));
    if(svg.rigs.armatures.some(rig => rig.bindings.some(binding => binding.pathId === element.id)
        || rig.attachments?.some(attachment => ancestry.has(attachment.elementId)))) {
        return 'This artwork is bound to bones. Use Edit outline for visual gaps, or unbind it before changing its geometry.';
    }
    const animations = [svg.animation, ...(svg.animation.composition?.actions.map(action => action.animation) ?? [])];
    if(animations.some(animation => animation.tracks.some(track => track.targetId === element.id
        && /^(points\.|geometry\.|path\.(?:points\.|contours\.|lines\.|d$))/.test(track.property)))) {
        return 'This path has geometry animation. Use Edit outline, or remove its geometry keys before changing its topology.';
    }
    if(element instanceof Path && element.outlineSections !== undefined && operation !== 'split') {
        return 'This path has outline sections. Use Edit outline for visual gaps, or Restore full outline before changing its topology.';
    }
    return undefined;
}
