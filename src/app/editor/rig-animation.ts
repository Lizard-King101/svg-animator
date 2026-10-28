import { DocumentRigEvaluationPlan } from './rig-evaluation';
import { Armature } from './objects/armature';
import { findAnimationTarget, readAnimationProperty, writeAnimationProperty } from './objects/animation-targets';
import type { SVG } from './objects/svg.object';
import { bindingProblem } from './rig-binding';
import { attachmentProblem } from './rig-attachments';
import { evaluateRigConstraints } from './rig-constraints';
import { parseRigAnimationProperty, readRigAnimationProperty, resolveRigAnimationChannel } from '../../../packages/runtime/src/rig/channels';
export type { RigAnimationField, RigAnimationProperty } from '../../../packages/runtime/src/rig/channels';
export { rigWindProperty, parseRigAnimationProperty, rigAnimationProperty, readRigAnimationProperty } from '../../../packages/runtime/src/rig/channels';

export function readDocumentAnimationProperty(svg: SVG, targetId: string, property: string): unknown {
    if(parseRigAnimationProperty(property)) return readRigAnimationProperty(svg.rigs, targetId, property);
    const target = findAnimationTarget(svg.elements, targetId);
    return target ? readAnimationProperty(target, property) : undefined;
}

export function writeDocumentAnimationProperty(svg: SVG, targetId: string, property: string, value: unknown): boolean {
    const parsed = parseRigAnimationProperty(property);
    if(parsed) {
        const channel=resolveRigAnimationChannel(svg.rigs.armatures.find(rig=>rig.id===targetId),property);
        if(!channel || typeof value !== 'number' || !Number.isFinite(value)) return false;
        channel.write(value);
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
    return new DocumentRigEvaluationPlan(svg).apply(rigIds);
}
