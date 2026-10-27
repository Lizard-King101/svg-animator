import { Armature } from './armature';
import { TransformState } from './transform';
/** Internal, revision-scoped rig workspace. Results are borrowed until the next evaluate.
 * Setup is immutable for this plan's lifetime; owners replace it on structural/weight edits.
 * Only authored pose channels are read on each evaluation, never the previous solved pose.
 */
export declare class RigEvaluationPlan {
    readonly pose: Armature;
    readonly paths: Map<string, Map<string, {
        x: number;
        y: number;
    }>>;
    readonly transforms: Map<string, TransformState>;
    private readonly bones;
    private readonly order;
    private readonly matrices;
    private readonly skin;
    private readonly restInverse;
    private readonly constraints;
    private readonly bindings;
    private readonly attachments;
    constructor(source: Armature);
    evaluate(source: Armature, constraintsActive?: boolean): this;
    private updateMatrices;
}
//# sourceMappingURL=evaluation-plan.d.ts.map