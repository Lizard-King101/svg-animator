import { Injectable } from "@angular/core";
import { AnimationDocument, AnimationTrack, Keyframe, makeAnimationId } from "../editor/objects/animation.object";
import { AnyElement } from "../editor/objects/svg.object";
import { AnimatablePropertyDefinition } from "../editor/objects/animation.object";
import { Group } from "../editor/objects/elements/group.object";
import { Path } from "../editor/objects/elements/path.object";
import { gradientTimelineProperties } from "../editor/objects/paint.object";

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
                gradientTimelineProperties(element.settings as Record<string, unknown>)
                    .forEach((property) => rows.push({ type: "property", element, depth: depth + 1, property }));
                if(element instanceof Path) rows.push({ type: "property", element, depth: depth + 1, property: pathShapeProperty });
            }
            if(element instanceof Group && expanded.has(element.id)) append(element.elements, depth + 1);
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
            temporal: cloneValue(keyframe.temporal),
        }));
        return true;
    }

    paste(
        animation: AnimationDocument,
        currentTime: number,
        destination?: AnyElement,
        mapProperty: (element: AnyElement, property: string, sourceTargetId: string) => string | undefined = (_element, property) => property,
    ): boolean {
        if(this.clipboard.length === 0) return false;
        const entries = this.clipboard.flatMap((copied) => {
            const property = destination ? mapProperty(destination, copied.property, copied.targetId) : copied.property;
            return property ? [{ copied, property }] : [];
        });
        if(entries.length === 0) return false;
        this.selectedKeyframeIds.clear();
        entries.forEach(({ copied, property }) => {
            const targetId = destination?.id ?? copied.targetId;
            let track = animation.tracks.find((candidate) => candidate.targetId === targetId && candidate.property === property);
            if(!track) {
                track = {
                    id: makeAnimationId("track"),
                    targetId,
                    property,
                    valueType: copied.valueType,
                    keyframes: [],
                    enabled: true,
                };
                animation.tracks.push(track);
            }
            const time = snapTimelineTime(currentTime + copied.timeOffset);
            const existing = track.keyframes.find((keyframe) => timelineTimesMatch(keyframe.time, time));
            if(existing) {
                existing.value = cloneValue(copied.value);
                existing.easing = cloneValue(copied.easing);
                existing.temporal = cloneValue(copied.temporal);
                this.selectedKeyframeIds.add(existing.id);
            } else {
                const pasted: Keyframe = {
                    id: makeAnimationId("key"),
                    time,
                    value: cloneValue(copied.value),
                    easing: cloneValue(copied.easing),
                    temporal: cloneValue(copied.temporal),
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

export function timelineTimeToX(time: number, padding: number, pixelsPerSecond: number, domainStart = 0): number {
    return padding + ((time - domainStart) * pixelsPerSecond);
}

export function timelineXToTime(x: number, padding: number, pixelsPerSecond: number, domainStart = 0): number {
    return domainStart + ((x - padding) / pixelsPerSecond);
}

export function snapTimelineTime(time: number, _duration?: number): number {
    return Math.round(time * 100) / 100;
}

export function timelineRulerInterval(pixelsPerSecond: number): number {
    if(pixelsPerSecond >= 1200) return 0.05;
    if(pixelsPerSecond >= 600) return 0.1;
    if(pixelsPerSecond >= 220) return 0.25;
    if(pixelsPerSecond >= 120) return 0.5;
    if(pixelsPerSecond >= 70) return 1;
    return 2;
}

export function clampTimelineScale(value: number): number {
    return Math.round(Math.max(10, Math.min(2000, value)));
}

/** Clamps one shared retiming delta so a multi-key selection keeps its spacing at the document bounds. */
export function clampKeyframeTimeDelta(startTimes: readonly number[], requestedDelta: number, duration: number): number {
    return startTimes.length === 0 || !Number.isFinite(requestedDelta) ? 0 : requestedDelta;
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
    temporal?: Keyframe["temporal"];
}

function cloneValue<T>(value: T): T { return value == null ? value : JSON.parse(JSON.stringify(value)); }

/** Returns the numeric channel displayed alongside a selected speed curve. */
export function semanticPartnerProperty(property: string): string | undefined {
    const fixed: Record<string, string> = {
        "transform.translateX": "transform.translateY",
        "transform.translateY": "transform.translateX",
        "transform.scaleX": "transform.scaleY",
        "transform.scaleY": "transform.scaleX",
        "transform.originX": "transform.originY",
        "transform.originY": "transform.originX",
        "motion.offsetX": "motion.offsetY",
        "motion.offsetY": "motion.offsetX",
        "geometry.x": "geometry.y",
        "geometry.y": "geometry.x",
        "geometry.width": "geometry.height",
        "geometry.height": "geometry.width",
    };
    if(fixed[property]) return fixed[property];
    const point = /^(path\.points\.[^.]+)\.(x|y)$/.exec(property);
    if(point) return `${point[1]}.${point[2] === "x" ? "y" : "x"}`;
    const gradient = /^(settings\.(?:fill|stroke|color)\.gradient\.)(x1|y1|x2|y2|cx|cy|fx|fy)$/.exec(property);
    if(!gradient) return undefined;
    const pairs: Record<string, string> = { x1: "y1", y1: "x1", x2: "y2", y2: "x2", cx: "cy", cy: "cx", fx: "fy", fy: "fx" };
    return `${gradient[1]}${pairs[gradient[2]]}`;
}
