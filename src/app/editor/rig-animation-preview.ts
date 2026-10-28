import { findAnimationTarget } from './objects/animation-targets';
import { Path } from './objects/elements/path.object';
import type { SVG } from './objects/svg.object';
import type { TransformState } from './objects/transform.object';

interface BonePoseSnapshot { id: string; pose: number; poseX?: number; poseY?: number; }
export interface RigAnimationPreviewSnapshot {
    documentId: string;
    rigs: { id: string; constraintsActive?: boolean; windX?: number; windY?: number; bones: BonePoseSnapshot[] }[];
    paths: { id: string; points: { id: string; x: number; y: number }[] }[];
    attachments: { id: string; transform: TransformState }[];
}

/** Capture only animation-produced state, not binding/constraint/rest definitions. */
export function captureRigAnimationPreview(svg: SVG, rigIds?: ReadonlySet<string>): RigAnimationPreviewSnapshot {
    const rigs = svg.rigs.armatures.filter(rig => !rigIds || rigIds.has(rig.id));
    const paths = [...new Set(rigs.flatMap(rig => rig.bindings.map(binding => binding.pathId)))].flatMap(id => {
        const path = findAnimationTarget(svg.elements, id);
        return path instanceof Path ? [{ id, points: path.pathPoints().map(point => ({ id: point.id, x: point.x, y: point.y })) }] : [];
    });
    const attachments = [...new Set(rigs.flatMap(rig => (rig.attachments ?? []).map(link => link.elementId)))].flatMap(id => {
        const target = findAnimationTarget(svg.elements, id);
        return target ? [{ id, transform: { ...target.transform } }] : [];
    });
    return { documentId: svg.id, rigs: rigs.map(rig => ({ id: rig.id, constraintsActive: rig.constraintsActive, windX:rig.windX, windY:rig.windY,
        bones: rig.bones.map(bone => ({ id: bone.id, pose: bone.pose, poseX: bone.poseX, poseY: bone.poseY })) })), paths, attachments };
}

/** Stable IDs support both the live model and detached export/inspection copies. */
export function restoreRigAnimationPreview(svg: SVG, snapshot: RigAnimationPreviewSnapshot): void {
    if(svg.id !== snapshot.documentId) return;
    for(const base of snapshot.rigs) {
        const rig = svg.rigs.armatures.find(rig => rig.id === base.id);
        if(!rig) continue;
        if(base.constraintsActive === undefined) delete rig.constraintsActive; else rig.constraintsActive = base.constraintsActive;
        for(const field of ['windX','windY'] as const) { if(base[field]===undefined) delete rig[field]; else rig[field]=base[field]; }
        for(const value of base.bones) {
            const bone = rig.bones.find(bone => bone.id === value.id);
            if(!bone) continue;
            bone.pose = value.pose;
            if(value.poseX === undefined) delete bone.poseX; else bone.poseX = value.poseX;
            if(value.poseY === undefined) delete bone.poseY; else bone.poseY = value.poseY;
        }
    }
    for(const base of snapshot.paths) {
        const path = findAnimationTarget(svg.elements, base.id);
        if(!(path instanceof Path)) continue;
        for(const value of base.points) {
            const point = path.findPointById(value.id);
            if(point) { point.x = value.x; point.y = value.y; }
        }
    }
    for(const base of snapshot.attachments) {
        const target = findAnimationTarget(svg.elements, base.id);
        if(target) target.transform = { ...base.transform };
    }
}
