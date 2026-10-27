import { boneLocalMatrix, boneMatrices, effectivePointWeights, hasBonePose } from './armature';
import { constraintPlan } from './constraint-plan';
import { solveTwoBoneIKInto } from './two-bone-ik';
import { applyMatrix, decomposeTransform, identityMatrix, invertMatrix, multiplyMatrix } from './transform';
/** Internal, revision-scoped rig workspace. Results are borrowed until the next evaluate.
 * Setup is immutable for this plan's lifetime; owners replace it on structural/weight edits.
 * Only authored pose channels are read on each evaluation, never the previous solved pose.
 */
export class RigEvaluationPlan {
    constructor(source) {
        this.paths = new Map();
        this.transforms = new Map();
        this.order = [];
        this.matrices = new Map();
        this.skin = new Map();
        const plan = constraintPlan(source);
        if (plan.problem)
            throw new Error(plan.problem);
        // Clone once, including setup: no caller mutation can contaminate workspace results.
        this.pose = structuredClone(source);
        this.bones = new Map(this.pose.bones.map(bone => [bone.id, bone]));
        const rest = boneMatrices(this.pose, false);
        this.restInverse = new Map([...rest].map(([id, matrix]) => [id, invertMatrix(matrix)]));
        // boneMatrices visits parents first and validates missing/cyclic parents.
        this.order = [...rest.keys()].map(id => this.bones.get(id));
        this.constraints = plan.ordered.map(constraint => ({ ...constraint,
            upper: this.bones.get(constraint.upperBoneId), lower: this.bones.get(constraint.lowerBoneId),
        }));
        this.bindings = this.pose.bindings.map(binding => {
            const output = new Map();
            this.paths.set(binding.pathId, output);
            return { inverse: invertMatrix(binding.matrix), points: binding.points.map(point => {
                    const value = { x: point.x, y: point.y };
                    output.set(point.id, value);
                    return { value, rest: { x: point.x, y: point.y }, world: applyMatrix(binding.matrix, point.x, point.y),
                        weights: effectivePointWeights(this.pose, binding, point) };
                }) };
        });
        this.attachments = (this.pose.attachments ?? []).map(link => ({ ...link, inverse: invertMatrix(link.parentMatrix) }));
    }
    evaluate(source, constraintsActive = source.constraintsActive !== false) {
        for (const bone of source.bones) {
            const output = this.bones.get(bone.id);
            if (!output)
                throw new Error('Rig setup changed; rebuild its evaluation plan.');
            output.pose = bone.pose;
            output.poseX = bone.poseX;
            output.poseY = bone.poseY;
        }
        this.pose.constraintsActive = constraintsActive;
        this.updateMatrices();
        if (constraintsActive)
            for (const constraint of this.constraints) {
                const target = applyMatrix(this.matrices.get(constraint.targetBoneId), 0, 0);
                if (!solveTwoBoneIKInto(constraint.upper, constraint.lower, this.matrices, target, constraint.bend)) {
                    throw new Error(`${constraint.name}: this two-bone chain cannot reach a valid pose. Use Reconnect joint in Bone setup before posing.`);
                }
                this.updateMatrices(new Set([constraint.upper.id, constraint.lower.id]));
            }
        for (const bone of this.order)
            this.skin.set(bone.id, multiplyMatrix(this.matrices.get(bone.id), this.restInverse.get(bone.id)));
        for (const binding of this.bindings)
            for (const point of binding.points) {
                if (!point.weights.length) {
                    Object.assign(point.value, point.rest);
                    continue;
                }
                let x = 0, y = 0;
                for (const weight of point.weights) {
                    const matrix = this.skin.get(weight.boneId);
                    if (!matrix)
                        throw new Error('A weighted bone is missing.');
                    x += (matrix.a * point.world.x + matrix.c * point.world.y + matrix.e) * weight.weight;
                    y += (matrix.b * point.world.x + matrix.d * point.world.y + matrix.f) * weight.weight;
                }
                Object.assign(point.value, applyMatrix(binding.inverse, x, y));
                if (!Number.isFinite(point.value.x) || !Number.isFinite(point.value.y))
                    throw new Error('This pose exceeds the supported coordinate range.');
            }
        const posed = this.pose.bones.some(hasBonePose);
        for (const link of this.attachments) {
            const transform = posed ? decomposeTransform(multiplyMatrix(link.inverse, multiplyMatrix(this.skin.get(link.boneId), link.worldMatrix))) : { ...link.restTransform };
            if (!transform)
                throw new Error('This pose would introduce skew under a scaled parent. Use a uniformly scaled parent for rigid attachments, or bind path points instead.');
            this.transforms.set(link.elementId, transform);
        }
        return this;
    }
    updateMatrices(changed) {
        for (const bone of this.order) {
            if (changed && !changed.has(bone.id) && !(bone.parentId && changed.has(bone.parentId)))
                continue;
            changed?.add(bone.id);
            const matrix = multiplyMatrix(bone.parentId ? this.matrices.get(bone.parentId) : identityMatrix(), boneLocalMatrix(bone));
            if (!Object.values(matrix).every(Number.isFinite))
                throw new Error('Bone transform exceeds the supported numeric range.');
            this.matrices.set(bone.id, matrix);
        }
    }
}
//# sourceMappingURL=evaluation-plan.js.map