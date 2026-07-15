import { canvasToWorkspaceProjection } from "./canvas-workspace-projection";
import { applyMatrix } from "./objects/transform.object";

describe("canvas-to-workspace projection", () => {
    it("projects a panned and zoomed canvas into workspace-local pixels", () => {
        const projection = canvasToWorkspaceProjection(
            { left: 230, top: 140, width: 800, height: 600 },
            { left: 30, top: 40, width: 1200, height: 900 },
            { x: 0, y: 0, width: 400, height: 300 },
        );

        expect(projection.canvasFrame).toEqual({ x: 200, y: 100, width: 800, height: 600 });
        expect(applyMatrix(projection.canvasToWorkspace, 0, 0)).toEqual({ x: 200, y: 100 });
        expect(applyMatrix(projection.canvasToWorkspace, 400, 300)).toEqual({ x: 1000, y: 700 });
    });

    it("uses the rendered bounds after a workspace or canvas resize", () => {
        const before = canvasToWorkspaceProjection(
            { left: 100, top: 80, width: 200, height: 100 },
            { left: 20, top: 30, width: 600, height: 400 },
            { x: 0, y: 0, width: 200, height: 100 },
        );
        const after = canvasToWorkspaceProjection(
            { left: 170, top: 120, width: 300, height: 150 },
            { left: 50, top: 60, width: 900, height: 600 },
            { x: 0, y: 0, width: 200, height: 100 },
        );

        expect(applyMatrix(before.canvasToWorkspace, 40, 20)).toEqual({ x: 120, y: 70 });
        expect(applyMatrix(after.canvasToWorkspace, 40, 20)).toEqual({ x: 180, y: 90 });
    });

    it("round-trips non-origin canvas coordinates", () => {
        const projection = canvasToWorkspaceProjection(
            { left: 75, top: 95, width: 400, height: 200 },
            { left: 25, top: 35, width: 800, height: 600 },
            { x: -100, y: 50, width: 200, height: 100 },
        );
        const workspacePoint = applyMatrix(projection.canvasToWorkspace, -25, 80);
        const canvasPoint = applyMatrix(projection.workspaceToCanvas, workspacePoint.x, workspacePoint.y);

        expect(workspacePoint).toEqual({ x: 200, y: 120 });
        expect(canvasPoint.x).toBeCloseTo(-25, 8);
        expect(canvasPoint.y).toBeCloseTo(80, 8);
    });
});
