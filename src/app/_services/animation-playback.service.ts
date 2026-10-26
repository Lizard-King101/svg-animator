import { syncLoopSeam, loopEndpoints } from '../editor/animation/loop-seam';
import { compositionHasOverlap, restoreAnimation, placementTiming } from '../editor/objects/animation.object';
import { Subject } from 'rxjs';
import { AnimationAction, AnimationDocument } from '../editor/objects/animation.object';
import { Injectable, NgZone, OnDestroy } from "@angular/core";
import {
    AppliedAnimationValue,
    animationPropertyKey,
    findAnimationTarget,
    readAnimationProperty,
    writeAnimationProperty,
} from "../editor/objects/animation-targets";
import { AnimationTrack, AnimationValueType, colorValueSpace, createAnimationColorValue, makeAnimationId, normalizeWorkArea, TimelineWorkArea } from "../editor/objects/animation.object";
import { AnimationEvaluationPlan } from "../editor/animation/animation-evaluation-plan";
import { ImperativeSvgRenderer } from "../editor/animation/imperative-svg-renderer";
import { AnyElement, SVG } from "../editor/objects/svg.object";
import { EditorService } from "./editor.service";
import { EditorPreferencesService } from "./editor-preferences.service";
import { applyDocumentRigAnimation, parseRigAnimationProperty, readDocumentAnimationProperty, rigAnimationBaseProblem, writeDocumentAnimationProperty } from '../editor/rig-animation';
import { captureRigAnimationPreview, restoreRigAnimationPreview, RigAnimationPreviewSnapshot } from '../editor/rig-animation-preview';
import { documentRigChannelProblem } from '../editor/rig-animation-conflicts';

export type EditorMode = "edit" | "animate";

@Injectable()
export class AnimationPlaybackService implements OnDestroy {
    mode: EditorMode = "edit";
    currentTime = 0;
    speed = 1;
    readonly previewSpeeds = [.25, .5, 1, 1.5, 2];
    setPreviewSpeed(value: unknown): void {
        const speed = Number(value);
        if(!this.previewSpeeds.includes(speed)) return;
        this.speed = speed;
        this.lastFrameTime = undefined;
    }
    contextMessage = '';
    playing = false;
    revision = 0;

    readonly contextChanging = new Subject<'seek' | 'playback' | void>();
    private actionId?: string;
    private contextDocumentId?: string;
    private sceneTime = 0;
    private actionTimes = new Map<string, number>();

    get activeAction(): AnimationAction | undefined {
        const svg = this.editor.selectedSVG;
        return svg && svg.id === this.contextDocumentId ? svg.animation.composition?.actions.find(action => action.id === this.actionId) : undefined;
    }
    get activeAnimation(): AnimationDocument | undefined { return this.activeAction?.animation ?? this.editor.selectedSVG?.animation; }
    get contextKey(): string { return this.activeAction?.id ?? 'scene'; }
    allowsTarget(id: string): boolean { return !this.activeAction || this.activeAction.targetIds.includes(id); }

    /** Mutation boundary guard covers every source authoring path, including paste and paint restoration. */
    rejectConflictingComposition(previous: AnimationDocument): boolean {
        const svg = this.editor.selectedSVG;
        if(!svg?.animation.composition || !compositionHasOverlap(svg.animation.composition)) return false;
        this.contextChanging.next();
        this.pause();
        this.restorePreview();
        svg.animation = restoreAnimation(previous);
        this.invalidate();
        if(this.mode === 'animate') this.previewAt(this.currentTime);
        this.contextMessage = 'This edit would invalidate placement timing or make overlapping actions write the same channel. Adjust the placements before changing this motion.';
        return true;
    }

    editAction(id?: string): void {
        if(id === this.activeAction?.id) return;
        this.contextChanging.next();
        this.contextMessage = '';
        this.pause();
        this.restorePreview();
        if(this.activeAction) this.actionTimes.set(this.activeAction.id, this.currentTime);
        else this.sceneTime = this.currentTime;
        this.contextDocumentId = this.editor.selectedSVG?.id;
        this.actionId = id;
        this.currentTime = this.clampTime(id ? this.actionTimes.get(id) ?? 0 : this.sceneTime);
        this.invalidate();
        if(this.mode === 'animate') this.previewAt(this.currentTime);
    }

