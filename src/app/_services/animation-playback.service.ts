import { Injectable, NgZone, OnDestroy } from "@angular/core";
import {
    AppliedAnimationValue,
    animationPropertyKey,
    findAnimationTarget,
    readAnimationProperty,
    writeAnimationProperty,
} from "../editor/objects/animation-targets";
import { AnimationTrack, AnimationValueType, colorValueSpace, createAnimationColorValue, evaluateTrack, makeAnimationId } from "../editor/objects/animation.object";
import { AnyElement, SVG } from "../editor/objects/svg.object";
import { EditorService } from "./editor.service";

export type EditorMode = "edit" | "animate";

@Injectable()
export class AnimationPlaybackService implements OnDestroy {
    mode: EditorMode = "edit";
    currentTime = 0;
    speed = 1;
    playing = false;

    private frameId?: number;
    private lastFrameTime?: number;
    private previewSVG?: SVG;
    private previewBaseValues = new Map<string, AppliedAnimationValue>();

    constructor(private editor: EditorService, private zone: NgZone) {}

    ngOnDestroy() {
        this.pause();
        this.restorePreview();
    }

    get duration(): number {
        return this.editor.selectedSVG?.animation.duration ?? 0;
    }

    get loop(): boolean {
        return this.editor.selectedSVG?.animation.loop ?? false;
    }

    setMode(mode: EditorMode) {
        if(this.mode === mode) {
            return;
        }

        this.pause();
        this.restorePreview();
        this.mode = mode;
        this.currentTime = this.clampTime(this.currentTime);
        if(mode === "animate") {
            this.previewAt(this.currentTime);
        }
    }

    setDuration(duration: number) {
        const svg = this.editor.selectedSVG;
        if(!svg || !Number.isFinite(duration)) {
            return;
        }

        svg.animation.duration = Math.max(0.1, duration);
        this.seek(this.currentTime);
    }

    setLoop(loop: boolean) {
        if(this.editor.selectedSVG) {
            this.editor.selectedSVG.animation.loop = loop;
        }
    }

    tracksForElement(element?: AnyElement): AnimationTrack[] {
        const svg = this.editor.selectedSVG;
        if(!svg || !element) {
            return [];
        }

        return svg.animation.tracks.filter((track) => track.targetId === element.id);
    }

    trackFor(element: AnyElement | undefined, property: string): AnimationTrack | undefined {
        if(!element || !this.editor.selectedSVG) {
            return undefined;
        }

        return this.editor.selectedSVG.animation.tracks.find((track) => {
            return track.targetId === element.id && track.property === property;
        });
    }

    keyframeCount(element: AnyElement | undefined, property: string): number {
        return this.trackFor(element, property)?.keyframes.length ?? 0;
    }

    hasKeyframeAtCurrentTime(element: AnyElement | undefined, property: string): boolean {
        return !!this.findKeyframeAtCurrentTime(element, property);
    }

    upsertKeyframe(element: AnyElement, property: string, valueType: AnimationValueType, value = readAnimationProperty(element, property), baselineValue?: unknown) {
        const svg = this.editor.selectedSVG;
        if(!svg) {
            return;
        }

        const keyValue = valueType === "color"
            ? createAnimationColorValue(value, colorValueSpace(value))
            : value;
        const existingTrack = this.trackFor(element, property);
        const rawBaseValue = baselineValue ?? readAnimationProperty(element, property);
        this.restorePreview();
        if(!existingTrack && baselineValue !== undefined) {
            writeAnimationProperty(element, property, baselineValue);
        }
        const baseValue = valueType === "color"
            ? createAnimationColorValue(rawBaseValue, colorValueSpace(keyValue))
            : rawBaseValue;

        const track = this.ensureTrack(svg, element, property, valueType);
        if(!existingTrack && this.currentTime > 0.0005) {
            track.keyframes.push({
                id: makeAnimationId("key"),
                time: 0,
                value: baseValue,
                easing: { type: "linear" },
            });
        }

        const existing = this.findKeyframe(track, this.currentTime);
        if(existing) {
            existing.value = keyValue;
            existing.easing ??= { type: "linear" };
        } else {
            track.keyframes.push({
                id: makeAnimationId("key"),
                time: this.currentTime,
                value: keyValue,
                easing: { type: "linear" },
            });
        }

        track.keyframes.sort((a, b) => a.time - b.time);

        if(this.mode === "animate") {
            this.previewAt(this.currentTime);
        }
    }

    removeKeyframeAtCurrentTime(element: AnyElement, property: string) {
        const track = this.trackFor(element, property);
        if(!track) {
            return;
        }

        this.restorePreview();
        track.keyframes = track.keyframes.filter((keyframe) => !this.timesMatch(keyframe.time, this.currentTime));

        if(track.keyframes.length === 0 && this.editor.selectedSVG) {
            this.editor.selectedSVG.animation.tracks = this.editor.selectedSVG.animation.tracks.filter((candidate) => candidate !== track);
        }

        if(this.mode === "animate") {
            this.previewAt(this.currentTime);
        }
    }

    setAnimatedPropertyValue(element: AnyElement, property: string, valueType: AnimationValueType, value: unknown) {
        this.upsertKeyframe(element, property, valueType, value);
    }

