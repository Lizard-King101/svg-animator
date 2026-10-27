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

/** The same centered CSS scale used by SVGDisplay, without reading a previous DOM frame. */
export function canvasViewProjection(view: {
    pos: { x: number; y: number }; width: number; height: number; zoom: number; canvasBounds: Bounds;
}): CanvasWorkspaceProjection {
    return canvasToWorkspaceProjection({
        left: view.pos.x + view.width * (1 - view.zoom) / 2,
        top: view.pos.y + view.height * (1 - view.zoom) / 2,
        width: view.width * view.zoom, height: view.height * view.zoom,
    }, { left: 0, top: 0, width: 0, height: 0 }, view.canvasBounds);
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
