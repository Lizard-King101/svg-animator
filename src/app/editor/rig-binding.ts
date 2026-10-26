import { Armature, deformBinding, PathBinding } from './objects/armature';
import { findAnimationTarget } from './objects/animation-targets';
import { findElementChain } from './objects/element-bounds';
import { isGeometryVisible } from './objects/element-availability';
import { Path } from './objects/elements/path.object';
import { combinedMotionAdjustedMatrixFor } from './objects/motion-path.object';
import { SVG } from './objects/svg.object';

export function pathTopology(path: Path): string {
    return JSON.stringify(path.contours.map(contour => [contour.id, contour.closed, contour.lines.map(line => [line.id, line.type, line.points.map(p => p.id), line.controlStart?.id, line.controlEnd?.id])]));
}

export function createPathBinding(svg: SVG, path: Path, boneId: string): PathBinding {
    const anchors = new Map<string, string>();
    path.contours.forEach(contour => contour.lines.forEach(line => {
        line.points.forEach(point => anchors.set(point.id, point.id));
        if(line.controlStart && line.points[0]) anchors.set(line.controlStart.id, line.points[0].id);
        if(line.controlEnd && line.points.length) anchors.set(line.controlEnd.id, line.points[line.points.length - 1].id);
    }));
    return {
        pathId: path.id, matrix: combinedMotionAdjustedMatrixFor(svg, path), topology: pathTopology(path),
        points: path.pathPoints().map(point => ({ id: point.id, anchorId: anchors.get(point.id) ?? point.id, x: point.x, y: point.y,
            weights: anchors.get(point.id) === point.id ? [{ boneId, weight: 1 }] : [] })),
    };
}

/** Validate before any write: a stale binding must never overwrite hand-edited artwork. */
export interface RigArtworkValidationOptions { allowUnavailable?: boolean; }
export function bindingProblem(svg: SVG, rig: Armature, options: RigArtworkValidationOptions = {}): string | undefined {
    for(const binding of rig.bindings) {
        const path = findAnimationTarget(svg.elements, binding.pathId);
        if(!(path instanceof Path)) return 'A bound path was removed. Unbind it before posing.';
        const chain = findElementChain(svg.elements, path) ?? [];
        if(!options.allowUnavailable && (!isGeometryVisible(chain) || chain.some(element => element.locked))) return 'Show and unlock bound paths before posing.';
        if(pathTopology(path) !== binding.topology) return 'Bound path topology changed. Unbind and bind again before posing.';
        const matrix = combinedMotionAdjustedMatrixFor(svg, path);
        if((Object.keys(matrix) as (keyof typeof matrix)[]).some(key => Math.abs(matrix[key] - binding.matrix[key]) > .0002)) return 'A bound path transform changed. Unbind and bind again before posing.';
        const expected = deformBinding(rig, binding);
        if(path.pathPoints().some(point => {
            const target = expected.get(point.id);
            return !target || Math.abs(point.x - target.x) > .0002 || Math.abs(point.y - target.y) > .0002;
        })) return 'Bound points were edited. Unbind and bind again before posing.';
    }
    return undefined;
}

export function applyRigPose(svg: SVG, rig: Armature): void {
    for(const binding of rig.bindings) {
        const path = findAnimationTarget(svg.elements, binding.pathId);
        if(!(path instanceof Path)) continue;
        for(const [id, value] of deformBinding(rig, binding)) {
            const point = path.findPointById(id);
            if(point) { point.x = value.x; point.y = value.y; }
        }
    }
}
