import { Armature } from './armature';
import { RigEvaluationPlan } from './evaluation-plan';
export interface PhysicsLoop {
    start: number;
    end: number;
}
export declare function physicsSampleTime(time: number, loop?: PhysicsLoop): number;
export declare const hasPhysics: (rig: Armature) => boolean;
/** One fixed-step workspace shared by timeline replay and interactive posing. */
export declare class RigSpringSimulation {
    private readonly skeleton;
    private readonly chains;
    private readonly order;
    constructor(source: Armature);
    reset(): void;
    snapshot(): {
        id: string;
        state: (readonly [string, {
            readonly x: number;
            readonly y: number;
            readonly previousX: number;
            readonly previousY: number;
        }])[];
    }[];
    restore(snapshot: ReturnType<RigSpringSimulation['snapshot']>): void;
    private solve;
    step(source: Armature): Map<string, number>;
    /** Project interpolated spring offsets and solve downstream IK at display time. */
    pose(source: Armature, offsets: ReadonlyMap<string, number>): Armature;
}
/** Lazy fixed-step evaluation with bounded checkpoints. Same timeline time yields
 * the same pose regardless of refresh cadence or seek order. Forward loops use a
 * monotonically increasing clock and wrap only the authored input, retaining inertia.
 */
export declare class RigPhysicsPlan {
    private readonly sample;
    readonly output: RigEvaluationPlan;
    private readonly simulation;
    private stepIndex;
    private previous;
    private current;
    private loopKey;
    private checkpoints;
    constructor(source: Armature, sample: (time: number) => Armature);
    reset(): void;
    evaluate(time: number, loop?: PhysicsLoop): RigEvaluationPlan;
}
/** Interactive Pose input is deliberately history-dependent, unlike a timeline seek. */
export declare class RigLivePhysics {
    private readonly simulation;
    readonly output: RigEvaluationPlan;
    private accumulated;
    private offsets;
    private previous;
    constructor(source: Armature);
    advance(source: Armature, seconds: number): RigEvaluationPlan;
    /** Pointer previews use the current simulation state without advancing its clock. */
    preview(source: Armature): RigEvaluationPlan;
}
//# sourceMappingURL=physics.d.ts.map