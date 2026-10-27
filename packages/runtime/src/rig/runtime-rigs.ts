import type { RuntimeBundleV1, RuntimeSceneTargetV1 } from '../contracts';
import { RuntimePlayerError } from '../errors';
import { deformBinding, RigDocument, validRigs } from './armature';
import { evaluateRigConstraints } from './constraints';
import { attachmentMatrix, attachmentTransforms } from './attachments';
import { parseRigAnimationProperty } from './channels';
import { identityMatrix, Matrix, multiplyMatrix, transformMatrix } from './transform';

export interface RigSceneNode { id: string; parentId: string | null; }

/** Rig output owns geometry and the captured parent space; paint/visibility may animate independently. */
export function rigChannelConflict(rigs: RigDocument | undefined, scene: readonly RigSceneNode[], channel: { targetId: string; property: string }): string | undefined {
    if(!rigs) return;
    const boneChannel = parseRigAnimationProperty(channel.property);
    if(boneChannel) {
        const rig = rigs.armatures.find(rig => rig.id === channel.targetId);
        const constraint = rig?.constraints?.find(constraint => constraint.enabled && [constraint.upperBoneId, constraint.lowerBoneId].includes(boneChannel.boneId));
        return constraint ? `“${constraint.name}” controls this bone. Animate its IK target, or disable the constraint before animating this bone.` : undefined;
    }
    if(!/^(geometry\.|path\.points\.|transform\.|motion\.)/.test(channel.property)) return;
    const parents = new Map(scene.map(node => [node.id, node.parentId]));
    const isWithin = (id: string, ancestor: string): boolean => {
        const seen = new Set<string>();
        for(let current: string | null | undefined = id; current && !seen.has(current); current = parents.get(current)) {
            if(current === ancestor) return true;
            seen.add(current);
        }
        return false;
    };
    for(const rig of rigs.armatures) {
        const ids = [...rig.bindings.map(binding => binding.pathId), ...(rig.attachments ?? []).map(link => link.elementId)];
        if(ids.some(id => isWithin(id, channel.targetId))) return `“${rig.name}” controls this artwork's geometry and transform. Animate its bones or remove the binding before animating this property.`;
    }
    return;
}

/** The exported base artwork must still match its captured binding, before animation resumes IK. */
export function rigSceneBaseProblem(rigs: RigDocument, scene: readonly RuntimeSceneTargetV1[]): string | undefined {
    const targets = new Map(scene.map(target => [target.id, target]));
    const same = (a: Matrix, b: Matrix, tolerance: number) => (Object.keys(a) as (keyof Matrix)[]).every(key => Math.abs(a[key] - b[key]) < tolerance);
    const own = (target: RuntimeSceneTargetV1): Matrix => transformMatrix(target.transform, { x: target.transform.originX, y: target.transform.originY });
    const world = (id: string, seen = new Set<string>()): Matrix => {
        const target = targets.get(id);
        if(!target || seen.has(id)) throw new Error('Rig artwork has missing or cyclic parent references.');
        if(target.motion.pathId) throw new Error('Remove motion-path constraints from bound artwork and its ancestors before exporting rig animation.');
        seen.add(id);
        return multiplyMatrix(target.parentId ? world(target.parentId, seen) : identityMatrix(), own(target));
    };
    try {
        for(const rig of rigs.armatures) {
            const posed = evaluateRigConstraints(rig);
            for(const binding of posed.bindings) {
                const target = targets.get(binding.pathId)!;
                if(!same(world(binding.pathId), binding.matrix, .0002)) return `The transform of bound path “${binding.pathId}” changed. Rebind this artwork before export.`;
                const expected = deformBinding(posed, binding);
                for(const point of target.path!.contours.flatMap(contour => contour.lines.flatMap(line => [...line.points, line.controlStart, line.controlEnd]))) {
                    if(!point) continue;
                    const value = expected.get(point.id);
                    if(!value || Math.abs(value.x - point.x) > .0002 || Math.abs(value.y - point.y) > .0002) return `Bound points in “${binding.pathId}” were edited. Rebind this artwork before export.`;
                }
            }
            for(const attachment of posed.attachments ?? []) {
                const target = targets.get(attachment.elementId)!;
                const parent = target.parentId ? world(target.parentId) : identityMatrix();
                if(target.motion.pathId || !same(parent, attachment.parentMatrix, .002) || !same(own(target), attachmentMatrix(posed, attachment), .002)) return `Attached artwork “${attachment.elementId}” changed. Detach and attach it again before export.`;
            }
        }
    } catch(error) { return error instanceof Error ? error.message : 'Rig base artwork cannot be evaluated.'; }
    return;
}

