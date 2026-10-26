import { Armature } from './objects/armature';
import { findAnimationTarget, readAnimationProperty, writeAnimationProperty } from './objects/animation-targets';
import type { SVG } from './objects/svg.object';
import { applyRigPose, bindingProblem } from './rig-binding';
import { attachmentProblem, attachmentTransforms } from './rig-attachments';
import { evaluateRigConstraints } from './rig-constraints';
import { parseRigAnimationProperty, readRigAnimationProperty } from '../../../packages/runtime/src/rig/channels';
export type { RigAnimationField, RigAnimationProperty } from '../../../packages/runtime/src/rig/channels';
export { parseRigAnimationProperty, rigAnimationProperty, readRigAnimationProperty } from '../../../packages/runtime/src/rig/channels';

export function readDocumentAnimationProperty(svg: SVG, targetId: string, property: string): unknown {
    if(parseRigAnimationProperty(property)) return readRigAnimationProperty(svg.rigs, targetId, property);
    const target = findAnimationTarget(svg.elements, targetId);
    return target ? readAnimationProperty(target, property) : undefined;
}

export function writeDocumentAnimationProperty(svg: SVG, targetId: string, property: string, value: unknown): boolean {
    const parsed = parseRigAnimationProperty(property);
    if(parsed) {
        const bone = svg.rigs.armatures.find(rig => rig.id === targetId)?.bones.find(bone => bone.id === parsed.boneId);
        if(!bone || typeof value !== 'number' || !Number.isFinite(value)) return false;
        bone[parsed.field] = value;
        return true;
    }
    const target = findAnimationTarget(svg.elements, targetId);
    return !!target && writeAnimationProperty(target, property, value);
}

/** The artwork controlled by a rig remains in its original layer hierarchy. */
export function rigArtworkIds(rig: Armature): string[] {
    return [...new Set([...rig.bindings.map(binding => binding.pathId), ...(rig.attachments ?? []).map(link => link.elementId)])];
}

/** Validate authored base artwork before a preview writes any animation channels. */
export function rigAnimationBaseProblem(svg: SVG, rigIds: ReadonlySet<string>): string | undefined {
    for(const rig of svg.rigs.armatures.filter(rig => rigIds.has(rig.id))) {
        try {
            // The saved base can be an intentionally suspended rest setup.
            const pose = evaluateRigConstraints(rig);
            const options = { allowUnavailable: true };
            const problem = bindingProblem(svg, pose, options) ?? attachmentProblem(svg, pose, options);
            if(problem) return problem;
        } catch(error) { return error instanceof Error ? error.message : 'This armature cannot evaluate its authored pose.'; }
    }
    return undefined;
}

/**
 * Materialize all channels together: authored FK, then constraints, then artwork.
 * Preflight each rig before writing artwork so an invalid IK/attachment cannot
 * leave a frame partially updated. The authored bone poses remain unsolved.
 */
export function applyDocumentRigAnimation(svg: SVG, rigIds?: ReadonlySet<string>): Set<string> {
    const evaluated = svg.rigs.armatures.filter(rig => !rigIds || rigIds.has(rig.id)).map(rig => {
        // Rest/setup may suspend solving; playback always evaluates enabled IK.
        // Keep that session-facing authored flag untouched when sampling a frame.
        const pose = evaluateRigConstraints({ ...rig, constraintsActive: true });
        return { pose, transforms: attachmentTransforms(pose) };
    });
    const affected = new Set<string>();
    for(const { pose, transforms } of evaluated) {
        applyRigPose(svg, pose);
        for(const [id, transform] of transforms) {
            const target = findAnimationTarget(svg.elements, id);
            if(target) target.transform = transform;
        }
        rigArtworkIds(pose).forEach(id => affected.add(id));
    }
    return affected;
}
