import { applyMatrix, identityMatrix, invertMatrix, Matrix, multiplyMatrix, rotationMatrix, translationMatrix, TransformState } from './transform';
import { constraintPlan } from './constraint-plan';

/** Rest joints are parent-local; pose angles are offsets from rest, in degrees. */
export interface Bone { kind?: 'bone' | 'point'; id: string; name: string; parentId: string | null; x: number; y: number; angle: number; length: number; pose: number; poseX?: number; poseY?: number; }
export interface BoneWeight { boneId: string; weight: number; }
export interface WeightPointRef { pathId: string; pointId: string; }
export interface BoundPoint { id: string; anchorId: string; x: number; y: number; weights: BoneWeight[]; independent?: boolean; weightSource?: WeightPointRef; lockedBoneIds?: string[]; }
export interface PathBinding { pathId: string; scopeId?: string; matrix: Matrix; topology: string; boneIds?: string[]; points: BoundPoint[]; }
export interface RigidAttachment { elementId: string; boneId: string; parentMatrix: Matrix; worldMatrix: Matrix; restTransform: TransformState; }
export interface TwoBoneIKConstraint { id: string; name: string; type: 'two-bone-ik'; enabled: boolean; upperBoneId: string; lowerBoneId: string; targetBoneId: string; bend: 1 | -1; }
export interface Armature { attachments?: RigidAttachment[]; constraints?: TwoBoneIKConstraint[]; constraintsActive?: boolean; id: string; name: string; bones: Bone[]; bindings: PathBinding[]; }
export interface RigDocument { version: 1 | 2 | 3 | 4 | 5; armatures: Armature[]; }

/** Drawing may leave subpixel joint differences; IK requires the same connected joint. */
export function isConnectedBoneJoint(upper: Bone, lower: Bone): boolean {
    return Math.abs(lower.x + (lower.poseX ?? 0) - upper.length) <= .05 && Math.abs(lower.y + (lower.poseY ?? 0)) <= .05;
}

export function boneMatrices(rig: Armature, posed = true): Map<string, Matrix> {
    const result = new Map<string, Matrix>(), visiting = new Set<string>();
    const visit = (bone: Bone): Matrix => {
        const known = result.get(bone.id); if(known) return known;
        if(visiting.has(bone.id)) throw new Error('Bone parenting contains a cycle.');
        visiting.add(bone.id);
        const parent = rig.bones.find(candidate => candidate.id === bone.parentId);
        if(bone.parentId && !parent) throw new Error('Bone parent is missing.');
        const local = multiplyMatrix(translationMatrix(bone.x + (posed ? bone.poseX ?? 0 : 0), bone.y + (posed ? bone.poseY ?? 0 : 0)), rotationMatrix((bone.angle % 360) + (posed ? bone.pose % 360 : 0)));
        const matrix = multiplyMatrix(parent ? visit(parent) : identityMatrix(), local);
        if(!Object.values(matrix).every(Number.isFinite)) throw new Error('Bone transform exceeds the supported numeric range.');
        visiting.delete(bone.id); result.set(bone.id, matrix); return matrix;
    };
    rig.bones.forEach(visit); return result;
}

export function normalizeWeights(weights: readonly BoneWeight[]): BoneWeight[] {
    const merged = new Map<string, number>();
    for(const entry of weights) {
        if(!Number.isFinite(entry.weight) || entry.weight < 0) throw new Error('Weights must be finite and nonnegative.');
        if(entry.weight > 0) merged.set(entry.boneId, (merged.get(entry.boneId) ?? 0) + entry.weight);
    }
    const total = [...merged.values()].reduce((sum, weight) => sum + weight, 0);
    if(!Number.isFinite(total)) throw new Error('Weight total is too large.');
    return [...merged].map(([boneId, weight]) => ({ boneId, weight: weight / total }));
}

/** Preserve the other influences' relative proportions when changing one normalized weight. */
export function weightsWithInfluence(weights: readonly BoneWeight[], boneId: string, value: number): BoneWeight[] {
    if(!Number.isFinite(value) || value < 0 || value > 1) throw new Error('An influence must be between zero and one.');
    if((weights.find(entry => entry.boneId === boneId)?.weight ?? 0) === value) return weights.map(entry => ({ ...entry }));
    const others = normalizeWeights(weights.filter(entry => entry.boneId !== boneId));
    return normalizeWeights([...others.map(entry => ({ ...entry, weight: entry.weight * (1 - value) })), { boneId, weight: value }]);
}

