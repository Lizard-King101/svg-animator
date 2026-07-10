import { Injectable } from "@angular/core";
import { AnimationDocument, AnimationTrack, Keyframe, makeAnimationId } from "../editor/objects/animation.object";
import { AnyElement } from "../editor/objects/svg.object";
import { AnimatablePropertyDefinition } from "../editor/objects/animation.object";
import { Group } from "../editor/objects/elements/group.object";
import { Path } from "../editor/objects/elements/path.object";
import { gradientAnimationProperties } from "../editor/objects/paint.object";

export type TimelineRow = LayerTimelineRow | PropertyTimelineRow;
export type LayerTimelineRow = { type: "layer"; element: AnyElement; depth: number };
export type PropertyTimelineRow = { type: "property"; element: AnyElement; depth: number; property: AnimatablePropertyDefinition };

@Injectable()
export class TimelineEditingService {
    selectedKeyframeIds = new Set<string>();
    private clipboard: CopiedKeyframe[] = [];

    projectRows(
        elements: AnyElement[],
        expanded: Set<string>,
        properties: readonly AnimatablePropertyDefinition[],
        propertySupported: (element: AnyElement, property: AnimatablePropertyDefinition) => boolean,
        pathShapeProperty: AnimatablePropertyDefinition,
    ): TimelineRow[] {
        const rows: TimelineRow[] = [];
        const append = (list: AnyElement[], depth: number) => [...list].reverse().forEach((element) => {
            rows.push({ type: "layer", element, depth });
            if(expanded.has(element.id)) {
                properties.filter((property) => propertySupported(element, property))
                    .forEach((property) => rows.push({ type: "property", element, depth: depth + 1, property }));
                gradientAnimationProperties(element.settings as Record<string, unknown>)
                    .forEach((property) => rows.push({ type: "property", element, depth: depth + 1, property }));
                if(element instanceof Path) rows.push({ type: "property", element, depth: depth + 1, property: pathShapeProperty });
            }
            if(element instanceof Group) append(element.elements, depth + 1);
        });
        append(elements, 0);
        return rows;
    }

    entries(tracks: AnimationTrack[]): KeyframeEntry[] {
        if(this.selectedKeyframeIds.size === 0) return [];
        return tracks.flatMap((track) => track.keyframes
            .filter((keyframe) => this.selectedKeyframeIds.has(keyframe.id))
            .map((keyframe) => ({ track, keyframe })));
    }

    copy(tracks: AnimationTrack[]): boolean {
        const entries = this.entries(tracks);
        if(entries.length === 0) return false;
        const earliest = Math.min(...entries.map((entry) => entry.keyframe.time));
        this.clipboard = entries.map(({ track, keyframe }) => ({
            targetId: track.targetId,
            property: track.property,
            valueType: track.valueType,
            timeOffset: keyframe.time - earliest,
            value: cloneValue(keyframe.value),
            easing: cloneValue(keyframe.easing),
        }));
        return true;
    }

    paste(animation: AnimationDocument, currentTime: number): boolean {
        if(this.clipboard.length === 0) return false;
        this.selectedKeyframeIds.clear();
        this.clipboard.forEach((copied) => {
            let track = animation.tracks.find((candidate) => candidate.targetId === copied.targetId && candidate.property === copied.property);
            if(!track) {
                track = {
                    id: makeAnimationId("track"),
                    targetId: copied.targetId,
                    property: copied.property,
                    valueType: copied.valueType,
                    keyframes: [],
                    enabled: true,
                };
                animation.tracks.push(track);
            }
            const time = snapTimelineTime(currentTime + copied.timeOffset, animation.duration);
            const existing = track.keyframes.find((keyframe) => timelineTimesMatch(keyframe.time, time));
            if(existing) {
                existing.value = cloneValue(copied.value);
                existing.easing = cloneValue(copied.easing);
                this.selectedKeyframeIds.add(existing.id);
            } else {
                const pasted: Keyframe = {
                    id: makeAnimationId("key"),
                    time,
                    value: cloneValue(copied.value),
                    easing: cloneValue(copied.easing),
                };
                track.keyframes.push(pasted);
                this.selectedKeyframeIds.add(pasted.id);
            }
            track.keyframes.sort((a, b) => a.time - b.time);
        });
        return true;
    }

    delete(animation: AnimationDocument): boolean {
        if(this.selectedKeyframeIds.size === 0) return false;
        animation.tracks.forEach((track) => {
            track.keyframes = track.keyframes.filter((keyframe) => !this.selectedKeyframeIds.has(keyframe.id));
        });
        animation.tracks = animation.tracks.filter((track) => track.keyframes.length > 0);
        this.selectedKeyframeIds.clear();
        return true;
    }

    prune(tracks: AnimationTrack[]): void {
        const active = new Set(tracks.flatMap((track) => track.keyframes.map((keyframe) => keyframe.id)));
        this.selectedKeyframeIds.forEach((id) => { if(!active.has(id)) this.selectedKeyframeIds.delete(id); });
    }
}

export function timelineTimeToX(time: number, padding: number, pixelsPerSecond: number): number {
    return padding + (Math.max(0, time) * pixelsPerSecond);
}

export function timelineXToTime(x: number, padding: number, pixelsPerSecond: number): number {
    return Math.max(0, (x - padding) / pixelsPerSecond);
}

export function snapTimelineTime(time: number, duration: number): number {
    return Math.round(Math.max(0, Math.min(duration, time)) * 100) / 100;
}

export function timelineRulerInterval(pixelsPerSecond: number): number {
    if(pixelsPerSecond >= 220) return 0.25;
    if(pixelsPerSecond >= 120) return 0.5;
    if(pixelsPerSecond >= 70) return 1;
    return 2;
}

export function clampTimelineScale(value: number): number {
    return Math.round(Math.max(40, Math.min(360, value)));
}

export function timelineTimesMatch(a: number, b: number): boolean { return Math.abs(a - b) < 0.0005; }

export interface KeyframeEntry { track: AnimationTrack; keyframe: Keyframe; }

interface CopiedKeyframe {
    targetId: string;
    property: string;
    valueType: AnimationTrack["valueType"];
    timeOffset: number;
    value: unknown;
    easing: Keyframe["easing"];
}

function cloneValue<T>(value: T): T { return value == null ? value : JSON.parse(JSON.stringify(value)); }
