import { Bounds, Matrix, invertMatrix } from "./objects/transform.object";

export interface RectLike {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface CanvasWorkspaceProjection {
    canvasFrame: Bounds;
    canvasToWorkspace: Matrix;
    workspaceToCanvas: Matrix;
}

/**
 * Describes the rendered artwork canvas in workspace-local CSS pixels.
 * The function is deliberately DOM-free so every viewport consumer uses the
 * same pan, zoom, resize, and non-origin viewBox projection.
 */
export function canvasToWorkspaceProjection(
    artworkRect: RectLike,
    workspaceRect: RectLike,
    canvasBounds: Bounds,
): CanvasWorkspaceProjection {
    const canvasFrame = {
        x: artworkRect.left - workspaceRect.left,
        y: artworkRect.top - workspaceRect.top,
        width: artworkRect.width,
        height: artworkRect.height,
    };
    const scaleX = canvasBounds.width ? canvasFrame.width / canvasBounds.width : 1;
    const scaleY = canvasBounds.height ? canvasFrame.height / canvasBounds.height : 1;
    const canvasToWorkspace = {
        a: scaleX,
        b: 0,
        c: 0,
        d: scaleY,
        e: canvasFrame.x - canvasBounds.x * scaleX,
        f: canvasFrame.y - canvasBounds.y * scaleY,
    };

    return {
        canvasFrame,
        canvasToWorkspace,
        workspaceToCanvas: invertMatrix(canvasToWorkspace),
    };
}
