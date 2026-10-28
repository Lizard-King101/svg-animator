import { AnimationDocument, AnimationTrack } from '../objects/animation.object';

/** Replace complete channels without changing their source document or unrelated tracks. */
export function replaceAnimationTracks(animation: AnimationDocument, generated: readonly AnimationTrack[]): AnimationTrack[] {
    const properties = new Set(generated.map(track => `${track.targetId}\0${track.property}`));
    return [...animation.tracks.filter(track => !properties.has(`${track.targetId}\0${track.property}`)), ...generated];
}
