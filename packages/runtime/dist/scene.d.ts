import { RuntimeSceneTargetV1 } from "./contracts";
export declare class RuntimeScene {
    private readonly root;
    readonly targets: RuntimeSceneTargetV1[];
    private readonly targetById;
    private readonly nodeById;
    constructor(root: SVGSVGElement, sourceTargets: RuntimeSceneTargetV1[]);
    write(targetId: string, property: string, value: unknown): boolean;
    render(): void;
    clear(): void;
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
    private node;
}
//# sourceMappingURL=scene.d.ts.map