/** Geometry ownership (anchorId) is independent from weight ownership. */
export function weightOwner(rig: Armature, pathId: string, pointId: string): WeightPointRef {
    const visiting = new Set<string>();
    while(true) {
        const key = JSON.stringify([pathId, pointId]);
        if(visiting.has(key)) throw new Error('Point weight links contain a cycle.');
        visiting.add(key);
        const point = rig.bindings.find(binding => binding.pathId === pathId)?.points.find(point => point.id === pointId);
        if(!point) throw new Error('A point weight source is missing.');
        if(point.id !== point.anchorId && !point.independent) { pointId = point.anchorId; continue; }
        if(point.weightSource) { pathId = point.weightSource.pathId; pointId = point.weightSource.pointId; continue; }
        return { pathId, pointId };
    }
}

export function effectivePointWeights(rig: Armature, binding: PathBinding, point: BoundPoint): BoneWeight[] {
    const owner = weightOwner(rig, binding.pathId, point.id);
    return rig.bindings.find(binding => binding.pathId === owner.pathId)!.points.find(point => point.id === owner.pointId)!.weights;
}

/** Locks follow the same canonical owner as weights, including inherited handles. */
export function weightOwnerLocks(rig: Armature, ref: WeightPointRef): string[] {
    const owner = weightOwner(rig, ref.pathId, ref.pointId);
    return rig.bindings.find(binding => binding.pathId === owner.pathId)!.points.find(point => point.id === owner.pointId)!.lockedBoneIds ?? [];
}

/** Empty independent weights leave a point at rest; legacy handles inherit their anchor. */
export function deformBinding(rig: Armature, binding: PathBinding): Map<string, { x: number; y: number }> {
    const rest = boneMatrices(rig, false), pose = boneMatrices(rig), inverse = invertMatrix(binding.matrix);
    const transforms = new Map(rig.bones.map(bone => [bone.id, multiplyMatrix(pose.get(bone.id)!, invertMatrix(rest.get(bone.id)!))]));
    return new Map(binding.points.map(point => {
        const weights = effectivePointWeights(rig, binding, point);
        if(!weights.length) return [point.id, { x: point.x, y: point.y }];
        const world = applyMatrix(binding.matrix, point.x, point.y);
        let x = 0, y = 0;
        for(const entry of weights) {
            const matrix = transforms.get(entry.boneId);
            if(!matrix) throw new Error('A weighted bone is missing.');
            const transformed = applyMatrix(matrix, world.x, world.y);
            x += transformed.x * entry.weight; y += transformed.y * entry.weight;
        }
        return [point.id, applyMatrix(inverse, x, y)];
    }));
}

