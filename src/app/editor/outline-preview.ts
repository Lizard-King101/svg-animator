import type { OutlineSection } from '../../../packages/runtime/src/outline';
import type { Path } from './objects/elements/path.object';

/** Session drafts never enter serialization, history, exports, or rig weight ownership. */
const previews = new WeakMap<Path, OutlineSection[]>();
export function resolvedOutlineSections(path: Path): OutlineSection[] | undefined {
    return previews.get(path) ?? path.outlineSections;
}
export function setOutlinePreview(path: Path, sections: OutlineSection[] | undefined): void {
    if(sections === undefined) previews.delete(path);
    else previews.set(path, sections);
}