    private frameId?: number;
    private lastFrameTime?: number;
    private previewSVG?: SVG;
    private previewBaseValues = new Map<string, AppliedAnimationValue>();
    private previewRigBase?: RigAnimationPreviewSnapshot;
    private previewedRigs = new Set<string>();
    isRigPreviewed(id: string): boolean { return this.previewedRigs.has(id); }
    private evaluationPlan?: AnimationEvaluationPlan;
    private renderer?: ImperativeSvgRenderer;

    constructor(
        private editor: EditorService,
        private zone: NgZone,
        private preferences: EditorPreferencesService,
    ) {
        this.mode = this.preferences.mode;
    }

    ngOnDestroy() {
        this.pause();
        this.restorePreview();
        this.contextChanging.complete();
    }

    get duration(): number {
        return this.activeAnimation?.duration ?? 0;
    }

    get loop(): boolean {
        return this.activeAnimation?.loop ?? false;
    }

    get workArea(): TimelineWorkArea {
        const animation = this.activeAnimation;
        return normalizeWorkArea(animation?.workArea, animation?.duration ?? 0.1);
    }

    setMode(mode: EditorMode) {
        this.preferences.setMode(mode);
        if(this.mode === mode) {
            return;
        }

        this.contextChanging.next();
        this.pause();
        this.restorePreview();
        this.mode = mode;
        this.invalidate();
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

        this.contextMessage = '';
        const action = this.activeAction;
        const composition = svg.animation.composition;
        if(action && composition && compositionHasOverlap(composition, { id: action.id, duration: Math.max(0.1, duration) })) {
            this.contextMessage = 'This duration would overlap placements or cut off their trimmed source range. Adjust the placements first.';
            return;
        }
        if(this.activeAnimation!.tracks.some(track => {
            const pair = loopEndpoints(track);
            return pair && pair.end.time > Math.max(.1, duration);
        })) { this.contextMessage = 'Unlink loop endpoints before shortening the duration past their end.'; return; }
        const oldDuration = this.activeAnimation!.duration;
        const oldArea = normalizeWorkArea(this.activeAnimation!.workArea, oldDuration);
        const followsDuration = Math.abs(oldArea.start) < 0.0005 && Math.abs(oldArea.end - oldDuration) < 0.0005;
        this.activeAnimation!.duration = Math.max(0.1, duration);
        this.activeAnimation!.workArea = followsDuration
            ? { start: 0, end: this.activeAnimation!.duration }
            : normalizeWorkArea(oldArea, this.activeAnimation!.duration);
        if(action && composition) {
            const end = Math.max(svg.animation.duration, ...composition.placements.filter(value => value.actionId === action.id).map(value => value.start + placementTiming(value, action.animation.duration).duration));
            if(svg.animation.workArea?.end === svg.animation.duration) svg.animation.workArea.end = end;
            svg.animation.duration = end;
        }
        this.invalidate();
        this.seek(this.currentTime);
    }

    setWorkArea(start: number, end: number): void {
        const animation = this.activeAnimation;
        if(!animation || !Number.isFinite(start) || !Number.isFinite(end)) return;
        const minimum = Math.min(0.01, animation.duration);
        const safeStart = Math.max(0, Math.min(animation.duration - minimum, start));
        const safeEnd = Math.max(safeStart + minimum, Math.min(animation.duration, end));
        animation.workArea = { start: safeStart, end: safeEnd };
    }

    resetWorkArea(): void {
        const animation = this.activeAnimation;
        if(animation) animation.workArea = { start: 0, end: animation.duration };
    }

    trimToWorkArea(): boolean {
        const svg = this.editor.selectedSVG;
        if(!svg) return false;
        if(this.activeAction || this.activeAnimation?.composition?.placements.length) {
            this.contextMessage = 'Trim-to-work-area is available for direct animation. Edit action duration or placement start times instead.';
            return false;
        }
        const range = this.workArea;
        const offset = range.start;
        const duration = Math.max(0.1, range.end - range.start);
        if(Math.abs(offset) < 0.0005 && Math.abs(duration - this.activeAnimation!.duration) < 0.0005) return false;
        this.pause();
        this.restorePreview();
        this.activeAnimation!.tracks.forEach((track) => track.keyframes.forEach((keyframe) => {
            keyframe.time = roundTime(keyframe.time - offset);
        }));
        this.activeAnimation!.markers.forEach((marker) => marker.time = roundTime(marker.time - offset));
        this.activeAnimation!.duration = duration;
        this.activeAnimation!.workArea = { start: 0, end: duration };
        this.currentTime = this.clampTime(this.currentTime - offset);
        this.invalidate();
        if(this.mode === "animate") this.previewAt(this.currentTime);
        return true;
    }

