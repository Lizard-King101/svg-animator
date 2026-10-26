import { Group } from './elements/group.object';
import { AnyElement } from './svg.object';

/** Hidden clipping artwork still contributes geometry; other hidden layers do not. */
export function isGeometryVisible(chain: readonly AnyElement[]): boolean {
    return chain.every((element, index) => element.visible
        || index > 0 && chain[index - 1] instanceof Group
            && (chain[index - 1] as Group).clipElementId === element.id);
}
