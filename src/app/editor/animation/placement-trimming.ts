import { ActionPlacement, placementTiming } from '../objects/animation.object';
import { actionTime } from '../../../../packages/runtime/src/composition.internal';

export type PlacementTrimEdge = 'in' | 'out';
export type PlacementTrimChange = Pick<ActionPlacement, 'start' | 'sourceStart' | 'sourceEnd'>;

/** Trim each repeated cycle equally. The opposite scene edge stays fixed. */
export function trimPlacement(placement: ActionPlacement, sourceDuration: number, edge: PlacementTrimEdge, sceneEdge: number): PlacementTrimChange | undefined {
    const timing = placementTiming(placement, sourceDuration);
    const minimum = Math.min(.001, timing.sourceEnd - timing.sourceStart);
    const factor = timing.rate / timing.repeat;
    const originalEdge = edge === 'in' ? placement.start : placement.start + timing.duration;
    const delta = sceneEdge - originalEdge;
    if(!Number.isFinite(delta)) return;
    if(edge === 'in') {
        const clampedSourceStart = Math.max(0, timing.sourceStart - placement.start * factor,
            Math.min(timing.sourceEnd - minimum, timing.sourceStart + delta * factor));
        const start = actionTime(placement.start + (clampedSourceStart - timing.sourceStart) / factor);
        const sourceStart = actionTime(clampedSourceStart);
        if(start === actionTime(placement.start) && sourceStart === actionTime(timing.sourceStart)) return;
        return { start, sourceStart, sourceEnd: placement.sourceEnd };
    }
    const sourceEnd = actionTime(Math.max(timing.sourceStart + minimum, Math.min(sourceDuration, timing.sourceEnd + delta * factor)));
    if(sourceEnd === actionTime(timing.sourceEnd)) return;
    return { start: placement.start, sourceStart: placement.sourceStart, sourceEnd };
}
