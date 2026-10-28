import { boneLocalMatrix, boneMatrices } from './armature';
import { rigMotionOrder } from './motion-plan';
import { applyMatrix, identityMatrix, multiplyMatrix } from './transform';
export function springBoneSettings(spring, id) { return spring.boneSettings?.[id] ?? spring; }
export function springConstraintsProblem(rig) {
    if (rig.springs === undefined)
        return;
    if (!Array.isArray(rig.springs))
        return 'Spring constraints must be a list.';
    const ids = new Set(), owners = new Set();
    const chains = [];
    try {
        for (const spring of rig.springs) {
            if (!spring || typeof spring.id !== 'string' || !spring.id || ids.has(spring.id) || typeof spring.name !== 'string' || typeof spring.enabled !== 'boolean')
                return 'Invalid spring constraint.';
            ids.add(spring.id);
            validateSpringSettings(spring);
            const chain = springChain(spring.enabled ? rig : { ...rig, constraints: [] }, spring.rootBoneId, spring.endBoneId);
            chains.push({ constraint: spring, ids: chain });
            if (spring.boneSettings !== undefined) {
                if (!spring.boneSettings || typeof spring.boneSettings !== 'object' || Array.isArray(spring.boneSettings))
                    return 'Invalid per-bone spring settings.';
                for (const [id, settings] of Object.entries(spring.boneSettings)) {
                    if (!chain.includes(id))
                        return 'Spring settings reference a bone outside the range.';
                    validateSpringSettings(settings);
                }
            }
            for (const id of chain) {
                if (owners.has(id))
                    return 'Spring chains cannot overlap.';
                owners.add(id);
            }
        }
        rigMotionOrder(rig, chains);
    }
    catch (error) {
        return error.message;
    }
    return;
}
export const DEFAULT_SPRING_SETTINGS = { stiffness: 80, damping: 8, gravity: 4, limit: 75, mix: 1, windInfluence: 1 };
export const SPRING_STEP = 1 / 120;
export const SPRING_LIMITS = {
    stiffness: [0, 400], damping: [0, 40], gravity: [-20, 20], limit: [0, 180], mix: [0, 1], windInfluence: [0, 10],
};
export function validateSpringSettings(settings) {
    for (const key of Object.keys(SPRING_LIMITS)) {
        const [min, max] = SPRING_LIMITS[key];
        const value = settings[key] ?? (key === 'windInfluence' ? 1 : NaN);
        if (!Number.isFinite(value) || value < min || value > max)
            throw new Error(`Invalid spring ${key}.`);
    }
}
/** Explicit ranges follow ancestry from the inclusive end to the start. Branches
 * and point controls outside that path remain ordinary children. Legacy records
 * without an endpoint retain their original whole-strand interpretation. */
export function springChain(rig, firstId, endId) {
    boneMatrices(rig);
    const bones = new Map(rig.bones.map(bone => [bone.id, bone]));
    let ids = [];
    if (endId !== undefined) {
        if (typeof endId !== 'string' || !bones.has(endId))
            throw new Error('Choose a valid end bone for the physics range.');
        let bone = bones.get(endId);
        while (bone) {
            ids.unshift(bone.id);
            if (bone.id === firstId)
                break;
            bone = bone.parentId ? bones.get(bone.parentId) : undefined;
        }
        if (ids[0] !== firstId)
            throw new Error('The end bone must descend from the start bone.');
    }
    else {
        let bone = bones.get(firstId);
        if (!bone)
            throw new Error('Select the first bone of a strand.');
        while (bone) {
            ids.push(bone.id);
            const children = rig.bones.filter(item => item.parentId === bone.id);
            if (children.length > 1)
                throw new Error('Choose an explicit end bone; legacy spring chains must be unbranched.');
            bone = children[0];
        }
    }
    if (ids.length > 32)
        throw new Error('Use a spring range of at most 32 bones.');
    for (const id of ids) {
        const bone = bones.get(id);
        if (bone.kind === 'point' || !Number.isFinite(bone.length) || bone.length <= 0)
            throw new Error('Spring ranges need bones with a positive length. Point controls can be children outside the range.');
    }
    for (const constraint of rig.constraints ?? []) {
        if (constraint.enabled && [constraint.upperBoneId, constraint.lowerBoneId].some(id => ids.includes(id))) {
            throw new Error('Physics bones cannot also be driven by IK. A child point can drive a separate IK chain.');
        }
    }
    return ids;
}
const radians = Math.PI / 180;
const angleDifference = (angle) => ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
/** World-space tip inertia with fixed-length links and local angular springs.
 * The owner supplies authored FK/IK poses at exact fixed simulation steps. It owns
 * replay/reset; this workspace never mutates authored bones or retains their references.
 */
