import {
    AnimationDocument,
    AnimationTrack,
    AnimationValueType,
    applyEasing,
    interpolateAnimationColor,
    normalizedKeyframes,
    temporalSegmentCoefficients,
    TemporalSegmentCoefficients,
} from "../objects/animation.object";
import { animationPropertyKey, AppliedAnimationValue, readAnimationProperty } from "../objects/animation-targets";
import { Group } from "../objects/elements/group.object";
import { AnyElement } from "../objects/svg.object";

export interface EvaluatedAnimationValue {
    targetId: string;
    property: string;
    value: unknown;
    target?: AnyElement;
    applied: boolean;
}

export interface CompiledAnimationTrack {
    readonly id: string;
    readonly targetId: string;
    readonly property: string;
    readonly valueType: AnimationValueType;
    readonly target?: AnyElement;
    readonly applicable: boolean;
    readonly times: Float64Array;
    readonly numericValues?: Float64Array;
    readonly values: readonly unknown[];
    readonly easings: Uint8Array;
    readonly temporal: readonly (TemporalSegmentCoefficients | undefined)[];
    cursor: number;
    lastTime: number;
}

/**
 * Immutable-per-revision evaluation data. Sorting, target lookup and numeric
 * coercion happen at compile time; forward playback only advances cursors.
 */
export class AnimationEvaluationPlan {
    readonly targetMap = new Map<string, AnyElement>();
    readonly trackMap = new Map<string, CompiledAnimationTrack>();
    readonly tracksByTargetProperty = new Map<string, CompiledAnimationTrack>();
    tracks: CompiledAnimationTrack[] = [];
    private output: EvaluatedAnimationValue[] = [];

    constructor(public animation: AnimationDocument, elements: readonly AnyElement[]) {
        this.rebuildTargets(elements);
        this.rebuild(animation);
    }

    rebuild(animation: AnimationDocument): void {
        this.animation = animation;
        this.trackMap.clear();
        this.tracksByTargetProperty.clear();
        this.tracks = animation.tracks
            .filter((track) => track.enabled !== false)
            .map((track) => this.compileTrack(track));
        this.tracks.forEach((track) => {
            this.trackMap.set(track.id, track);
            this.tracksByTargetProperty.set(animationPropertyKey(track.targetId, track.property), track);
        });
        this.output.length = this.tracks.length;
    }

    rebuildTargets(elements: readonly AnyElement[]): void {
        this.targetMap.clear();
        const append = (items: readonly AnyElement[]) => items.forEach((element) => {
            this.targetMap.set(element.id, element);
            if(element instanceof Group) append(element.elements);
        });
        append(elements);
    }

    invalidateStructure(elements: readonly AnyElement[]): void {
        this.rebuildTargets(elements);
        this.rebuild(this.animation);
    }

    /** Recompiles only the tracks named by id, preserving all other arrays. */
    invalidateTracks(trackIds: Iterable<string>): void {
        const invalid = new Set(trackIds);
        if(invalid.size === 0) return;
        const source = new Map(this.animation.tracks.map((track) => [track.id, track]));
        this.tracks = this.tracks.flatMap((compiled) => {
            if(!invalid.has(compiled.id)) return [compiled];
            const track = source.get(compiled.id);
            return track && track.enabled !== false ? [this.compileTrack(track)] : [];
        });
        source.forEach((track, id) => {
            if(invalid.has(id) && !this.tracks.some((candidate) => candidate.id === id) && track.enabled !== false) {
                this.tracks.push(this.compileTrack(track));
            }
        });
        this.trackMap.clear();
        this.tracksByTargetProperty.clear();
        this.tracks.forEach((track) => {
            this.trackMap.set(track.id, track);
            this.tracksByTargetProperty.set(animationPropertyKey(track.targetId, track.property), track);
        });
        this.output.length = this.tracks.length;
    }

    evaluate(time: number): AppliedAnimationValue[] {
        this.evaluateEach(time, (track, value, applied, index) => {
            const entry = this.output[index] ?? {
                targetId: track.targetId,
                property: track.property,
                value,
                target: track.target,
                applied,
            };
            entry.targetId = track.targetId;
            entry.property = track.property;
            entry.value = value;
            entry.applied = applied;
            entry.target = track.target;
            this.output[index] = entry;
        });
        return this.output as AppliedAnimationValue[];
    }

    evaluateEach(
        time: number,
        visitor: (track: CompiledAnimationTrack, value: unknown, applied: boolean, index: number) => void,
    ): void {
        for(let index = 0; index < this.tracks.length; index++) {
            const track = this.tracks[index];
            const value = evaluateCompiledTrack(track, time);
            visitor(track, value, track.applicable && value !== undefined, index);
        }
    }