export function validRigs(value: unknown): value is RigDocument {
    if(!record(value) || ![1, 2, 3, 4, 5].includes(value.version) || !Array.isArray(value.armatures)) return false;
    const rigIds = new Set<string>(), paths = new Set<string>();
    for(const rig of value.armatures) {
        if(!record(rig) || !id(rig.id) || rigIds.has(rig.id) || typeof rig.name !== 'string' || !Array.isArray(rig.bones) || !Array.isArray(rig.bindings)) return false;
        rigIds.add(rig.id);
        const bones = new Set<string>();
        for(const bone of rig.bones) {
            if(!record(bone) || !id(bone.id) || bones.has(bone.id) || typeof bone.name !== 'string' || !(bone.parentId === null || id(bone.parentId)) || ![bone.x, bone.y, bone.angle, bone.length, bone.pose].every(finite) || (bone.kind === 'point' ? bone.length !== 0 : bone.length <= 0) || (bone.kind !== undefined && bone.kind !== 'point' && bone.kind !== 'bone')) return false;
            if([bone.poseX, bone.poseY].some(value => value !== undefined && !finite(value))) return false;
            bones.add(bone.id);
        }
        try { boneMatrices(rig as unknown as Armature); } catch { return false; }
        if(rig.constraintsActive !== undefined && typeof rig.constraintsActive !== 'boolean') return false;
        if(constraintPlan(rig as unknown as Armature).problem) return false;
        if(rig.constraintsActive !== false && rig.constraints?.some((constraint: TwoBoneIKConstraint) => constraint.enabled
            && !isConnectedBoneJoint(rig.bones.find((bone: Bone) => bone.id === constraint.upperBoneId)!, rig.bones.find((bone: Bone) => bone.id === constraint.lowerBoneId)!))) return false;
        if(rig.attachments !== undefined && !Array.isArray(rig.attachments)) return false;
        for(const attachment of rig.attachments ?? []) {
            if(!record(attachment) || !id(attachment.elementId) || paths.has(attachment.elementId) || !bones.has(attachment.boneId) || !validMatrix(attachment.parentMatrix) || !validMatrix(attachment.worldMatrix) || !record(attachment.restTransform) || !['translateX','translateY','rotation','scaleX','scaleY'].every(key => finite(attachment.restTransform[key])) || ['originX','originY'].some(key => attachment.restTransform[key] !== undefined && !finite(attachment.restTransform[key]))) return false;
            paths.add(attachment.elementId);
        }
        for(const binding of rig.bindings) {
            if(!record(binding) || !id(binding.pathId) || paths.has(binding.pathId) || !record(binding.matrix) || !['a','b','c','d','e','f'].every(key => finite(binding.matrix[key])) || Math.abs(binding.matrix.a * binding.matrix.d - binding.matrix.b * binding.matrix.c) < .000001 || typeof binding.topology !== 'string' || !Array.isArray(binding.points)) return false;
            if(binding.scopeId !== undefined && !id(binding.scopeId)) return false;
            if(binding.boneIds !== undefined && (!Array.isArray(binding.boneIds) || !binding.boneIds.length || new Set(binding.boneIds).size !== binding.boneIds.length || binding.boneIds.some((id: string) => !bones.has(id)))) return false;
            paths.add(binding.pathId);
            const points = new Set<string>();
            for(const point of binding.points) {
                if(!record(point) || !id(point.id) || points.has(point.id) || !id(point.anchorId) || !finite(point.x) || !finite(point.y) || !Array.isArray(point.weights)) return false;
                points.add(point.id);
                const influences = new Set<string>(); let sum = 0;
                for(const entry of point.weights) {
                    if(!record(entry) || !bones.has(entry.boneId) || (binding.boneIds && !binding.boneIds.includes(entry.boneId)) || influences.has(entry.boneId) || !finite(entry.weight) || entry.weight <= 0) return false;
                    influences.add(entry.boneId); sum += entry.weight;
                }
                if(point.weights.length && Math.abs(sum - 1) > .000001) return false;
                if(point.independent !== undefined && (typeof point.independent !== 'boolean' || point.id === point.anchorId)) return false;
                if(point.weightSource !== undefined && (!record(point.weightSource) || !id(point.weightSource.pathId) || !id(point.weightSource.pointId))) return false;
                if(point.weightSource && point.weights.length) return false;
                if(point.id !== point.anchorId && !point.independent && (point.weights.length || point.weightSource)) return false;
                if(point.lockedBoneIds !== undefined && (value.version < 5 || !Array.isArray(point.lockedBoneIds)
                    || new Set(point.lockedBoneIds).size !== point.lockedBoneIds.length
                    || point.lockedBoneIds.some((boneId: string) => !bones.has(boneId) || (binding.boneIds && !binding.boneIds.includes(boneId)))
                    || point.weightSource || (point.id !== point.anchorId && !point.independent))) return false;
            }
            if(binding.points.some((point: BoundPoint) => !binding.points.some((anchor: BoundPoint) => anchor.id === point.anchorId && anchor.id === anchor.anchorId))) return false;
        }
        // Explicit links name a canonical owner in this rig; inherited handles cannot own a link.
        for(const binding of rig.bindings as PathBinding[]) for(const point of binding.points) {
            try {
                if(point.weightSource) {
                    const source = rig.bindings.find((binding: PathBinding) => binding.pathId === point.weightSource!.pathId)?.points.find((candidate: BoundPoint) => candidate.id === point.weightSource!.pointId);
                    if(!source || source.weightSource || (source.id !== source.anchorId && !source.independent)) return false;
                }
                const weights = effectivePointWeights(rig as Armature, binding, point);
                if(binding.boneIds && weights.some(entry => !binding.boneIds!.includes(entry.boneId))) return false;
                if(binding.boneIds && weightOwnerLocks(rig as Armature, { pathId: binding.pathId, pointId: point.id }).some(boneId => !binding.boneIds!.includes(boneId))) return false;
            } catch { return false; }
        }
    }
    return true;
}
function record(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function id(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

function validMatrix(value: unknown): value is Matrix { return record(value) && ['a','b','c','d','e','f'].every(key => finite(value[key])) && Number.isFinite(value.a * value.d - value.b * value.c) && Math.abs(value.a * value.d - value.b * value.c) >= .000001; }

export function hasBonePose(bone: Bone): boolean { return bone.pose !== 0 || !!bone.poseX || !!bone.poseY; }
