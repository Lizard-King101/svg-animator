import type { RuntimeBundleV1, RuntimeSceneTargetV1 } from '../contracts';
import { RigDocument } from './armature';
export interface RigSceneNode {
    id: string;
    parentId: string | null;
}
/** Rig output owns geometry and the captured parent space; paint/visibility may animate independently. */
export declare function rigChannelConflict(rigs: RigDocument | undefined, scene: readonly RigSceneNode[], channel: {
    targetId: string;
    property: string;
}): string | undefined;
/** The exported base artwork must still match its captured binding, before animation resumes IK. */
export declare function rigSceneBaseProblem(rigs: RigDocument, scene: readonly RuntimeSceneTargetV1[]): string | undefined;
/** Validate linked scene references before a frame can mutate any SVG nodes. */
export declare function rigSceneProblem(rigs: RigDocument, scene: readonly RuntimeSceneTargetV1[]): string | undefined;
export declare function validateRuntimeRigs(bundle: RuntimeBundleV1): void;
//# sourceMappingURL=runtime-rigs.d.ts.map