/** Validate linked scene references before a frame can mutate any SVG nodes. */
export function rigSceneProblem(rigs: RigDocument, scene: readonly RuntimeSceneTargetV1[]): string | undefined {
    if(!validRigs(rigs)) return 'Rig data has invalid bone, constraint, weight, or attachment references.';
    const targets = new Map(scene.map(target => [target.id, target]));
    const linked = new Set(rigs.armatures.flatMap(rig => [...rig.bindings.map(binding => binding.pathId), ...(rig.attachments ?? []).map(link => link.elementId)]));
    for(const id of linked) {
        const seen = new Set<string>();
        for(let parent = targets.get(id)?.parentId; parent && !seen.has(parent); parent = targets.get(parent)?.parentId) {
            if(linked.has(parent)) return 'Rig bindings overlap an ancestor and its descendant. Remove one of the links before export.';
            seen.add(parent);
        }
    }
    for(const rig of rigs.armatures) {
        if(targets.has(rig.id)) return `Armature “${rig.id}” shares an artwork ID.`;
        for(const binding of rig.bindings) {
            const target = targets.get(binding.pathId);
            if(!target?.path) return `Bound path “${binding.pathId}” is missing.`;
            const topology = JSON.stringify(target.path.contours.map(contour => [contour.id, contour.closed, contour.lines.map(line => [line.id, line.type, line.points.map(point => point.id), line.controlStart?.id, line.controlEnd?.id])]));
            if(topology !== binding.topology) return `Bound path “${binding.pathId}” has changed topology. Rebind this artwork before export.`;
            const points = new Set(target.path.contours.flatMap(contour => contour.lines.flatMap(line => [line.points[0].id, line.points[1].id, line.controlStart?.id, line.controlEnd?.id].filter((id): id is string => !!id))));
            if(binding.points.some(point => !points.has(point.id)) || [...points].some(id => !binding.points.some(point => point.id === id))) return `Bound path “${binding.pathId}” has changed points. Rebind this artwork before export.`;
        }
        if(rig.attachments?.some(link => !targets.has(link.elementId))) return `Attached artwork in “${rig.name}” is missing.`;
        try { attachmentTransforms(evaluateRigConstraints({ ...rig, constraintsActive: true })); }
        catch(error) { return error instanceof Error ? error.message : 'Rig constraints cannot evaluate.'; }
    }
    return rigSceneBaseProblem(rigs, scene);
}

export function validateRuntimeRigs(bundle: RuntimeBundleV1): void {
    const fail = (message: string): never => { throw new RuntimePlayerError('invalid-bundle', message); };
    if(bundle.rigs !== undefined) {
        if(!bundle.requiredCapabilities.includes('rig.pose-v1')) fail('Rig data requires rig.pose-v1.');
        const problem = rigSceneProblem(bundle.rigs, bundle.artwork.targets);
        if(problem) fail(problem);
    }
    for(const track of bundle.animation.tracks) {
        const targetId = bundle.animation.targets[track.target], property = bundle.animation.properties[track.property];
        const channel = parseRigAnimationProperty(property);
        const rig = bundle.rigs?.armatures.find(rig => rig.id === targetId);
        if(channel || rig) {
            if(!channel || !rig?.bones.some(bone => bone.id === channel.boneId) || track.kind !== 'number') fail(`Rig channel “${targetId}/${property}” has an invalid target or property.`);
        }
        const conflict = rigChannelConflict(bundle.rigs, bundle.artwork.targets, { targetId, property });
        if(conflict) fail(conflict);
    }
}