    private compileTrack(track: AnimationTrack): CompiledAnimationTrack {
        const keyframes = normalizedKeyframes(track.keyframes);
        const times = new Float64Array(keyframes.length);
        const numericValues = track.valueType === "number" ? new Float64Array(keyframes.length) : undefined;
        const easings = new Uint8Array(Math.max(0, keyframes.length - 1));
        const temporal: (TemporalSegmentCoefficients | undefined)[] = new Array(Math.max(0, keyframes.length - 1));
        keyframes.forEach((keyframe, index) => {
            times[index] = keyframe.time;
            if(numericValues) numericValues[index] = Number(keyframe.value);
            if(index < keyframes.length - 1) {
                easings[index] = easingCode(keyframe.easing?.type);
                if(track.valueType === "number" && (keyframe.temporal?.out || keyframes[index + 1].temporal?.in)) {
                    temporal[index] = temporalSegmentCoefficients(keyframe, keyframes[index + 1]);
                }
            }
        });
        const target = this.targetMap.get(track.targetId);
        return {
            id: track.id,
            targetId: track.targetId,
            property: track.property,
            valueType: track.valueType,
            target,
            applicable: !!target && readAnimationProperty(target, track.property) !== undefined,
            times,
            numericValues,
            values: keyframes.map((keyframe) => keyframe.value),
            easings,
            temporal,
            cursor: 0,
            lastTime: Number.NEGATIVE_INFINITY,
        };
    }
}

export function evaluateCompiledTrack(track: CompiledAnimationTrack, time: number): unknown {
    const count = track.times.length;
    if(count === 0) return undefined;
    if(time <= track.times[0]) {
        track.cursor = 0;
        track.lastTime = time;
        return compiledValue(track, 0);
    }
    if(time >= track.times[count - 1]) {
        track.cursor = Math.max(0, count - 2);
        track.lastTime = time;
        return compiledValue(track, count - 1);
    }

    let segment = track.cursor;
    if(time >= track.lastTime && segment < count - 1) {
        while(segment < count - 2 && time > track.times[segment + 1]) segment++;
    } else {
        segment = findSegment(track.times, time);
    }
    track.cursor = segment;
    track.lastTime = time;

    if(track.valueType === "boolean" || track.valueType === "string" || track.easings[segment] === 1) {
        return compiledValue(track, segment);
    }
    const start = track.times[segment];
    const end = track.times[segment + 1];
    const raw = end <= start ? 1 : Math.max(0, Math.min(1, (time - start) / (end - start)));
    if(track.valueType === "number") {
        const coefficient = track.temporal[segment];
        if(coefficient) return evaluateCoefficient(coefficient, time);
        const from = track.numericValues![segment];
        const to = track.numericValues![segment + 1];
        return from + (to - from) * applyEasing(raw, { type: easingType(track.easings[segment]) });
    }

    return interpolateAnimationColor(track.values[segment], track.values[segment + 1], applyEasing(raw, { type: easingType(track.easings[segment]) }));
}

function compiledValue(track: CompiledAnimationTrack, index: number): unknown {
    return track.numericValues ? track.numericValues[index] : track.values[index];
}

function findSegment(times: Float64Array, time: number): number {
    let low = 0;
    let high = times.length - 1;
    while(low + 1 < high) {
        const middle = (low + high) >>> 1;
        if(times[middle] <= time) low = middle; else high = middle;
    }
    return low;
}

function evaluateCoefficient(c: TemporalSegmentCoefficients, time: number): number {
    const end = ((c.timeA + c.timeB) + c.timeC) + c.timeD;
    let u = end === c.timeD ? 1 : Math.max(0, Math.min(1, (time - c.timeD) / (end - c.timeD)));
    let low = 0;
    let high = 1;
    for(let i = 0; i < 12; i++) {
        const x = ((c.timeA * u + c.timeB) * u + c.timeC) * u + c.timeD;
        if(x < time) low = u; else high = u;
        u = (low + high) / 2;
    }
    return ((c.valueA * u + c.valueB) * u + c.valueC) * u + c.valueD;
}

function easingCode(type: string | undefined): number {
    return type === "hold" ? 1 : type === "ease-in" ? 2 : type === "ease-out" ? 3 : type === "ease-in-out" ? 4 : 0;
}

function easingType(code: number): "linear" | "hold" | "ease-in" | "ease-out" | "ease-in-out" {
    return code === 1 ? "hold" : code === 2 ? "ease-in" : code === 3 ? "ease-out" : code === 4 ? "ease-in-out" : "linear";
}
