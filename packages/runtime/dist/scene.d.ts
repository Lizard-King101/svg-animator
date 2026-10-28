import { RuntimeSceneTargetV1 } from "./contracts";
import { RigDocument } from './rig/armature';
import { RuntimeBundleV1 } from './contracts';
import { PhysicsLoop } from './rig/physics';
export declare class RuntimeScene {
    private readonly root;
    readonly targets: RuntimeSceneTargetV1[];
    private readonly targetById;
    private readonly targetNodesById;
    private readonly rigs?;
    private readonly rigPlans;
    private readonly physicsPlans;
    constructor(root: SVGSVGElement, sourceTargets: RuntimeSceneTargetV1[], rigs?: RigDocument, animation?: RuntimeBundleV1['animation']);
    write(targetId: string, property: string, value: unknown): boolean;
    render(time?: number, loop?: PhysicsLoop): void;
    clear(): void;
    /** Recompute from captured rest points on every seek; solved FK never replaces authored channels. */
    resetPhysics(): void;
    private applyRigs;
    private writeGeometryPosition;
    private writeGeometrySize;
    /** Mirrors the editor's native-geometry mutation contract for pinned origins and user-space paints. */
    private transformAttachedGeometry;
    private writePathPoint;
    private writeSolidPaint;
    private writeGradient;
    private renderGeometry;
    private renderAppearance;
    private renderGradients;
    private roleNodes;
    private motionAdjustedMatrix;
    private sampleMotion;
    private combinedMatrix;
    private parentMatrix;
    private chain;
    private ownMatrix;
    private nodes;
}
//# sourceMappingURL=scene.d.ts.map