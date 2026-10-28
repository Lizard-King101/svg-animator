import { Armature } from './armature';
/** Persisted settings; simulation buffers remain transient. */
export interface SpringSettings {
    stiffness: number;
    damping: number;
    gravity: number;
    limit: number;
    mix: number;
    windInfluence?: number;
}
export interface SpringConstraint extends SpringSettings {
    id: string;
    name: string;
    enabled: boolean;
    rootBoneId: string;
    /** Inclusive endpoint. Omitted only by older whole-strand constraints. */
    endBoneId?: string;
    /** Full per-bone overrides; missing entries inherit the constraint defaults. */
    boneSettings?: Record<string, SpringSettings>;
}
export declare function springBoneSettings(spring: SpringConstraint, id: string): SpringSettings;
export declare function springConstraintsProblem(rig: Armature): string | undefined;
export declare const DEFAULT_SPRING_SETTINGS: Readonly<SpringSettings>;
export declare const SPRING_STEP: number;
export declare const SPRING_LIMITS: Readonly<Record<keyof SpringSettings, readonly [number, number]>>;
export declare function validateSpringSettings(settings: SpringSettings): void;
/** Explicit ranges follow ancestry from the inclusive end to the start. Branches
 * and point controls outside that path remain ordinary children. Legacy records
 * without an endpoint retain their original whole-strand interpretation. */
export declare function springChain(rig: Armature, firstId: string, endId?: string): string[];
/** World-space tip inertia with fixed-length links and local angular springs.
 * The owner supplies authored FK/IK poses at exact fixed simulation steps. It owns
 * replay/reset; this workspace never mutates authored bones or retains their references.
 */
export declare class SpringChainSimulation {
    readonly ids: readonly string[];
    private readonly settings;
    private readonly boneSettings;
    private readonly tips;
    constructor(ids: readonly string[], settings: SpringSettings, boneSettings?: Record<string, SpringSettings>);
    reset(): void;
    snapshot(): (readonly [string, {
        readonly x: number;
        readonly y: number;
        readonly previousX: number;
        readonly previousY: number;
    }])[];
    restore(snapshot: ReturnType<SpringChainSimulation['snapshot']>): void;
    step(authored: Armature): Map<string, number>;
}
//# sourceMappingURL=spring-chain.d.ts.map