    setLoop(loop: boolean) {
        if(this.editor.selectedSVG) {
            this.activeAnimation!.loop = loop;
        }
    }

    tracksForElement(element?: AnyElement): AnimationTrack[] {
        const svg = this.editor.selectedSVG;
        if(!svg || !element) {
            return [];
        }

        return this.activeAnimation!.tracks.filter((track) => track.targetId === element.id);
    }

    trackFor(element: AnyElement | undefined, property: string): AnimationTrack | undefined {
        if(!element || !this.editor.selectedSVG) {
            return undefined;
        }

        return this.activeAnimation!.tracks.find((track) => {
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
        this.upsertTargetKeyframe(element.id, property, valueType, value, baselineValue);
    }

    upsertTargetKeyframe(targetId: string, property: string, valueType: AnimationValueType, value: unknown, baselineValue?: unknown) {
        const svg = this.editor.selectedSVG;
        if(!svg) {
            return;
        }

        if(!this.allowsTarget(targetId)) {
            if(baselineValue !== undefined) writeDocumentAnimationProperty(svg, targetId, property, baselineValue);
            return;
        }
        const conflict = documentRigChannelProblem(svg, targetId, property);
        if(conflict) {
            if(baselineValue !== undefined) writeDocumentAnimationProperty(svg, targetId, property, baselineValue);
            this.contextMessage = conflict; return;
        }
        this.contextMessage = '';
        const keyValue = valueType === "color"
            ? createAnimationColorValue(value, colorValueSpace(value))
            : value;
        const existingTrack = this.activeAnimation!.tracks.find(track => track.targetId === targetId && track.property === property);
        this.restorePreview();
        const rigProblem = parseRigAnimationProperty(property) && rigAnimationBaseProblem(svg, new Set([targetId]));
        if(rigProblem) {
            this.contextMessage = rigProblem;
            if(this.mode === 'animate') this.previewAt(this.currentTime);
            return;
        }
        const rawBaseValue = baselineValue ?? readDocumentAnimationProperty(svg, targetId, property);
        if(rawBaseValue === undefined) return;
        if(!existingTrack && baselineValue !== undefined) {
            writeDocumentAnimationProperty(svg, targetId, property, baselineValue);
        }
        const baseValue = valueType === "color"
            ? createAnimationColorValue(rawBaseValue, colorValueSpace(keyValue))
            : rawBaseValue;

        const track = this.ensureTrack(targetId, property, valueType);
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
        syncLoopSeam(track, undefined, this.findKeyframe(track, this.currentTime)?.id);
        this.invalidate([track.id]);

        if(this.mode === "animate") {
            this.previewAt(this.currentTime);
        }
    }

    removeKeyframeAtCurrentTime(element: AnyElement, property: string) {
        this.removeTargetKeyframeAtCurrentTime(element.id, property);
    }

    removeTargetKeyframeAtCurrentTime(targetId: string, property: string) {
        const track = this.activeAnimation?.tracks.find(track => track.targetId === targetId && track.property === property);
        if(!track) {
            return;
        }

        this.restorePreview();
        track.keyframes = track.keyframes.filter((keyframe) => !this.timesMatch(keyframe.time, this.currentTime));

        if(track.keyframes.length === 0 && this.editor.selectedSVG) {
            this.activeAnimation!.tracks = this.activeAnimation!.tracks.filter((candidate) => candidate !== track);
        }
        this.invalidate([track.id]);

        if(this.mode === "animate") {
            this.previewAt(this.currentTime);
        }
    }

    setAnimatedPropertyValue(element: AnyElement, property: string, valueType: AnimationValueType, value: unknown) {
        this.upsertKeyframe(element, property, valueType, value);
    }

    setAnimatedTargetPropertyValue(targetId: string, property: string, valueType: AnimationValueType, value: unknown) {
        this.upsertTargetKeyframe(targetId, property, valueType, value);
    }

    play() {
        if(!this.editor.selectedSVG || this.playing) {
            return;
        }

        this.contextChanging.next('playback');
        this.setMode("animate");
        const range = this.workArea;
        if(this.currentTime < range.start || this.currentTime >= range.end) {
            this.seek(this.speed < 0 ? range.end : range.start);
        }
        this.playing = true;
        this.setOverlaysVisible(false);
        this.ensureEvaluationPlan(true);
        this.lastFrameTime = undefined;
        if(this.playing) {
            this.zone.runOutsideAngular(() => this.frameId = requestAnimationFrame((time) => this.tick(time)));
        } else {
            this.frameId = undefined;
        }
    }

    pause() {
        if(this.frameId != null) {
            cancelAnimationFrame(this.frameId);
            this.frameId = undefined;
        }

        this.playing = false;
        this.lastFrameTime = undefined;
        this.setOverlaysVisible(true);
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
        this.seek(this.workArea.start);
    }

    seek(time: number) {
        if(this.clampTime(time) !== this.currentTime) this.contextChanging.next('seek');
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

        if(this.previewSVG && this.previewSVG !== svg) this.restorePreview();
        const plan = this.ensureEvaluationPlan();
        const appliedValues = plan.evaluate(time);
        this.previewSVG = svg;
        const renderer = this.renderer!;
        const rigIds = new Set(plan.tracks.filter((track, index) => appliedValues[index]?.applied && parseRigAnimationProperty(track.property)).map(track => track.targetId));
        this.previewedRigs = rigIds;
        if(rigIds.size && !this.previewRigBase) {
            const problem = rigAnimationBaseProblem(svg, rigIds);
            if(problem) {
                this.pause(); this.restorePreview(); this.contextMessage = problem;
                return [];
            }
            this.previewRigBase = captureRigAnimationPreview(svg);
        }
        plan.tracks.forEach((track, index) => {
            const appliedValue = appliedValues[index];
            if(!appliedValue?.applied) return;
            const key = animationPropertyKey(track.targetId, track.property);
            if(!this.previewBaseValues.has(key)) {
                this.previewBaseValues.set(key, {
                    targetId: track.targetId,
                    property: track.property,
                    value: readDocumentAnimationProperty(svg, track.targetId, track.property),
                    applied: true,
                });
            }
            if(parseRigAnimationProperty(track.property)) writeDocumentAnimationProperty(svg, track.targetId, track.property, appliedValue.value);
            else renderer.apply(track, appliedValue.value);
        });
        if(rigIds.size) {
            try {
                for(const id of applyDocumentRigAnimation(svg, rigIds)) {
                    const target = findAnimationTarget(svg.elements, id);
                    if(target) renderer.markDirty(target);
                }
            } catch(error) {
                this.pause(); this.restorePreview();
                this.contextMessage = (error as Error).message;
                return [];
            }
        }
        renderer.flush();
        this.updateImperativeTimeline();
        return appliedValues;
    }

    restorePreview() {
        this.previewedRigs.clear();
        const svg = this.previewSVG ?? this.editor.selectedSVG;
        if(!svg) {
            this.previewBaseValues.clear();
            this.previewRigBase = undefined;
            this.previewSVG = undefined;
            return;
        }

        this.previewBaseValues.forEach((snapshot) => {
            writeDocumentAnimationProperty(svg, snapshot.targetId, snapshot.property, snapshot.value);
        });
        if(this.previewRigBase) restoreRigAnimationPreview(svg, this.previewRigBase);
        this.previewRigBase = undefined;
        this.previewBaseValues.clear();
        this.previewSVG = undefined;
        this.renderer?.clear();
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

    /** Restore only a detached sampling copy; never interrupt a live preview or gesture. */
    restoreSamplingBase(snapshot: SVG): void {
        if(snapshot === this.editor.selectedSVG || snapshot === this.previewSVG) {
            throw new Error('Animation sampling requires a detached document.');
        }
        if(snapshot.id !== this.previewSVG?.id) return;
        this.previewBaseValues.forEach(value => {
            writeDocumentAnimationProperty(snapshot, value.targetId, value.property, value.value);
        });
        if(this.previewRigBase) restoreRigAnimationPreview(snapshot, this.previewRigBase);
    }

    evaluate(svg: SVG, time: number): AppliedAnimationValue[] {
        if(this.editor.selectedSVG === svg) return this.ensureEvaluationPlan().evaluate(time);
        return new AnimationEvaluationPlan(svg.animation, svg.elements, svg.rigs).evaluate(time);
    }

    invalidate(trackIds?: Iterable<string>): void {
        this.revision++;
        const svg = this.editor.selectedSVG;
        this.restorePreview();
        if(trackIds && this.evaluationPlan && this.evaluationPlan.animation === this.activeAnimation) {
            this.evaluationPlan.invalidateTracks(trackIds);
        } else {
            this.evaluationPlan = undefined;
            this.renderer = undefined;
        }
    }

    private ensureTrack(targetId: string, property: string, valueType: AnimationValueType): AnimationTrack {
        let track = this.activeAnimation!.tracks.find(track => track.targetId === targetId && track.property === property);
        if(!track) {
            track = {
                id: makeAnimationId("track"),
                targetId,
                property,
                valueType,
                keyframes: [],
                enabled: true,
            };
            this.activeAnimation!.tracks.push(track);
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

        this.advance(deltaSeconds);

        if(this.playing) {
            this.zone.runOutsideAngular(() => this.frameId = requestAnimationFrame((time) => this.tick(time)));
        } else {
            this.frameId = undefined;
        }
    }

    private advance(deltaSeconds: number) {
        const range = this.workArea;
        const span = range.end - range.start;
        if(span <= 0) {
            this.currentTime = 0;
            this.previewAt(this.currentTime);
            return;
        }

        let nextTime = this.currentTime + deltaSeconds;
        if(nextTime > range.end) {
            if(this.loop) {
                nextTime = range.start + ((nextTime - range.start) % span);
            } else {
                nextTime = range.end;
                this.zone.run(() => this.pause());
            }
        }

        if(nextTime < range.start) {
            nextTime = this.loop ? range.end - ((range.start - nextTime) % span) : range.start;
        }

        this.currentTime = this.clampTime(nextTime);
        this.previewAt(this.currentTime);
    }

    private ensureEvaluationPlan(force = false): AnimationEvaluationPlan {
        const svg = this.editor.selectedSVG;
        if(!svg) throw new Error("Cannot compile animation without an active document.");
        if(force || !this.evaluationPlan || this.evaluationPlan.animation !== this.activeAnimation) {
            this.restorePreview();
            this.evaluationPlan = new AnimationEvaluationPlan(this.activeAnimation!, svg.elements, svg.rigs);
            this.renderer = new ImperativeSvgRenderer(svg);
        }
        return this.evaluationPlan;
    }

    private updateImperativeTimeline(): void {
        document.querySelectorAll<HTMLElement>(".animation-playhead").forEach((playhead) => {
            const padding = Number(playhead.dataset["timePadding"] ?? 28);
            const scale = Number(playhead.dataset["pixelsPerSecond"] ?? 120);
            const domainStart = Number(playhead.dataset["domainStart"] ?? 0);
            playhead.style.left = `${padding + (this.currentTime - domainStart) * scale}px`;
        });
        document.querySelectorAll<SVGLineElement>(".animation-graph-playhead").forEach((playhead) => {
            const padding = Number(playhead.dataset["timePadding"] ?? 28);
            const scale = Number(playhead.dataset["pixelsPerSecond"] ?? 120);
            const domainStart = Number(playhead.dataset["domainStart"] ?? 0);
            const x = padding + (this.currentTime - domainStart) * scale;
            playhead.setAttribute("x1", String(x));
            playhead.setAttribute("x2", String(x));
        });
        const input = document.querySelector<HTMLInputElement>(".timeline-current-time");
        if(input && document.activeElement !== input) input.value = String(Math.round(this.currentTime * 1000) / 1000);
    }

    private setOverlaysVisible(visible: boolean): void {
        document.querySelectorAll<SVGElement>(".editor-overlay").forEach((overlay) => overlay.style.display = visible ? "" : "none");
    }

    private clampTime(time: number): number {
        if(!Number.isFinite(time)) {
            return 0;
        }

        return Math.max(0, Math.min(time, this.duration || 0));
    }
}

function roundTime(value: number): number {
    return Math.round(value * 10000) / 10000;
}