export class SpringChainSimulation {
    constructor(ids, settings, boneSettings = {}) {
        this.ids = ids;
        this.settings = settings;
        this.boneSettings = boneSettings;
        this.tips = new Map();
        validateSpringSettings(settings);
        this.settings = { ...settings };
        this.boneSettings = structuredClone(boneSettings);
        Object.values(this.boneSettings).forEach(validateSpringSettings);
    }
    reset() { this.tips.clear(); }
    snapshot() { return [...this.tips].map(([id, tip]) => [id, { ...tip }]); }
    restore(snapshot) {
        this.tips.clear();
        for (const [id, tip] of snapshot)
            this.tips.set(id, { ...tip });
    }
    step(authored) {
        const matrices = boneMatrices(authored), bones = new Map(authored.bones.map(bone => [bone.id, bone]));
        const output = new Map();
        const dt2 = SPRING_STEP ** 2;
        for (const id of this.ids) {
            const settings = this.boneSettings[id] ?? this.settings;
            const decay = Math.exp(-settings.damping * SPRING_STEP);
            const wind = settings.windInfluence ?? 1;
            const bone = bones.get(id);
            if (!bone || bone.length <= 0)
                throw new Error('Spring chain setup changed.');
            const parent = bone.parentId ? matrices.get(bone.parentId) : identityMatrix();
            const target = multiplyMatrix(parent, boneLocalMatrix(bone));
            const origin = applyMatrix(target, 0, 0), tip = applyMatrix(target, bone.length, 0);
            const targetAngle = Math.atan2(target.b, target.a);
            let state = this.tips.get(id), offset = 0;
            if (!state) {
                state = { ...tip, previousX: tip.x, previousY: tip.y };
                this.tips.set(id, state);
            }
            else {
                const x = state.x + (state.x - state.previousX) * decay + (tip.x - state.x) * settings.stiffness * dt2 + bone.length * (authored.windX ?? 0) * wind * dt2;
                const y = state.y + (state.y - state.previousY) * decay + (tip.y - state.y) * settings.stiffness * dt2 + bone.length * (settings.gravity + (authored.windY ?? 0) * wind) * dt2;
                const raw = angleDifference(Math.atan2(y - origin.y, x - origin.x) - targetAngle);
                const limit = settings.limit * radians;
                offset = Math.max(-limit, Math.min(limit, raw));
                const nextX = origin.x + Math.cos(targetAngle + offset) * bone.length;
                const nextY = origin.y + Math.sin(targetAngle + offset) * bone.length;
                // Stop outward velocity at a limit instead of accumulating energy against it.
                state.previousX = raw === offset ? state.x : nextX;
                state.previousY = raw === offset ? state.y : nextY;
                state.x = nextX;
                state.y = nextY;
            }
            const simulated = bone.pose + offset / radians;
            if (!Number.isFinite(simulated))
                throw new Error('Spring motion exceeded the supported coordinate range.');
            output.set(id, bone.pose + offset / radians * settings.mix);
            matrices.set(id, multiplyMatrix(parent, boneLocalMatrix({ ...bone, pose: output.get(id) })));
        }
        return output;
    }
}
//# sourceMappingURL=spring-chain.js.map