    play() {
        if(!this.editor.selectedSVG || this.playing) {
            return;
        }

        this.mode = "animate";
        this.playing = true;
        this.lastFrameTime = undefined;
        this.zone.runOutsideAngular(() => {
            this.frameId = requestAnimationFrame((time) => this.tick(time));
        });
    }

    pause() {
        if(this.frameId != null) {
            cancelAnimationFrame(this.frameId);
            this.frameId = undefined;
        }

        this.playing = false;
        this.lastFrameTime = undefined;
    }

    togglePlayback() {
        if(this.playing) {
            this.pause();
        } else {
            this.play();
        }
    }

    stop() {
        this.pause();
        this.seek(0);
    }

    seek(time: number) {
        this.currentTime = this.clampTime(time);
        if(this.mode === "animate") {
            this.previewAt(this.currentTime);
        }
    }

    previewAt(time: number): AppliedAnimationValue[] {
        const svg = this.editor.selectedSVG;
        if(!svg) {
            this.restorePreview();
            return [];
        }

        const appliedValues = this.evaluate(svg, time);
        this.restorePreview();
        this.previewSVG = svg;

        appliedValues.forEach((appliedValue) => {
            if(!appliedValue.applied) {
                return;
            }

            const target = findAnimationTarget(svg.elements, appliedValue.targetId);
            if(!target) {
                return;
            }

            const key = animationPropertyKey(appliedValue.targetId, appliedValue.property);
            if(!this.previewBaseValues.has(key)) {
                this.previewBaseValues.set(key, {
                    targetId: appliedValue.targetId,
                    property: appliedValue.property,
                    value: readAnimationProperty(target, appliedValue.property),
                    applied: true,
                });
            }

            writeAnimationProperty(target, appliedValue.property, appliedValue.value);
        });

        return appliedValues;
    }

    restorePreview() {
        const svg = this.previewSVG ?? this.editor.selectedSVG;
        if(!svg || this.previewBaseValues.size === 0) {
            this.previewBaseValues.clear();
            this.previewSVG = undefined;
            return;
        }

        this.previewBaseValues.forEach((snapshot) => {
            const target = findAnimationTarget(svg.elements, snapshot.targetId);
            if(target) {
                writeAnimationProperty(target, snapshot.property, snapshot.value);
            }
        });
        this.previewBaseValues.clear();
        this.previewSVG = undefined;
    }

    withBaseState<T>(callback: () => T): T {
        const shouldRestorePreview = this.mode === "animate" && this.previewBaseValues.size > 0;
        const previewTime = this.currentTime;
        this.restorePreview();

        try {
            return callback();
        } finally {
            if(shouldRestorePreview) {
                this.previewAt(previewTime);
            }
        }
    }

    evaluate(svg: SVG, time: number): AppliedAnimationValue[] {
        return svg.animation.tracks
            .filter((track) => track.enabled !== false)
            .map((track) => this.evaluateTrack(svg, track, time));
    }

    private evaluateTrack(svg: SVG, track: AnimationTrack, time: number): AppliedAnimationValue {
        const target = findAnimationTarget(svg.elements, track.targetId);
        const value = evaluateTrack(track, time);
        const readable = target ? readAnimationProperty(target, track.property) !== undefined : false;

        return {
            targetId: track.targetId,
            property: track.property,
            value,
            applied: !!target && readable && value !== undefined,
        };
    }

    private ensureTrack(svg: SVG, element: AnyElement, property: string, valueType: AnimationValueType): AnimationTrack {
        let track = this.trackFor(element, property);
        if(!track) {
            track = {
                id: makeAnimationId("track"),
                targetId: element.id,
                property,
                valueType,
                keyframes: [],
                enabled: true,
            };
            svg.animation.tracks.push(track);
        }

        return track;
    }

    private findKeyframeAtCurrentTime(element: AnyElement | undefined, property: string) {
        const track = this.trackFor(element, property);
        return track ? this.findKeyframe(track, this.currentTime) : undefined;
    }

    private findKeyframe(track: AnimationTrack, time: number) {
        return track.keyframes.find((keyframe) => this.timesMatch(keyframe.time, time));
    }

    private timesMatch(a: number, b: number): boolean {
        return Math.abs(a - b) < 0.0005;
    }

    private tick(frameTime: number) {
        if(!this.playing) {
            return;
        }

        const previous = this.lastFrameTime ?? frameTime;
        const deltaSeconds = ((frameTime - previous) / 1000) * this.speed;
        this.lastFrameTime = frameTime;

        this.zone.run(() => {
            this.advance(deltaSeconds);
        });

        this.zone.runOutsideAngular(() => {
            this.frameId = requestAnimationFrame((time) => this.tick(time));
        });
    }

    private advance(deltaSeconds: number) {
        const duration = this.duration;
        if(duration <= 0) {
            this.currentTime = 0;
            this.previewAt(this.currentTime);
            return;
        }

        let nextTime = this.currentTime + deltaSeconds;
        if(nextTime > duration) {
            if(this.loop) {
                nextTime = nextTime % duration;
            } else {
                nextTime = duration;
                this.pause();
            }
        }

        if(nextTime < 0) {
            nextTime = this.loop ? duration + (nextTime % duration) : 0;
        }

        this.currentTime = this.clampTime(nextTime);
        this.previewAt(this.currentTime);
    }

    private clampTime(time: number): number {
        if(!Number.isFinite(time)) {
            return 0;
        }

        return Math.max(0, Math.min(time, this.duration || 0));
    }
}
