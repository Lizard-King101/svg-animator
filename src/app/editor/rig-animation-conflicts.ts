import { rigChannelConflict, RigSceneNode } from '../../../packages/runtime/src/rig/runtime-rigs';
import { parseRigAnimationProperty } from '../../../packages/runtime/src/rig/channels';
import { allAnimationDocuments } from './objects/animation.object';
import { Group } from './objects/elements/group.object';
import { AnyElement, SVG } from './objects/svg.object';

/** Authoring preflight for both directions of a rig/artwork channel conflict, including action sources. */
export function documentRigChannelProblem(svg: SVG, targetId: string, property: string): string | undefined {
    const scene: RigSceneNode[] = [];
    const visit = (elements: readonly AnyElement[], parentId: string | null) => {
        for(const element of elements) {
            scene.push({ id: element.id, parentId });
            if(element instanceof Group) visit(element.elements, element.id);
        }
    };
    visit(svg.elements, null);
    const tracks = allAnimationDocuments(svg.animation).flatMap(animation => animation.tracks).filter(track => track.enabled !== false && track.keyframes.length > 0);
    const parsed = parseRigAnimationProperty(property);
    if(parsed) {
        const rig = svg.rigs.armatures.find(rig => rig.id === targetId);
        if(!rig?.bones.some(bone => bone.id === parsed.boneId)) return 'This bone no longer exists.';
        const rigs = { ...svg.rigs, armatures: [rig] };
        const ownProblem = rigChannelConflict(rigs, scene, { targetId, property });
        if(ownProblem) return ownProblem;
        for(const track of tracks) {
            if(parseRigAnimationProperty(track.property)) continue;
            const problem = rigChannelConflict(rigs, scene, track);
            if(problem) return `${problem} Remove the conflicting artwork track from the scene or its action source first.`;
        }
        return;
    }
    const animatedIds = new Set(tracks.filter(track => parseRigAnimationProperty(track.property)).map(track => track.targetId));
    return rigChannelConflict({ ...svg.rigs, armatures: svg.rigs.armatures.filter(rig => animatedIds.has(rig.id)) }, scene, { targetId, property });
}
