import { Armature } from './objects/armature';
import { findAnimationTarget } from './objects/animation-targets';
import { findElementChain, ownMatrix, parentMatrixFor } from './objects/element-bounds';
import { isGeometryVisible } from './objects/element-availability';
import { SVG } from './objects/svg.object';
import { Matrix } from './objects/transform.object';
import type { RigArtworkValidationOptions } from './rig-binding';

export { attachmentMatrix, attachmentTransforms } from '../../../packages/runtime/src/rig/attachments';
import { attachmentMatrix, attachmentTransforms } from '../../../packages/runtime/src/rig/attachments';
export function attachmentProblem(svg: SVG, rig: Armature, options: RigArtworkValidationOptions = {}): string | undefined {
    for(const attachment of rig.attachments ?? []) {
        const element = findAnimationTarget(svg.elements, attachment.elementId);
        if(!element) return 'Attached artwork was removed. Detach its missing link before posing.';
        const chain = findElementChain(svg.elements, element) ?? [];
        if((!options.allowUnavailable && (!isGeometryVisible(chain) || chain.some(item => item.locked))) || chain.some(item => item.motion.pathId)) return 'Show, unlock and remove motion-path constraints from attached artwork before posing.';
        if(!sameMatrix(parentMatrixFor(svg.elements, element), attachment.parentMatrix) || !sameMatrix(ownMatrix(element), attachmentMatrix(rig, attachment))) return 'An attached transform changed. Detach and attach again before posing.';
    }
    return undefined;
}
export function applyAttachments(svg: SVG, rig: Armature): void {
    for(const [id, transform] of attachmentTransforms(rig)) {
        const element = findAnimationTarget(svg.elements, id); if(element) element.transform = transform;
    }
}
function sameMatrix(a: Matrix, b: Matrix): boolean { return (Object.keys(a) as (keyof Matrix)[]).every(key => Math.abs(a[key] - b[key]) < .002); }
