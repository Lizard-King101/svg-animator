import { ChangeDetectorRef, ElementRef, EventEmitter, Injectable, NgZone, OnDestroy } from "@angular/core";
import { AnimationPlaybackService } from "src/app/_services/animation-playback.service";
import { EditorService } from "src/app/_services/editor.service";
import { EditorPreferencesService } from "src/app/_services/editor-preferences.service";
import { ANIMATABLE_PROPERTIES, AnimatablePropertyDefinition, AnimationTrack, EasingType, evaluateTemporalSpeed, Keyframe, makeAnimationId, temporalTangentsForPreset, TemporalHandle } from "src/app/editor/objects/animation.object";
import { findAnimationTarget, matchingAnimationProperty, parsePathPointProperty, pathPointAnimationProperty, readAnimationProperty } from "src/app/editor/objects/animation-targets";
import { Color } from "src/app/editor/objects/color.object";
import { DocumentMutationService } from "src/app/_services/document-mutation.service";
import { Subscription } from "rxjs";
import { Group } from "src/app/editor/objects/elements/group.object";
import { Path } from "src/app/editor/objects/elements/path.object";
import { AnyElement } from "src/app/editor/objects/svg.object";
import { GradientPaint, gradientAnimationProperties, isGradientPaint } from "src/app/editor/objects/paint.object";
import { FloatingPopoverPosition, floatingPopoverStyle, positionFloatingPopover } from "src/app/_components/floating-popover";
import { PaintEditorChange } from "src/app/_components/paint-editor/paint-editor.types";
import { PaintEditingService } from "src/app/_services/paint-editing.service";
import {
    clampKeyframeTimeDelta,
    clampTimelineScale,
    KeyframeEntry,
    PropertyTimelineRow,
    snapTimelineTime,
    TimelineEditingService,
    timelineRulerInterval,
    TimelineRow,
    timelineTimesMatch,
    timelineTimeToX,
    timelineXToTime,
    semanticPartnerProperty,
} from "src/app/_services/timeline-editing.service";

const PATH_SHAPE_PROPERTY: AnimatablePropertyDefinition = {
    property: "path.shape",
    label: "Path Shape",
    valueType: "string",
    group: "path",
    mvp: true,
};

@Injectable()
export class TimelineEditorService implements OnDestroy {
    animationChange = new EventEmitter<void>();
    timelineHeight = 310;
    resizingTimeline = false;
    get draggingKeyframe() { return !!this.keyframeDrag; }
    get draggingNumber() { return !!this.numberDrag; }
    get selectingKeyframes() { return !!this.marquee; }
    get panningTimeline() { return !!this.viewportPan; }

    readonly properties = ANIMATABLE_PROPERTIES;
    readonly easingOptions: readonly EasingToolbarOption[] = [
        { type: "linear", label: "Linear", icon: "diamond" },
        { type: "ease-in", label: "Ease In", icon: "caret-left" },
        { type: "ease-out", label: "Ease Out", icon: "caret-right" },
        { type: "ease-in-out", label: "Ease In Out", icon: "hourglass-half", className: "hourglass-sideways" },
    ];
    readonly timePadding = 28;
    expandedLayerIds = new Set<string>();
    selectedRowKey?: string;
    selectedGraphTargetId?: string;
    selectedGraphProperty?: string;
    get selectedKeyframeIds(): Set<string> { return this.editing.selectedKeyframeIds; }
    set selectedKeyframeIds(value: Set<string>) { this.editing.selectedKeyframeIds = value; }
    openColorEditorKey?: string;
    paintPopoverPosition?: FloatingPopoverPosition;
    pixelsPerSecond = 120;
    surfaceMode: "timeline" | "graph" = "timeline";
    graphSpeedMin = -1;
    graphSpeedMax = 1;
    activeGraphHandle?: GraphHandle;
    selectedGraphHandleKeys = new Set<string>();
    virtualStart = 0;
    virtualCount = 80;
    visibleTimeStart = 0;
    visibleTimeEnd = Number.POSITIVE_INFINITY;
    private scrubbing = false;
    private scrubPointerId?: number;
    private scrubRect?: DOMRect;
    private scrubClientX = 0;
    private scrubFrame?: number;
    private scrubCapture?: HTMLElement;
    private resizeStartY = 0;
    private resizeStartHeight = 310;
    private keyframeDrag?: KeyframeDrag;
    private keyframeFrame?: number;
    private viewportPan?: TimelineViewportPan;
    private viewportPanFrame?: number;
    private numberDrag?: NumberDrag;
    private numberDragFrame?: number;
    marquee?: KeyframeMarquee;
    private colorCache = new Map<string, { source: string; color: Color }>();
    private graphDrag?: GraphHandleDrag;
    private graphFrame?: number;
    private globalPointerCleanup?: () => void;
    private speedCurveCache = new Map<string, { key: string; path: string }>();
    private layerSummaryCache = new Map<string, { revision: number; keyframes: TimelineKeyframe[] }>();
    private rowCacheKey = "";
    private rowCache: TimelineRow[] = [];
    private historyRestoreSubscription: Subscription;

    constructor(
        public editor: EditorService,
        public animation: AnimationPlaybackService,
        private host: ElementRef<HTMLElement>,
        private preferences: EditorPreferencesService,
        private editing: TimelineEditingService,
        private zone: NgZone,
        private mutations: DocumentMutationService,
        private changeDetector: ChangeDetectorRef,
        private paintEditing: PaintEditingService,
    ) {
        this.timelineHeight = this.clampTimelineHeight(this.preferences.timelineHeight);
        this.historyRestoreSubscription = this.mutations.historyRestored.subscribe(() => {
            this.rowCacheKey = "";
            this.layerSummaryCache.clear();
            this.speedCurveCache.clear();
            this.colorCache.clear();
            this.changeDetector.markForCheck();
        });
    }

    ngOnDestroy(): void {
        this.historyRestoreSubscription.unsubscribe();
        this.clearGlobalPointerTracking();
        if(this.graphFrame != null) cancelAnimationFrame(this.graphFrame);
        if(this.keyframeFrame != null) cancelAnimationFrame(this.keyframeFrame);
        if(this.viewportPanFrame != null) cancelAnimationFrame(this.viewportPanFrame);
        if(this.numberDragFrame != null) cancelAnimationFrame(this.numberDragFrame);
        if(this.scrubFrame != null) cancelAnimationFrame(this.scrubFrame);
    }

    get rows(): TimelineRow[] {
        const elements = this.editor.selectedSVG?.elements ?? [];
        const cacheKey = `${this.editor.selectedSVG?.id ?? ""}|${[...this.expandedLayerIds].sort().join(",")}|${this.rowStructureKey(elements)}`;
        if(cacheKey === this.rowCacheKey) return this.rowCache;
        this.rowCacheKey = cacheKey;
        this.rowCache = this.editing.projectRows(
            elements,
            this.expandedLayerIds,
            this.properties,
            (element, property) => this.propertySupported(element, property),
            PATH_SHAPE_PROPERTY,
        );
        return this.rowCache;
    }

    trackRow(_index: number, row: TimelineRow): string {
        return row.type === "layer"
            ? `layer:${row.element.id}`
            : `property:${row.element.id}:${row.property.property}`;
    }

    toggleLayer(element: AnyElement) {
        if(this.expandedLayerIds.has(element.id)) {
            this.expandedLayerIds.delete(element.id);
        } else {
            this.expandedLayerIds.add(element.id);
        }
    }

    selectLayer(element: AnyElement) {
        this.editor.selectedElement = element;
        this.editor.selectedPathAnchor = undefined;
        this.editor.selectedPathLine = undefined;
        this.editor.selectedPathLines = [];
    }

    selectTimelineRow(row: TimelineRow) {
        this.selectLayer(row.element);
        if(row.type === "layer" && this.surfaceMode === "graph") {
            const first = this.animation.tracksForElement(row.element).find((track) => track.valueType === "number");
            if(first) {
                this.selectedGraphTargetId = row.element.id;
                this.selectedGraphProperty = first.property;
                this.fitSpeed();
            }
        }
        if(row.type === "property") {
            this.selectedRowKey = `${row.element.id}:${row.property.property}`;
            if(row.property.valueType === "number") {
                this.selectedGraphTargetId = row.element.id;
                this.selectedGraphProperty = row.property.property;
            } else if(this.isGradientGroupRow(row)) {
                const first = this.gradientPropertiesForRow(row).find((property) => property.valueType === "number"
                    && !!this.animation.trackFor(row.element, property.property));
                if(first) {
                    this.selectedGraphTargetId = row.element.id;
                    this.selectedGraphProperty = first.property;
                }
            } else if(this.isPathShapeRow(row)) {
                const first = this.pathPointTracks(row.element)[0];
                if(first) {
                    this.selectedGraphTargetId = row.element.id;
                    this.selectedGraphProperty = first.property;
                }
            }
            const match = /^settings\.(fill|stroke|color)\.gradient\./.exec(row.property.property);
            if(match) this.editor.selectedGradientPaintKey = match[1] as "fill" | "stroke" | "color";
        }
        if(this.surfaceMode === "graph") this.fitSpeed();
    }

    openRowContextMenu(row: TimelineRow, event: MouseEvent) {
        if(row.type !== "layer") {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.selectLayer(row.element);

        const motionPaths = this.availableMotionPaths(row.element);
        if(motionPaths.length === 0 && !row.element.motion.pathId) {
            return;
        }

        this.editor.openContextMenu(event.clientX, event.clientY, [
            ...(motionPaths.length ? [{
                label: "Attach Motion To",
                children: motionPaths.map((path) => ({
                    label: path.name,
                    action: () => this.attachMotionPath(row.element, path),
                })),
            }] : []),
            ...(row.element.motion.pathId ? [{
                label: "Detach Motion Path",
                action: () => this.detachMotionPath(row.element),
            }] : []),
        ]);
        this.editor.contextMenu!.infoTitle = "Motion Path";
        this.editor.contextMenu!.infoLines = [
            "Keyframe Motion Progress after attaching.",
            "Use Rotate To Path and Offset Angle to control orientation.",
        ];
    }

    keyframes(row: TimelineRow): TimelineKeyframe[] {
        if(row.type === "property") {
            if(this.isPathShapeRow(row)) {
                return this.pathShapeKeyframes(row.element);
            }
            if(this.isGradientGroupRow(row)) return this.gradientGroupKeyframes(row);

            return this.animation.trackFor(row.element, row.property.property)?.keyframes ?? [];
        }

        if(this.expandedLayerIds.has(row.element.id)) return [];
        const cacheKey = `${this.editor.selectedSVG?.id ?? ""}:${row.element.id}`;
        const cached = this.layerSummaryCache.get(cacheKey);
        if(cached?.revision === this.animation.revision) return cached.keyframes;
        const summaries: TimelineKeyframe[] = [];
        this.animation.tracksForElement(row.element)
            .flatMap((track) => track.keyframes)
            .sort((a, b) => a.time - b.time)
            .forEach((keyframe) => {
                const existing = summaries.at(-1);
                if(existing && this.timesMatch(existing.time, keyframe.time)) {
                    existing.summaryCount = (existing.summaryCount ?? 1) + 1;
                    return;
                }
                summaries.push({
                    id: `summary:${row.element.id}:${keyframe.time}`,
                    time: keyframe.time,
                    value: undefined,
                    summaryCount: 1,
                });
            });
        this.layerSummaryCache.set(cacheKey, { revision: this.animation.revision, keyframes: summaries });
        return summaries;
    }

    get visibleRows(): TimelineRow[] {
        const rows = this.rows;
        if(rows.length <= this.virtualCount) return rows;
        return rows.slice(this.virtualStart, Math.min(rows.length, this.virtualStart + this.virtualCount));
    }

    get virtualTopHeight(): number { return this.rows.length > this.virtualCount ? this.virtualStart * 30 : 0; }
    get virtualBottomHeight(): number {
        return this.rows.length > this.virtualCount
            ? Math.max(0, (this.rows.length - this.virtualStart - this.visibleRows.length) * 30)
            : 0;
    }

    updateTimelineViewport(event: Event): void {
        const viewport = event.currentTarget as HTMLElement;
        const rowStart = Math.max(0, Math.floor((viewport.scrollTop - 30) / 30) - 8);
        this.virtualStart = Math.min(rowStart, Math.max(0, this.rows.length - this.virtualCount));
        this.virtualCount = Math.max(40, Math.ceil(viewport.clientHeight / 30) + 16);
        const timelineLeft = Math.max(0, viewport.scrollLeft - 360 - this.timePadding);
        this.visibleTimeStart = Math.max(0, timelineLeft / this.pixelsPerSecond - 0.5);
        this.visibleTimeEnd = (timelineLeft + viewport.clientWidth + 360) / this.pixelsPerSecond + 0.5;
    }

    visibleKeyframes(row: TimelineRow): TimelineKeyframe[] {
        const keys = this.keyframes(row);
        if(!Number.isFinite(this.visibleTimeEnd) || keys.length < 80) return keys;
        const sorted = keys.length > 1 && keys[0].time > keys[keys.length - 1].time ? [...keys].sort((a, b) => a.time - b.time) : keys;
        let low = lowerBound(sorted, this.visibleTimeStart);
        let high = lowerBound(sorted, this.visibleTimeEnd);
        low = Math.max(0, low - 1);
        high = Math.min(sorted.length, high + 1);
        return sorted.slice(low, high);
    }

    toggleSurfaceMode(mode: "timeline" | "graph"): void {
        this.surfaceMode = mode;
        if(mode === "graph") {
            if(!this.selectedNumericRow()) {
                const first = this.rows.find((row): row is PropertyTimelineRow => row.type === "property" && row.property.valueType === "number"
                    && !!this.animation.trackFor(row.element, row.property.property));
                if(first) this.selectedRowKey = `${first.element.id}:${first.property.property}`;
                if(first) {
                    this.selectedGraphTargetId = first.element.id;
                    this.selectedGraphProperty = first.property.property;
                } else {
                    const track = this.editor.selectedSVG?.animation.tracks.find((candidate) => candidate.valueType === "number");
                    if(track) {
                        this.selectedGraphTargetId = track.targetId;
                        this.selectedGraphProperty = track.property;
                    }
                }
            }
            this.fitSpeed();
        }
    }

    selectedNumericRow(): PropertyTimelineRow | undefined {
        const direct = this.rows.find((row): row is PropertyTimelineRow => row.type === "property"
            && row.property.valueType === "number"
            && row.element.id === this.selectedGraphTargetId
            && row.property.property === this.selectedGraphProperty);
        if(direct) return direct;
        const element = findAnimationTarget(this.editor.selectedSVG?.elements ?? [], this.selectedGraphTargetId ?? "");
        const track = this.editor.selectedSVG?.animation.tracks.find((candidate) => candidate.targetId === this.selectedGraphTargetId
            && candidate.property === this.selectedGraphProperty && candidate.valueType === "number");
        if(!element || !track) return undefined;
        return {
            type: "property",
            element,
            depth: 1,
            property: { property: track.property, label: this.propertyLabel(track.property), valueType: "number", group: "path", mvp: true },
        };
    }

    graphTracks(): GraphTrack[] {
        const row = this.selectedNumericRow();
        if(!row) return [];
        const primary = this.animation.trackFor(row.element, row.property.property);
        const partnerProperty = semanticPartnerProperty(row.property.property);
        const partner = partnerProperty ? this.animation.trackFor(row.element, partnerProperty) : undefined;
        return [primary, partner].flatMap((track) => track ? [this.graphTrackDescriptor(track, track === primary
            ? row.property.label : this.propertyLabel(track.property), track === primary)] : []);
    }

    graphTrackOptions(): { property: string; label: string }[] {
        const targetId = this.selectedGraphTargetId ?? this.editor.selectedElement?.id;
        const seen = new Set<string>();
        return (this.editor.selectedSVG?.animation.tracks ?? []).flatMap((track) => {
            if(track.targetId !== targetId || track.valueType !== "number" || seen.has(track.property)) return [];
            seen.add(track.property);
            return [{ property: track.property, label: this.propertyLabel(track.property) }];
        });
    }

    graphRenderTracks(): GraphTrack[] {
        return [...this.graphTracks()].sort((a, b) => Number(a.selected) - Number(b.selected));
    }

    selectGraphProperty(property: string): void {
        this.selectedGraphProperty = property;
        this.fitSpeed();
    }

    graphHeight(): number { return Math.max(120, this.timelineHeight - 72); }
    graphZeroY(): number { return this.graphSpeedY(0); }
    graphPlayheadX(): number { return this.timeToX(this.animation.currentTime); }

    speedCurvePath(track: AnimationTrack): string {
        const keys = track.keyframes;
        if(keys.length < 2) return "";
        const cacheKey = `${this.pixelsPerSecond}:${this.graphSpeedMin}:${this.graphSpeedMax}:${this.graphHeight()}:${keys.map((key) => `${key.time}:${key.value}:${key.easing?.type ?? "linear"}:${key.temporal?.in?.speed ?? ""}:${key.temporal?.in?.influence ?? ""}:${key.temporal?.out?.speed ?? ""}:${key.temporal?.out?.influence ?? ""}`).join("|")}`;
        const cached = this.speedCurveCache.get(track.id);
        if(cached?.key === cacheKey) return cached.path;
        const parts: string[] = [];
        for(let index = 0; index < keys.length - 1; index++) {
            const from = keys[index];
            const to = keys[index + 1];
            const samples = Math.max(24, Math.min(512, Math.ceil(Math.abs(to.time - from.time) * this.pixelsPerSecond / 4)));
            for(let sample = 0; sample <= samples; sample++) {
                const time = from.time + (to.time - from.time) * (sample / samples);
                const speed = this.segmentSpeed(from, to, time);
                parts.push(`${parts.length ? "L" : "M"}${this.timeToX(time).toFixed(2)},${this.graphSpeedY(speed).toFixed(2)}`);
            }
        }
        const path = parts.join(" ");
        this.speedCurveCache.set(track.id, { key: cacheKey, path });
        return path;
    }

    graphHandles(track: AnimationTrack): GraphHandle[] {
        const handles: GraphHandle[] = [];
        for(let index = 0; index < track.keyframes.length - 1; index++) {
            const from = track.keyframes[index];
            const to = track.keyframes[index + 1];
            const preset = temporalTangentsForPreset(from.easing, Number(from.value), Number(to.value), to.time - from.time);
            handles.push({ track, keyframe: from, other: to, side: "out", speed: from.temporal?.out?.speed ?? preset.out.speed, influence: from.temporal?.out?.influence ?? preset.out.influence });
            handles.push({ track, keyframe: to, other: from, side: "in", speed: to.temporal?.in?.speed ?? preset.in.speed, influence: to.temporal?.in?.influence ?? preset.in.influence });
        }
        return handles;
    }

    graphHandleX(handle: GraphHandle): number {
        const duration = Math.abs(handle.other.time - handle.keyframe.time);
        const time = handle.side === "out"
            ? handle.keyframe.time + duration * handle.influence
            : handle.keyframe.time - duration * handle.influence;
        return this.timeToX(time);
    }

    graphKeyX(handle: GraphHandle): number { return this.timeToX(handle.keyframe.time); }

    graphHandleY(handle: GraphHandle): number { return this.graphSpeedY(handle.speed); }
    graphHandleDisplayY(handle: GraphHandle): number {
        const axis = this.graphAxis(handle.track.property);
        return this.graphHandleY(handle) + (axis === "x" ? -5 : axis === "y" ? 5 : 0);
    }
    graphAxis(property: string): GraphAxis {
        if(/(?:X|\.x|\.x1|\.x2|\.cx|\.fx)$/.test(property)) return "x";
        if(/(?:Y|\.y|\.y1|\.y2|\.cy|\.fy)$/.test(property)) return "y";
        return "scalar";
    }
    graphHandleKey(handle: GraphHandle): string { return `${handle.track.id}:${handle.keyframe.id}:${handle.side}`; }
    graphHandleSelected(handle: GraphHandle): boolean { return this.selectedGraphHandleKeys.has(this.graphHandleKey(handle)); }
    graphKeyframeSelected(handle: GraphHandle): boolean { return this.selectedKeyframeIds.has(handle.keyframe.id); }

    fitSpeed(): void {
        const speeds = this.graphTracks().flatMap(({ track }) => track.keyframes.slice(0, -1).flatMap((from, index) => {
            const to = track.keyframes[index + 1];
            return Array.from({ length: 17 }, (_unused, sample) => this.segmentSpeed(from, to, from.time + (to.time - from.time) * sample / 16));
        })).filter(Number.isFinite);
        const min = speeds.length ? Math.min(0, ...speeds) : -1;
        const max = speeds.length ? Math.max(0, ...speeds) : 1;
        const padding = Math.max(0.1, (max - min) * 0.12);
        this.graphSpeedMin = min - padding;
        this.graphSpeedMax = max + padding;
    }

    zoomSpeed(factor: number, anchorSpeed = (this.graphSpeedMin + this.graphSpeedMax) / 2): void {
        this.graphSpeedMin = anchorSpeed + (this.graphSpeedMin - anchorSpeed) * factor;
        this.graphSpeedMax = anchorSpeed + (this.graphSpeedMax - anchorSpeed) * factor;
        if(this.graphSpeedMax - this.graphSpeedMin < 0.0002) {
            this.graphSpeedMin = anchorSpeed - 0.0001;
            this.graphSpeedMax = anchorSpeed + 0.0001;
        }
    }

    beginGraphHandleDrag(handle: GraphHandle, event: PointerEvent): void {
        if(event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const key = this.graphHandleKey(handle);
        if(event.shiftKey) {
            if(this.selectedGraphHandleKeys.has(key)) this.selectedGraphHandleKeys.delete(key); else this.selectedGraphHandleKeys.add(key);
        } else if(!this.selectedGraphHandleKeys.has(key)) {
            this.selectedGraphHandleKeys.clear();
            this.selectedGraphHandleKeys.add(key);
        }
        const selected = this.graphTracks().flatMap(({ track }) => this.graphHandles(track)).filter((candidate) => this.selectedGraphHandleKeys.has(this.graphHandleKey(candidate)));
        const originalTemporal = new Map(selected.map((candidate) => [this.graphHandleKey(candidate), this.cloneValue(candidate.keyframe.temporal)]));
        selected.forEach((candidate) => this.initializeGraphHandle(candidate));
        if(event.altKey) selected.forEach((candidate) => candidate.keyframe.temporal!.linked = false);
        this.activeGraphHandle = handle;
        this.graphDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            latestX: event.clientX,
            latestY: event.clientY,
            moved: false,
            capture: (event.currentTarget as Element).closest<HTMLElement>(".speed-graph-surface") ?? undefined,
            snapshots: selected.map((candidate) => ({ handle: candidate, temporal: originalTemporal.get(this.graphHandleKey(candidate)) })),
        };
        try { this.graphDrag.capture?.setPointerCapture(event.pointerId); } catch {}
        this.installGlobalPointerTracking(
            event.pointerId,
            (pointerEvent) => this.updateGraphHandleDrag(pointerEvent),
            (pointerEvent) => this.zone.run(() => this.endGraphHandleDrag(pointerEvent)),
        );
    }

    updateGraphHandleDrag(event: PointerEvent): void {
        if(!this.graphDrag || this.graphDrag.pointerId !== event.pointerId) return;
        event.preventDefault();
        this.graphDrag.latestX = event.clientX;
        this.graphDrag.latestY = event.clientY;
        if(Math.hypot(event.clientX - this.graphDrag.startX, event.clientY - this.graphDrag.startY) > 1) this.graphDrag.moved = true;
        if(this.graphFrame == null) {
            this.zone.runOutsideAngular(() => this.graphFrame = requestAnimationFrame(() => this.zone.run(() => this.applyGraphDragFrame())));
        }
    }

    endGraphHandleDrag(event: PointerEvent): void {
        if(!this.graphDrag || this.graphDrag.pointerId !== event.pointerId) return;
        if(this.graphFrame != null) { cancelAnimationFrame(this.graphFrame); this.graphFrame = undefined; this.applyGraphDragFrame(); }
        const drag = this.graphDrag;
        const moved = drag.moved;
        if(!moved) {
            drag.snapshots.forEach((snapshot) => snapshot.handle.keyframe.temporal = this.cloneValue(snapshot.temporal));
            this.animation.invalidate(new Set(drag.snapshots.map((snapshot) => snapshot.handle.track.id)));
            this.animation.previewAt(this.animation.currentTime);
        }
        try { drag.capture?.releasePointerCapture(event.pointerId); } catch {}
        this.graphDrag = undefined;
        this.clearGlobalPointerTracking();
        if(moved) this.animationChange.emit();
    }

    setActiveHandleValue(field: "speed" | "influence", value: number | string): void {
        if(!this.activeGraphHandle) return;
        const numeric = Number(value);
        if(!Number.isFinite(numeric)) return;
        const handle = this.initializeGraphHandle(this.activeGraphHandle);
        handle[field] = field === "influence" ? Math.max(0, Math.min(1, numeric)) : numeric;
        this.linkGraphHandleSpeed(this.activeGraphHandle);
        this.animation.invalidate([this.activeGraphHandle.track.id]);
        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
    }

    relinkActiveHandle(): void {
        const active = this.activeGraphHandle;
        if(!active) return;
        this.initializeGraphHandle(active);
        const temporal = active.keyframe.temporal ??= { linked: true };
        temporal.linked = true;
        const source = temporal[active.side];
        const opposite = active.side === "in" ? temporal.out : temporal.in;
        if(source && opposite) opposite.speed = source.speed;
        this.animationChange.emit();
    }

    activeHandleSpeed(): number | undefined {
        const active = this.activeGraphHandle;
        return active?.keyframe.temporal?.[active.side]?.speed ?? active?.speed;
    }

    activeHandleInfluence(): number | undefined {
        const active = this.activeGraphHandle;
        return active?.keyframe.temporal?.[active.side]?.influence ?? active?.influence;
    }

    activeHandleLinked(): boolean { return this.activeGraphHandle?.keyframe.temporal?.linked ?? true; }
    activeHandleAxisLabel(): string {
        const active = this.activeGraphHandle;
        if(!active) return "";
        const axis = this.graphAxis(active.track.property);
        return axis === "scalar" ? this.propertyLabel(active.track.property) : `${axis.toUpperCase()} · ${this.propertyLabel(active.track.property)}`;
    }

    get timelineContentWidth(): number {
        return Math.max(360, (this.animation.duration * this.pixelsPerSecond) + (this.timePadding * 2));
    }

    get overscrollHeight(): number {
        const toolbarHeight = 36;
        const rulerHeight = 30;
        const rowHeight = 30;
        const availableHeight = this.timelineHeight - toolbarHeight - rulerHeight;
        const usedRowHeight = this.rows.length * rowHeight;
        return Math.max(96, availableHeight - usedRowHeight);
    }

    keyframeLeft(time: number): string {
        return `${this.timeToX(time)}px`;
    }

    playheadLeft(): string {
        return this.keyframeLeft(this.animation.currentTime);
    }

    zoomTimeline(delta: number) {
        this.zoomTimelineAt(delta > 0 ? 1.25 : 0.8);
    }

    setTimelineZoom(value: number | string): void {
        const numeric = Number(value);
        if(!Number.isFinite(numeric) || numeric <= 0) return;
        this.zoomTimelineAt(numeric / this.pixelsPerSecond);
    }

    timelineWheel(event: WheelEvent): void {
        const target = event.target as Element | null;
        if(!target?.closest(".timeline-time-cell")) return;
        event.preventDefault();
        event.stopPropagation();
        const graph = target.closest<HTMLElement>(".speed-graph-surface");
        if(graph && (event.ctrlKey || event.metaKey)) {
            const rect = graph.getBoundingClientRect();
            const y = Math.max(0, Math.min(this.graphHeight(), event.clientY - rect.top));
            const anchor = this.graphSpeedMax - (y - 10) / Math.max(1, this.graphHeight() - 20) * (this.graphSpeedMax - this.graphSpeedMin);
            this.zoomSpeed(event.deltaY > 0 ? 1.12 : 0.88, anchor);
            return;
        }
        this.zoomTimelineAt(event.deltaY > 0 ? 0.84 : 1.19, event.clientX);
    }

    beginViewportPan(event: PointerEvent): void {
        if(event.button !== 1) return;
        const target = event.target as Element | null;
        if(!target?.closest(".timeline-time-cell")) return;
        const viewport = event.currentTarget as HTMLElement;
        event.preventDefault();
        event.stopPropagation();
        this.viewportPan = {
            pointerId: event.pointerId,
            viewport,
            startX: event.clientX,
            startY: event.clientY,
            latestX: event.clientX,
            latestY: event.clientY,
            startScrollLeft: viewport.scrollLeft,
            startScrollTop: viewport.scrollTop,
            startSpeedMin: this.graphSpeedMin,
            startSpeedMax: this.graphSpeedMax,
            graph: this.surfaceMode === "graph" && !!target.closest(".speed-graph-surface"),
        };
        try { viewport.setPointerCapture(event.pointerId); } catch {}
        this.installGlobalPointerTracking(
            event.pointerId,
            (pointerEvent) => this.updateViewportPan(pointerEvent),
            (pointerEvent) => this.zone.run(() => this.endViewportPan(pointerEvent)),
        );
    }

    updateViewportPan(event: PointerEvent): void {
        const pan = this.viewportPan;
        if(!pan || pan.pointerId !== event.pointerId) return;
        event.preventDefault();
        pan.latestX = event.clientX;
        pan.latestY = event.clientY;
        if(this.viewportPanFrame == null) {
            this.zone.runOutsideAngular(() => this.viewportPanFrame = requestAnimationFrame(() => this.zone.run(() => this.applyViewportPanFrame())));
        }
    }

    endViewportPan(event: PointerEvent): void {
        const pan = this.viewportPan;
        if(!pan || pan.pointerId !== event.pointerId) return;
        if(this.viewportPanFrame != null) {
            cancelAnimationFrame(this.viewportPanFrame);
            this.viewportPanFrame = undefined;
            this.applyViewportPanFrame();
        }
        try { pan.viewport.releasePointerCapture(event.pointerId); } catch {}
        this.viewportPan = undefined;
        this.clearGlobalPointerTracking();
    }

    zoomTimelineAt(factor: number, clientX?: number): void {
        const table = this.host.nativeElement.querySelector<HTMLElement>(".timeline-table");
        const oldScale = this.pixelsPerSecond;
        const nextScale = this.clampTimelineScale(oldScale * factor);
        if(nextScale === oldScale) return;
        if(!table) {
            this.pixelsPerSecond = nextScale;
            return;
        }
        const rect = table.getBoundingClientRect();
        let anchorScreen = clientX == null ? 360 + (table.clientWidth - 360) / 2 : clientX - rect.left;
        let anchorTime: number;
        if(clientX == null) {
            anchorTime = this.animation.currentTime;
            const playheadScreen = 360 + this.timePadding + anchorTime * oldScale - table.scrollLeft;
            if(playheadScreen >= 360 && playheadScreen <= table.clientWidth) anchorScreen = playheadScreen;
        } else {
            anchorTime = Math.max(0, (table.scrollLeft + anchorScreen - 360 - this.timePadding) / oldScale);
        }
        this.pixelsPerSecond = nextScale;
        table.scrollLeft = Math.max(0, 360 + this.timePadding + anchorTime * nextScale - anchorScreen);
    }

    fitTimeline() {
        const visibleWidth = this.host.nativeElement.querySelector<HTMLElement>(".timeline-ruler-cell")?.clientWidth ?? 600;
        const duration = Math.max(0.1, this.animation.duration);
        this.pixelsPerSecond = this.clampTimelineScale((visibleWidth - (this.timePadding * 2)) / duration);
    }

    rulerMarks(): TimelineRulerMark[] {
        const duration = Math.max(0, this.animation.duration);
        const interval = this.rulerInterval();
        const marks: TimelineRulerMark[] = [];

        for(let time = 0; time <= duration + 0.0001; time += interval) {
            const rounded = Math.round(time * 1000) / 1000;
            marks.push({
                time: rounded,
                label: `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}s`,
                left: this.timeToX(rounded),
            });
        }

        if(marks.length === 0 || marks[marks.length - 1].time < duration) {
            marks.push({
                time: duration,
                label: `${duration.toFixed(1)}s`,
                left: this.timeToX(duration),
            });
        }

        return marks;
    }

    gridStepWidth(): string {
        return `${this.rulerInterval() * this.pixelsPerSecond}px`;
    }

    gridOffset(): string {
        return `${this.timePadding}px`;
    }

    setDuration(value: number | string | null) {
        const numeric = typeof value === "number" ? value : Number(value);
        if(!Number.isFinite(numeric)) {
            return;
        }
        this.animation.setDuration(numeric);
        this.animationChange.emit();
    }

    setLoop(value: boolean) {
        this.animation.setLoop(value);
        this.animationChange.emit();
    }

    toggleKey(row: TimelineRow) {
        if(row.type !== "property") {
            return;
        }

        if(this.hasKeyAtTime(row)) {
            if(this.isPathShapeRow(row)) {
                this.removePathShapeKeyframesAtCurrentTime(row.element);
            } else if(this.isGradientGroupRow(row)) {
                this.removeGradientGroupKeyframesAtCurrentTime(row);
            } else {
                this.animation.removeKeyframeAtCurrentTime(row.element, row.property.property);
            }
            this.pruneKeyframeSelection();
        } else {
            if(this.isPathShapeRow(row)) {
                this.addPathShapeKeyframesAtCurrentTime(row.element);
            } else if(this.isGradientGroupRow(row)) {
                this.addGradientGroupKeyframesAtCurrentTime(row);
            } else {
                this.animation.upsertKeyframe(row.element, row.property.property, row.property.valueType);
            }
        }

        this.animationChange.emit();
    }

    isKeyframeSelected(keyframe: TimelineKeyframe): boolean {
        if(keyframe.groupedKeyframeIds?.length) {
            return keyframe.groupedKeyframeIds.some((id) => this.selectedKeyframeIds.has(id));
        }

        return this.selectedKeyframeIds.has(keyframe.id);
    }

    selectedEasingType(): EasingType | "mixed" | undefined {
        const entries = this.selectedKeyframeEntries();
        if(entries.length === 0) {
            return undefined;
        }

        const types = new Set(entries.map((entry) => entry.keyframe.easing?.type ?? "linear"));
        return types.size === 1 ? [...types][0] : "mixed";
    }

    setSelectedEasing(type: EasingType) {
        const entries = this.selectedKeyframeEntries();
        if(entries.length === 0) {
            return;
        }

        entries.forEach((entry) => {
            entry.keyframe.easing = { type };
            entry.keyframe.temporal = undefined;
            const index = entry.track.keyframes.indexOf(entry.keyframe);
            if(index >= 0 && index + 1 < entry.track.keyframes.length) {
                const next = entry.track.keyframes[index + 1];
                if(next.temporal?.in) {
                    delete next.temporal.in;
                    if(!next.temporal.out) next.temporal = undefined;
                }
            }
        });
        this.animation.invalidate(new Set(entries.map((entry) => entry.track.id)));
        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
    }

    keyframeEasingIcon(keyframe: TimelineKeyframe): string {
        const type = this.timelineKeyframeEasingType(keyframe);
        switch(type) {
            case "ease-in":
                return "caret-left";
            case "ease-out":
                return "caret-right";
            case "ease-in-out":
                return "hourglass-half";
            case "hold":
                return "pause";
            case "linear":
            default:
                return "diamond";
        }
    }

    keyframeEasingClass(keyframe: TimelineKeyframe): string {
        const type = this.timelineKeyframeEasingType(keyframe);
        if(type === "ease-in-out") {
            return "hourglass-sideways";
        }
        return "";
    }

    beginKeyframeDrag(keyframe: TimelineKeyframe, event: PointerEvent) {
        if(event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.scrubbing = false;
        const ids = keyframe.groupedKeyframeIds?.length ? keyframe.groupedKeyframeIds : [keyframe.id];

        this.startKeyframeDrag(ids, event, (event.currentTarget as HTMLElement).closest<HTMLElement>(".timeline-lane"));
    }

    beginGraphKeyframeDrag(handle: GraphHandle, event: PointerEvent): void {
        if(event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.scrubbing = false;
        this.activeGraphHandle = handle;
        this.startKeyframeDrag(
            [handle.keyframe.id],
            event,
            (event.currentTarget as Element).closest<HTMLElement>(".speed-graph-surface"),
            true,
            true,
        );
    }

    private startKeyframeDrag(
        ids: readonly string[],
        event: PointerEvent,
        capture?: HTMLElement | null,
        preview = false,
        isolateSelection = false,
    ): void {

        if(event.shiftKey) {
            if(ids.some((id) => this.selectedKeyframeIds.has(id))) {
                ids.forEach((id) => this.selectedKeyframeIds.delete(id));
            } else {
                ids.forEach((id) => this.selectedKeyframeIds.add(id));
            }
        } else if(isolateSelection || !ids.some((id) => this.selectedKeyframeIds.has(id))) {
            this.selectedKeyframeIds.clear();
            ids.forEach((id) => this.selectedKeyframeIds.add(id));
        }

        const entries = this.selectedKeyframeEntries();
        if(entries.length === 0) {
            return;
        }

        this.keyframeDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            latestX: event.clientX,
            moved: false,
            preview,
            capture: capture ?? undefined,
            entries: entries.map((entry) => ({
                ...entry,
                startTime: entry.keyframe.time,
            })),
        };
        try { this.keyframeDrag.capture?.setPointerCapture(event.pointerId); } catch {}
        this.installGlobalPointerTracking(
            event.pointerId,
            (pointerEvent) => this.updateKeyframeDrag(pointerEvent),
            (pointerEvent) => this.zone.run(() => this.endKeyframeDrag(pointerEvent)),
        );
    }

    clearKeyframeSelection() {
        if(!this.keyframeDrag) {
            this.selectedKeyframeIds.clear();
        }
    }

    updateKeyframeDrag(event: PointerEvent) {
        if(!this.keyframeDrag || this.keyframeDrag.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        this.keyframeDrag.latestX = event.clientX;
        if(Math.abs(event.clientX - this.keyframeDrag.startX) > 2) {
            this.keyframeDrag.moved = true;
        }
        if(this.keyframeDrag.moved && this.keyframeFrame == null) {
            this.zone.runOutsideAngular(() => this.keyframeFrame = requestAnimationFrame(() => this.zone.run(() => this.applyKeyframeDragFrame())));
        }
    }

    endKeyframeDrag(event: PointerEvent) {
        if(!this.keyframeDrag || this.keyframeDrag.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const drag = this.keyframeDrag;
        if(this.keyframeFrame != null) {
            cancelAnimationFrame(this.keyframeFrame);
            this.keyframeFrame = undefined;
            this.applyKeyframeDragFrame();
        }
        const moved = drag.moved && drag.entries.some((entry) => !this.timesMatch(entry.keyframe.time, entry.startTime));
        if(moved) this.resolveKeyframeCollisions(drag.entries);
        this.keyframeDrag = undefined;
        try { drag.capture?.releasePointerCapture(event.pointerId); } catch {}
        this.clearGlobalPointerTracking();

        if(moved) {
            this.animation.invalidate(new Set(drag.entries.map((entry) => entry.track.id)));
            this.animation.previewAt(this.animation.currentTime);
            this.animationChange.emit();
        }
    }

    copySelectedKeyframes(): boolean {
        return this.editing.copy(this.editor.selectedSVG?.animation.tracks ?? []);
    }

    pasteKeyframes(): boolean {
        const svg = this.editor.selectedSVG;
        if(!svg || !this.editing.paste(
            svg.animation,
            this.animation.currentTime,
            this.editor.selectedElement,
            (element, property, sourceTargetId) => {
                const source = findAnimationTarget(svg.elements, sourceTargetId);
                return source ? matchingAnimationProperty(source, element, property) : undefined;
            },
        )) {
            return false;
        }
        this.animation.invalidate();
        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
        return true;
    }

    deleteSelectedKeyframes(): boolean {
        const svg = this.editor.selectedSVG;
        if(!svg || !this.editing.delete(svg.animation)) {
            return false;
        }
        this.animation.invalidate();
        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
        return true;
    }

    hasKeyAtTime(row: TimelineRow): boolean {
        if(row.type !== "property") {
            return false;
        }

        if(this.isPathShapeRow(row)) {
            return this.pathShapeKeyframes(row.element).some((keyframe) => this.timesMatch(keyframe.time, this.animation.currentTime));
        }
        if(this.isGradientGroupRow(row)) return this.gradientGroupKeyframes(row).some((keyframe) => this.timesMatch(keyframe.time, this.animation.currentTime));

        return this.animation.hasKeyframeAtCurrentTime(row.element, row.property.property);
    }

    previousKeyframeTime(row: TimelineRow): number | undefined {
        if(row.type !== "property") {
            return undefined;
        }

        const currentTime = this.animation.currentTime;
        return this.keyframes(row)
            .map((keyframe) => keyframe.time)
            .filter((time) => time < currentTime - 0.0005)
            .sort((a, b) => b - a)[0];
    }

    nextKeyframeTime(row: TimelineRow): number | undefined {
        if(row.type !== "property") {
            return undefined;
        }

        const currentTime = this.animation.currentTime;
        return this.keyframes(row)
            .map((keyframe) => keyframe.time)
            .filter((time) => time > currentTime + 0.0005)
            .sort((a, b) => a - b)[0];
    }

    jumpToKeyframe(row: TimelineRow, direction: "previous" | "next", event: MouseEvent) {
        event.stopPropagation();
        const time = direction === "previous"
            ? this.previousKeyframeTime(row)
            : this.nextKeyframeTime(row);

        if(time == null) {
            return;
        }

        this.animation.seek(time);
    }

    propertyValue(row: TimelineRow): unknown {
        if(row.type === "property" && this.isPathShapeRow(row)) {
            return `${this.pathShapeAnimatedPointCount(row.element)} pts`;
        }
        if(row.type === "property" && this.isGradientGeometryRow(row)) return "Canvas handles";
        if(row.type === "property" && this.isGradientStopsRow(row)) return `${this.gradientForRow(row)?.stops.length ?? 0} stops`;

        return row.type === "property"
            ? readAnimationProperty(row.element, row.property.property)
            : undefined;
    }

    propertyDisplayValue(row: TimelineRow): string {
        const value = this.propertyValue(row);
        if(typeof value === "number") {
            return Number.isInteger(value) ? String(value) : value.toFixed(2);
        }
        if(value == null) {
            return "-";
        }
        return String(value);
    }

    colorValue(row: TimelineRow): Color | null {
        const value = this.propertyValue(row);
        if(typeof value !== "string") {
            return null;
        }

        const key = this.colorRowKey(row);
        const cached = this.colorCache.get(key);
        if(cached?.source === value) {
            return cached.color;
        }

        const color = new Color(value);
        this.colorCache.set(key, { source: value, color });
        return color;
    }

    colorDisplayValue(row: TimelineRow): string {
        const value = this.propertyValue(row);
        return typeof value === "string" ? value : "none";
    }

    colorRowKey(row: TimelineRow): string {
        return row.type === "property"
            ? `${row.element.id}:${row.property.property}`
            : row.element.id;
    }

    toggleColorEditor(row: TimelineRow, event: MouseEvent | PointerEvent) {
        event.stopPropagation();
        const key = this.colorRowKey(row);
        if(this.openColorEditorKey === key) {
            this.closeColorEditor();
            return;
        }
        const gradient = this.isGradientStopsRow(row);
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        this.paintPopoverPosition = positionFloatingPopover(rect, {
            width: gradient ? 270 : 244,
            preferredHeight: gradient ? 420 : 360,
        });
        this.openColorEditorKey = key;
    }

    colorEditorOpen(row: TimelineRow): boolean {
        return this.openColorEditorKey === this.colorRowKey(row);
    }

    isGradientGeometryRow(row: TimelineRow): boolean {
        return row.type === "property" && /\.gradient\.geometry$/.test(row.property.property);
    }

    isGradientStopsRow(row: TimelineRow): boolean {
        return row.type === "property" && /\.gradient\.stops$/.test(row.property.property);
    }

    gradientForRow(row: TimelineRow): GradientPaint | undefined {
        if(row.type !== "property") return undefined;
        const match = /^settings\.(fill|stroke|color)\.gradient\./.exec(row.property.property);
        const paint = match ? (row.element.settings as Record<string, unknown>)[match[1]] : undefined;
        return isGradientPaint(paint) ? paint : undefined;
    }

    gradientPreview(gradient: GradientPaint): string {
        const stops = [...gradient.stops]
            .sort((a, b) => a.offset - b.offset)
            .map((stop) => `${stop.color.serialized} ${Math.max(0, Math.min(1, stop.offset)) * 100}%`)
            .join(", ");
        return gradient.type === "radial-gradient"
            ? `radial-gradient(circle, ${stops})`
            : `linear-gradient(90deg, ${stops})`;
    }

    paintPopoverStyle(): Record<string, string> {
        return floatingPopoverStyle(this.paintPopoverPosition);
    }

    setTimelinePaint(row: TimelineRow, change: PaintEditorChange): void {
        if(row.type !== "property") return;
        const solid = /^settings\.(fill|stroke|color)$/.exec(row.property.property);
        const gradient = /^settings\.(fill|stroke|color)\.gradient\./.exec(row.property.property);
        const key = (solid?.[1] ?? gradient?.[1]) as "fill" | "stroke" | "color" | undefined;
        if(!key) return;
        if(solid && change.type !== "solid-color") return;
        if(gradient && change.type !== "stop") return;
        if(this.paintEditing.apply(row.element, key, change)) this.animationChange.emit();
    }

    setPropertyValue(row: TimelineRow, value: unknown) {
        this.setPropertyValueInternal(row, value, true);
    }

    beginNumberDrag(row: TimelineRow, event: PointerEvent) {
        if(row.type !== "property" || row.property.valueType !== "number" || event.button !== 0) {
            return;
        }

        const startValue = Number(this.propertyValue(row));
        if(!Number.isFinite(startValue)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        const capture = event.currentTarget as HTMLInputElement;
        this.numberDrag = {
            row,
            pointerId: event.pointerId,
            startX: event.clientX,
            latestX: event.clientX,
            startValue,
            moved: false,
            step: this.numericDragStep(row.property, event),
            capture,
        };
        try { capture.setPointerCapture(event.pointerId); } catch {}
        this.installGlobalPointerTracking(
            event.pointerId,
            (pointerEvent) => this.updateNumberDrag(pointerEvent),
            (pointerEvent) => this.zone.run(() => this.endNumberDrag(pointerEvent)),
        );
    }

    updateNumberDrag(event: PointerEvent) {
        if(!this.numberDrag || this.numberDrag.pointerId !== event.pointerId) {
            return;
        }

        const deltaX = event.clientX - this.numberDrag.startX;
        if(!this.numberDrag.moved && Math.abs(deltaX) <= 3) return;
        if(!this.numberDrag.moved) this.numberDrag.capture.blur();
        this.numberDrag.moved = true;
        this.numberDrag.latestX = event.clientX;
        this.numberDrag.step = this.numericDragStep(this.numberDrag.row.property, event);
        event.preventDefault();
        event.stopPropagation();
        if(this.numberDragFrame == null) {
            this.zone.runOutsideAngular(() => this.numberDragFrame = requestAnimationFrame(() => this.zone.run(() => this.applyNumberDragFrame())));
        }
    }

    endNumberDrag(event: PointerEvent) {
        if(!this.numberDrag || this.numberDrag.pointerId !== event.pointerId) {
            return;
        }

        const drag = this.numberDrag;
        if(this.numberDragFrame != null) {
            cancelAnimationFrame(this.numberDragFrame);
            this.numberDragFrame = undefined;
            this.applyNumberDragFrame();
        }
        const moved = drag.moved;
        if(moved) event.preventDefault();
        if(moved) event.stopPropagation();
        this.numberDrag = undefined;
        try { drag.capture.releasePointerCapture(event.pointerId); } catch {}
        this.clearGlobalPointerTracking();

        if(moved) {
            this.animationChange.emit();
        } else {
            drag.capture.focus({ preventScroll: true });
            drag.capture.select();
        }
    }

    private setPropertyValueInternal(row: TimelineRow, value: unknown, emitChange: boolean) {
        if(row.type !== "property") {
            return;
        }

        const normalized = this.normalizeValue(row.property, value);
        this.animation.setAnimatedPropertyValue(row.element, row.property.property, row.property.valueType, normalized);
        if(emitChange) {
            this.animationChange.emit();
        }
    }

    beginScrub(event: PointerEvent) {
        if(event.button !== 0) return;
        event.preventDefault();
        this.scrubbing = true;
        this.scrubPointerId = event.pointerId;
        this.scrubRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        this.scrubCapture = event.currentTarget as HTMLElement;
        try { this.scrubCapture.setPointerCapture(event.pointerId); } catch {}
        this.scrubClientX = event.clientX;
        this.installGlobalPointerTracking(
            event.pointerId,
            (pointerEvent) => this.updateScrub(pointerEvent),
            (pointerEvent) => this.endScrub(pointerEvent),
        );
        this.queueScrubFrame();
    }

    updateScrub(event: PointerEvent) {
        if(!this.scrubbing || event.pointerId !== this.scrubPointerId) return;
        event.preventDefault();
        this.scrubClientX = event.clientX;
        this.queueScrubFrame();
    }

    endScrub(event: PointerEvent) {
        if(!this.scrubbing || event.pointerId !== this.scrubPointerId) return;
        this.scrubClientX = event.clientX;
        if(this.scrubFrame != null) cancelAnimationFrame(this.scrubFrame);
        this.scrubFrame = undefined;
        this.applyScrubFrame();
        this.scrubbing = false;
        this.scrubPointerId = undefined;
        this.scrubRect = undefined;
        try { this.scrubCapture?.releasePointerCapture(event.pointerId); } catch {}
        this.scrubCapture = undefined;
        this.clearGlobalPointerTracking();
    }

    beginLaneGesture(row: TimelineRow, event: PointerEvent) {
        if(event.button !== 0) {
            return;
        }

        if(!event.shiftKey) {
            this.selectedKeyframeIds.clear();
        }

        this.scrubbing = false;
        const lane = event.currentTarget as HTMLElement;
        const rect = lane.getBoundingClientRect();
        this.marquee = {
            pointerId: event.pointerId,
            lane,
            additive: event.shiftKey,
            startX: event.clientX,
            startY: event.clientY,
            currentX: event.clientX,
            currentY: event.clientY,
            active: false,
            baseSelection: new Set(this.selectedKeyframeIds),
            rect,
        };
        lane.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
    }

    updateLaneGesture(event: PointerEvent) {
        if(!this.marquee || this.marquee.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.marquee.currentX = event.clientX;
        this.marquee.currentY = event.clientY;

        const distance = Math.hypot(this.marquee.currentX - this.marquee.startX, this.marquee.currentY - this.marquee.startY);
        if(distance > 3) {
            this.marquee.active = true;
        }

        if(this.marquee.active) {
            this.updateMarqueeSelection();
        }
    }

    endLaneGesture(event: PointerEvent) {
        if(!this.marquee || this.marquee.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const marquee = this.marquee;
        this.marquee = undefined;
        try {
            marquee.lane.releasePointerCapture(event.pointerId);
        } catch {}

        if(!marquee.active) {
            this.animation.seek(this.xToTime(event.clientX - marquee.rect.left));
        }
    }

    marqueeStyle() {
        if(!this.marquee || !this.marquee.active) {
            return {};
        }

        const hostRect = this.host.nativeElement.getBoundingClientRect();
        const left = Math.min(this.marquee.startX, this.marquee.currentX) - hostRect.left;
        const top = Math.min(this.marquee.startY, this.marquee.currentY) - hostRect.top;
        const width = Math.abs(this.marquee.currentX - this.marquee.startX);
        const height = Math.abs(this.marquee.currentY - this.marquee.startY);
        return {
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
        };
    }

    beginResize(event: PointerEvent) {
        event.preventDefault();
        event.stopPropagation();
        this.resizingTimeline = true;
        this.resizeStartY = event.clientY;
        this.resizeStartHeight = this.timelineHeight;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    updateResize(event: PointerEvent) {
        if(!this.resizingTimeline) {
            return;
        }

        const delta = this.resizeStartY - event.clientY;
        this.timelineHeight = this.clampTimelineHeight(this.resizeStartHeight + delta);
    }

    endResize(event: PointerEvent) {
        if(!this.resizingTimeline) {
            return;
        }

        this.resizingTimeline = false;
        this.preferences.setTimelineHeight(this.timelineHeight);
        try {
            (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {}
    }

    closeColorEditor() {
        this.openColorEditorKey = undefined;
        this.paintPopoverPosition = undefined;
    }

    handleTimelineShortcut(event: KeyboardEvent) {
        if(event.key === "Escape" && this.keyframeDrag) {
            this.cancelKeyframeDrag();
            this.consumeShortcut(event);
            return;
        }
        if(event.key === "Escape" && this.graphDrag) {
            this.cancelGraphDrag();
            this.consumeShortcut(event);
            return;
        }
        if(this.shouldIgnoreShortcut(event)) {
            return;
        }

        const commandKey = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();

        if(commandKey && key === "c") {
            if(this.copySelectedKeyframes()) {
                this.consumeShortcut(event);
            }
            return;
        }

        if(commandKey && key === "v") {
            if(this.pasteKeyframes()) {
                this.consumeShortcut(event);
            }
            return;
        }

        if((event.key === "Delete" || event.key === "Backspace") && this.deleteSelectedKeyframes()) {
            this.consumeShortcut(event);
            return;
        }

        if((event.key === "ArrowLeft" || event.key === "ArrowRight") && this.nudgeSelectedKeyframes(event.key === "ArrowLeft" ? -1 : 1, event.shiftKey)) {
            this.consumeShortcut(event);
        }
    }

    private availableMotionPaths(element: AnyElement): Path[] {
        const svg = this.editor.selectedSVG;
        if(!svg) {
            return [];
        }

        const paths: Path[] = [];
        const collect = (elements: AnyElement[]) => {
            elements.forEach((candidate) => {
                if(candidate instanceof Path && candidate !== element && !this.elementContains(element, candidate)) {
                    paths.push(candidate);
                }

                if(candidate instanceof Group) {
                    collect(candidate.elements);
                }
            });
        };

        collect(svg.elements);
        return paths;
    }

    private rowStructureKey(elements: readonly AnyElement[]): string {
        const parts: string[] = [];
        const append = (items: readonly AnyElement[]) => items.forEach((element) => {
            const settings = element.settings as Record<string, unknown>;
            const fill = isGradientPaint(settings["fill"]) ? settings["fill"].id : "";
            const stroke = isGradientPaint(settings["stroke"]) ? settings["stroke"].id : "";
            parts.push(`${element.id}:${element.motion.pathId ?? ""}:${fill}:${stroke}`);
            if(element instanceof Group) append(element.elements);
        });
        append(elements);
        return parts.join("|");
    }

    private graphSpeedY(speed: number): number {
        const range = Math.max(1e-9, this.graphSpeedMax - this.graphSpeedMin);
        return 10 + (this.graphSpeedMax - speed) / range * Math.max(1, this.graphHeight() - 20);
    }

    private segmentSpeed(from: Keyframe, to: Keyframe, time: number): number {
        if(from.temporal?.out || to.temporal?.in) return evaluateTemporalSpeed(from, to, time);
        const duration = to.time - from.time;
        if(duration <= 0) return 0;
        const base = (Number(to.value) - Number(from.value)) / duration;
        const t = Math.max(0, Math.min(1, (time - from.time) / duration));
        switch(from.easing?.type ?? "linear") {
            case "hold": return 0;
            case "ease-in": return base * 2 * t;
            case "ease-out": return base * 2 * (1 - t);
            case "ease-in-out": return base * (t < 0.5 ? 4 * t : 4 * (1 - t));
            default: return base;
        }
    }

    private propertyLabel(property: string): string {
        return this.properties.find((definition) => definition.property === property)?.label
            ?? property.split(".").at(-1) ?? property;
    }

    private initializeGraphHandle(handle: GraphHandle): TemporalHandle {
        const from = handle.side === "out" ? handle.keyframe : handle.other;
        const to = handle.side === "out" ? handle.other : handle.keyframe;
        const preset = temporalTangentsForPreset(from.easing, Number(from.value), Number(to.value), to.time - from.time);
        from.temporal ??= { linked: true };
        to.temporal ??= { linked: true };
        from.temporal.out ??= { ...preset.out };
        to.temporal.in ??= { ...preset.in };
        const keyIndex = handle.track.keyframes.indexOf(handle.keyframe);
        if(handle.keyframe.temporal?.linked && handle.side === "out" && keyIndex > 0 && !handle.keyframe.temporal.in) {
            const previous = handle.track.keyframes[keyIndex - 1];
            const incomingPreset = temporalTangentsForPreset(previous.easing, Number(previous.value), Number(handle.keyframe.value), handle.keyframe.time - previous.time);
            handle.keyframe.temporal.in = { ...incomingPreset.in, speed: handle.keyframe.temporal.out!.speed };
        }
        if(handle.keyframe.temporal?.linked && handle.side === "in" && keyIndex >= 0 && keyIndex < handle.track.keyframes.length - 1 && !handle.keyframe.temporal.out) {
            const next = handle.track.keyframes[keyIndex + 1];
            const outgoingPreset = temporalTangentsForPreset(handle.keyframe.easing, Number(handle.keyframe.value), Number(next.value), next.time - handle.keyframe.time);
            handle.keyframe.temporal.out = { ...outgoingPreset.out, speed: handle.keyframe.temporal.in!.speed };
        }
        return handle.side === "out" ? from.temporal.out : to.temporal.in;
    }

    private linkGraphHandleSpeed(handle: GraphHandle): void {
        const temporal = handle.keyframe.temporal;
        if(!temporal?.linked) return;
        const active = temporal[handle.side];
        const opposite = handle.side === "in" ? temporal.out : temporal.in;
        if(active && opposite) opposite.speed = active.speed;
    }

    private applyGraphDragFrame(): void {
        this.graphFrame = undefined;
        const drag = this.graphDrag;
        if(!drag) return;
        const speedPerPixel = (this.graphSpeedMax - this.graphSpeedMin) / Math.max(1, this.graphHeight() - 20);
        const deltaSpeed = (drag.startY - drag.latestY) * speedPerPixel;
        const restored = new Set<Keyframe>();
        drag.snapshots.forEach((snapshot) => {
            if(restored.has(snapshot.handle.keyframe)) return;
            snapshot.handle.keyframe.temporal = this.cloneValue(snapshot.temporal);
            restored.add(snapshot.handle.keyframe);
        });
        drag.snapshots.forEach((snapshot) => {
            const value = this.initializeGraphHandle(snapshot.handle);
            const original = snapshot.temporal?.[snapshot.handle.side] ?? { speed: snapshot.handle.speed, influence: snapshot.handle.influence };
            const duration = Math.max(1e-9, Math.abs(snapshot.handle.other.time - snapshot.handle.keyframe.time));
            const direction = snapshot.handle.side === "out" ? 1 : -1;
            value.speed = original.speed + deltaSpeed;
            value.influence = Math.max(0, Math.min(1, original.influence + direction * (drag.latestX - drag.startX) / (duration * this.pixelsPerSecond)));
            this.linkGraphHandleSpeed(snapshot.handle);
        });
        this.animation.invalidate(new Set(drag.snapshots.map((snapshot) => snapshot.handle.track.id)));
        this.animation.previewAt(this.animation.currentTime);
    }

    private cancelGraphDrag(): void {
        const drag = this.graphDrag;
        if(!drag) return;
        if(this.graphFrame != null) cancelAnimationFrame(this.graphFrame);
        this.graphFrame = undefined;
        drag.snapshots.forEach((snapshot) => snapshot.handle.keyframe.temporal = this.cloneValue(snapshot.temporal));
        try { drag.capture?.releasePointerCapture(drag.pointerId); } catch {}
        this.graphDrag = undefined;
        this.clearGlobalPointerTracking();
        this.animation.invalidate(new Set(drag.snapshots.map((snapshot) => snapshot.handle.track.id)));
        this.animation.previewAt(this.animation.currentTime);
    }

    private applyKeyframeDragFrame(): void {
        this.keyframeFrame = undefined;
        const drag = this.keyframeDrag;
        if(!drag?.moved) return;
        const requestedDelta = (drag.latestX - drag.startX) / this.pixelsPerSecond;
        const deltaTime = clampKeyframeTimeDelta(drag.entries.map((entry) => entry.startTime), requestedDelta, this.animation.duration);
        drag.entries.forEach((entry) => entry.keyframe.time = this.snapTime(entry.startTime + deltaTime));
        this.sortDraggedTracks();
        if(drag.preview) {
            this.animation.invalidate(new Set(drag.entries.map((entry) => entry.track.id)));
            this.animation.previewAt(this.animation.currentTime);
        }
    }

    private cancelKeyframeDrag(): void {
        const drag = this.keyframeDrag;
        if(!drag) return;
        if(this.keyframeFrame != null) cancelAnimationFrame(this.keyframeFrame);
        this.keyframeFrame = undefined;
        drag.entries.forEach((entry) => entry.keyframe.time = entry.startTime);
        this.sortDraggedTracks();
        try { drag.capture?.releasePointerCapture(drag.pointerId); } catch {}
        this.keyframeDrag = undefined;
        this.clearGlobalPointerTracking();
        this.animation.invalidate(new Set(drag.entries.map((entry) => entry.track.id)));
        this.animation.previewAt(this.animation.currentTime);
    }

    private attachMotionPath(element: AnyElement, path: Path) {
        this.animation.invalidate();
        element.motion.pathId = path.id;
        element.motion.progress = 0;
        element.motion.offsetX = 0;
        element.motion.offsetY = 0;

        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
    }

    private detachMotionPath(element: AnyElement) {
        this.animation.invalidate();
        element.motion.pathId = null;
        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
    }

    private elementContains(parent: AnyElement, child: AnyElement): boolean {
        return parent instanceof Group && parent.elements.some((element) => {
            return element === child || this.elementContains(element, child);
        });
    }

    private propertySupported(element: AnyElement, property: AnimatablePropertyDefinition): boolean {
        if(property.property === "path.drawProgress") {
            return element instanceof Path;
        }

        if(property.property.startsWith("motion.")) {
            return !!element.motion.pathId;
        }

        if(property.property.startsWith("transform.") || property.property === "visible" || property.property === "opacity") {
            return true;
        }

        if(property.property.startsWith("settings.")) {
            if(property.property === "settings.fill" || property.property === "settings.stroke" || property.property === "settings.color") {
                return readAnimationProperty(element, property.property) !== undefined;
            }
            if(property.property.includes(".gradient.")) {
                return readAnimationProperty(element, property.property) !== undefined;
            }
            const key = property.property.slice("settings.".length);
            return key in (element.settings as Record<string, unknown>);
        }

        return readAnimationProperty(element, property.property) !== undefined;
    }

    private normalizeValue(property: AnimatablePropertyDefinition, value: unknown): unknown {
        if(property.valueType === "number") {
            const numeric = typeof value === "number" ? value : Number(value);
            if(!Number.isFinite(numeric)) {
                return value;
            }

            return property.property === "path.drawProgress"
                || property.property === "motion.progress"
                ? Math.max(0, Math.min(1, numeric))
                : numeric;
        }

        return value;
    }

    private numericDragStep(property: AnimatablePropertyDefinition, event: PointerEvent): number {
        const baseStep = this.numericBaseStep(property);
        if(event.shiftKey) {
            return baseStep * 10;
        }
        if(event.altKey || event.ctrlKey || event.metaKey) {
            return baseStep / 10;
        }
        return baseStep;
    }

    private numericBaseStep(property: AnimatablePropertyDefinition): number {
        switch(property.property) {
            case "transform.scaleX":
            case "transform.scaleY":
            case "opacity":
            case "path.drawProgress":
            case "motion.progress":
                return 0.01;
            case "transform.rotation":
            case "motion.offsetAngle":
                return 1;
            case "motion.offsetX":
            case "motion.offsetY":
                return 1;
            case "settings.stroke_width":
                return 0.25;
            default:
                return 1;
        }
    }

    private normalizeDraggedNumber(property: AnimatablePropertyDefinition, value: number): number {
        let normalized = value;
        if(property.property === "opacity" || property.property === "path.drawProgress" || property.property === "motion.progress") {
            normalized = Math.max(0, Math.min(1, normalized));
        }
        if(property.property === "settings.stroke_width") {
            normalized = Math.max(0, normalized);
        }

        const precision = this.numericBaseStep(property) < 1 ? 1000 : 100;
        return Math.round(normalized * precision) / precision;
    }

    private queueScrubFrame(): void {
        if(this.scrubFrame != null) return;
        this.zone.runOutsideAngular(() => this.scrubFrame = requestAnimationFrame(() => this.applyScrubFrame()));
    }

    private applyScrubFrame(): void {
        this.scrubFrame = undefined;
        if(!this.scrubRect) return;
        this.animation.seek(this.xToTime(this.scrubClientX - this.scrubRect.left));
    }

    private applyViewportPanFrame(): void {
        this.viewportPanFrame = undefined;
        const pan = this.viewportPan;
        if(!pan) return;
        const deltaX = pan.latestX - pan.startX;
        const deltaY = pan.latestY - pan.startY;
        pan.viewport.scrollLeft = Math.max(0, pan.startScrollLeft - deltaX);
        if(pan.graph) {
            const range = pan.startSpeedMax - pan.startSpeedMin;
            const speedDelta = deltaY * range / Math.max(1, this.graphHeight() - 20);
            this.graphSpeedMin = pan.startSpeedMin + speedDelta;
            this.graphSpeedMax = pan.startSpeedMax + speedDelta;
        } else {
            pan.viewport.scrollTop = Math.max(0, pan.startScrollTop - deltaY);
        }
    }

    private applyNumberDragFrame(): void {
        this.numberDragFrame = undefined;
        const drag = this.numberDrag;
        if(!drag?.moved) return;
        const deltaX = drag.latestX - drag.startX;
        const value = this.normalizeDraggedNumber(drag.row.property, drag.startValue + (deltaX * drag.step));
        this.setPropertyValueInternal(drag.row, value, false);
        drag.capture.value = String(value);
    }

    private installGlobalPointerTracking(
        pointerId: number,
        moveCallback: (event: PointerEvent) => void,
        endCallback: (event: PointerEvent) => void,
    ): void {
        this.clearGlobalPointerTracking();
        this.zone.runOutsideAngular(() => {
            const move = (event: PointerEvent) => { if(event.pointerId === pointerId) moveCallback(event); };
            const end = (event: PointerEvent) => { if(event.pointerId === pointerId) endCallback(event); };
            document.addEventListener("pointermove", move, { capture: true, passive: false });
            document.addEventListener("pointerup", end, true);
            document.addEventListener("pointercancel", end, true);
            this.globalPointerCleanup = () => {
                document.removeEventListener("pointermove", move, true);
                document.removeEventListener("pointerup", end, true);
                document.removeEventListener("pointercancel", end, true);
                this.globalPointerCleanup = undefined;
            };
        });
    }

    private clearGlobalPointerTracking(): void {
        this.globalPointerCleanup?.();
    }

    private graphTrackDescriptor(track: AnimationTrack, label: string, selected: boolean): GraphTrack {
        const axis = this.graphAxis(track.property);
        return {
            track,
            label,
            axis,
            selected,
            color: axis === "x" ? "#2dd4bf" : axis === "y" ? "#f59e0b" : "#a78bfa",
        };
    }

    private clampTimelineHeight(value: number): number {
        const minHeight = 190;
        const maxHeight = Math.min(720, Math.max(260, window.innerHeight * 0.68));
        return Math.round(Math.max(minHeight, Math.min(maxHeight, value)));
    }

    private timeToX(time: number): number {
        return timelineTimeToX(time, this.timePadding, this.pixelsPerSecond);
    }

    private xToTime(x: number): number {
        return timelineXToTime(x, this.timePadding, this.pixelsPerSecond);
    }

    private snapTime(time: number): number {
        return snapTimelineTime(time, this.animation.duration);
    }

    private selectedKeyframeEntries(): KeyframeEntry[] {
        return this.editing.entries(this.editor.selectedSVG?.animation.tracks ?? []);
    }

    private timelineKeyframeEasingType(keyframe: TimelineKeyframe): EasingType | "mixed" {
        if(!keyframe.groupedKeyframeIds?.length) {
            return keyframe.easing?.type ?? "linear";
        }

        const svg = this.editor.selectedSVG;
        if(!svg) {
            return "linear";
        }

        const ids = new Set(keyframe.groupedKeyframeIds);
        const types = new Set(svg.animation.tracks.flatMap((track) => {
            return track.keyframes
                .filter((candidate) => ids.has(candidate.id))
                .map((candidate) => candidate.easing?.type ?? "linear");
        }));

        return types.size === 1 ? [...types][0] : "mixed";
    }

    private sortDraggedTracks() {
        const tracks = new Set(this.keyframeDrag?.entries.map((entry) => entry.track) ?? []);
        tracks.forEach((track) => track.keyframes.sort((a, b) => a.time - b.time));
    }

    private resolveKeyframeCollisions(entries: readonly KeyframeEntry[]): void {
        const movedIds = new Set(entries.map((entry) => entry.keyframe.id));
        const tracks = new Set(entries.map((entry) => entry.track));
        tracks.forEach((track) => {
            const ordered = [
                ...track.keyframes.filter((keyframe) => !movedIds.has(keyframe.id)),
                ...entries.filter((entry) => entry.track === track).map((entry) => entry.keyframe),
            ].sort((a, b) => a.time - b.time);
            const unique: Keyframe[] = [];
            ordered.forEach((keyframe) => {
                if(unique.length && this.timesMatch(unique[unique.length - 1].time, keyframe.time)) unique[unique.length - 1] = keyframe;
                else unique.push(keyframe);
            });
            track.keyframes = unique;
        });
        this.pruneKeyframeSelection();
    }

    private nudgeSelectedKeyframes(direction: -1 | 1, largeStep: boolean): boolean {
        const entries = this.selectedKeyframeEntries();
        if(entries.length === 0) {
            return false;
        }

        const delta = direction * (largeStep ? 0.1 : 0.01);
        entries.forEach((entry) => {
            entry.keyframe.time = this.snapTime(entry.keyframe.time + delta);
        });

        const tracks = new Set(entries.map((entry) => entry.track));
        tracks.forEach((track) => track.keyframes.sort((a, b) => a.time - b.time));
        this.resolveKeyframeCollisions(entries);
        this.animation.invalidate(new Set(entries.map((entry) => entry.track.id)));
        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
        return true;
    }

    private updateMarqueeSelection() {
        const marquee = this.marquee;
        if(!marquee) {
            return;
        }

        const left = Math.min(marquee.startX, marquee.currentX);
        const right = Math.max(marquee.startX, marquee.currentX);
        const top = Math.min(marquee.startY, marquee.currentY);
        const bottom = Math.max(marquee.startY, marquee.currentY);
        const nextSelection = marquee.additive ? new Set(marquee.baseSelection) : new Set<string>();

        this.host.nativeElement.querySelectorAll<HTMLElement>(".key-diamond").forEach((diamond) => {
            const rect = diamond.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            if(centerX >= left && centerX <= right && centerY >= top && centerY <= bottom) {
                const ids = (diamond.dataset["keyframeIds"] ?? diamond.dataset["keyframeId"] ?? "")
                    .split(",")
                    .filter(Boolean);
                ids.forEach((id) => nextSelection.add(id));
            }
        });

        this.selectedKeyframeIds = nextSelection;
    }

    private isPathShapeRow(row: TimelineRow): row is PropertyTimelineRow & { element: Path } {
        return row.type === "property" && row.element instanceof Path && row.property.property === PATH_SHAPE_PROPERTY.property;
    }

    private isGradientGroupRow(row: TimelineRow): boolean {
        return row.type === "property" && (/\.gradient\.geometry$/.test(row.property.property) || /\.gradient\.stops$/.test(row.property.property));
    }

    private gradientPropertiesForRow(row: PropertyTimelineRow): AnimatablePropertyDefinition[] {
        const match = /^settings\.(fill|stroke|color)\.gradient\.(geometry|stops)$/.exec(row.property.property);
        if(!match) return [];
        const prefix = `settings.${match[1]}.gradient.`;
        return gradientAnimationProperties(row.element.settings as Record<string, unknown>).filter((property) => {
            if(!property.property.startsWith(prefix)) return false;
            return match[2] === "stops" ? property.property.includes(".stops.") : !property.property.includes(".stops.");
        });
    }

    private gradientGroupTracks(row: PropertyTimelineRow): AnimationTrack[] {
        const properties = new Set(this.gradientPropertiesForRow(row).map((property) => property.property));
        return this.editor.selectedSVG?.animation.tracks.filter((track) => track.targetId === row.element.id && properties.has(track.property)) ?? [];
    }

    private gradientGroupKeyframes(row: PropertyTimelineRow): TimelineKeyframe[] {
        const groups: TimelineKeyframe[] = [];
        this.gradientGroupTracks(row).forEach((track) => track.keyframes.forEach((keyframe) => {
            let group = groups.find((candidate) => this.timesMatch(candidate.time, keyframe.time));
            if(!group) {
                group = { id: `gradient-${row.element.id}-${row.property.property}-${keyframe.time}`, time: keyframe.time, value: row.property.label, easing: keyframe.easing, groupedKeyframeIds: [] };
                groups.push(group);
            }
            group.groupedKeyframeIds!.push(keyframe.id);
        }));
        return groups.sort((a, b) => a.time - b.time);
    }

    private removeGradientGroupKeyframesAtCurrentTime(row: PropertyTimelineRow) {
        const tracks = this.gradientGroupTracks(row);
        tracks.forEach((track) => {
            track.keyframes = track.keyframes.filter((keyframe) => !this.timesMatch(keyframe.time, this.animation.currentTime));
        });
        if(this.editor.selectedSVG) this.editor.selectedSVG.animation.tracks = this.editor.selectedSVG.animation.tracks.filter((track) => track.keyframes.length > 0);
        this.animation.invalidate(new Set(tracks.map((track) => track.id)));
        this.animation.previewAt(this.animation.currentTime);
    }

    private addGradientGroupKeyframesAtCurrentTime(row: PropertyTimelineRow) {
        this.gradientPropertiesForRow(row).forEach((property) => {
            const value = readAnimationProperty(row.element, property.property);
            this.animation.upsertKeyframe(row.element, property.property, property.valueType, value, value);
        });
    }

    private pathPointTracks(path: Path): AnimationTrack[] {
        const svg = this.editor.selectedSVG;
        if(!svg) {
            return [];
        }

        return svg.animation.tracks.filter((track) => {
            return track.targetId === path.id && !!parsePathPointProperty(track.property);
        });
    }

    private pathShapeKeyframes(element: AnyElement): TimelineKeyframe[] {
        if(!(element instanceof Path)) {
            return [];
        }

        const groups: TimelineKeyframe[] = [];
        this.pathPointTracks(element).forEach((track) => {
            track.keyframes.forEach((keyframe) => {
                let group = groups.find((candidate) => this.timesMatch(candidate.time, keyframe.time));
                if(!group) {
                    group = {
                        id: `path-shape-${element.id}-${keyframe.time}`,
                        time: keyframe.time,
                        value: "Path Shape",
                        easing: keyframe.easing,
                        groupedKeyframeIds: [],
                    };
                    groups.push(group);
                }
                group.groupedKeyframeIds!.push(keyframe.id);
            });
        });

        return groups.sort((a, b) => a.time - b.time);
    }

    private pathShapeAnimatedPointCount(element: AnyElement): number {
        if(!(element instanceof Path)) {
            return 0;
        }

        const pointIds = new Set<string>();
        this.pathPointTracks(element).forEach((track) => {
            const parsed = parsePathPointProperty(track.property);
            if(parsed) {
                pointIds.add(parsed.pointId);
            }
        });
        return pointIds.size;
    }

    private removePathShapeKeyframesAtCurrentTime(path: Path) {
        const tracks = this.pathPointTracks(path);
        tracks.forEach((track) => {
            track.keyframes = track.keyframes.filter((keyframe) => !this.timesMatch(keyframe.time, this.animation.currentTime));
        });

        if(this.editor.selectedSVG) {
            this.editor.selectedSVG.animation.tracks = this.editor.selectedSVG.animation.tracks.filter((track) => track.keyframes.length > 0);
        }

        this.animation.invalidate(new Set(tracks.map((track) => track.id)));
        this.animation.previewAt(this.animation.currentTime);
    }

    private addPathShapeKeyframesAtCurrentTime(path: Path) {
        const selected = this.editor.selectedPathAnchor && path.findPointById(this.editor.selectedPathAnchor.id)
            ? [this.editor.selectedPathAnchor]
            : path.pathPoints();

        selected.forEach((point) => {
            this.animation.upsertKeyframe(path, pathPointAnimationProperty(point.id, "x"), "number", point.x, point.x);
            this.animation.upsertKeyframe(path, pathPointAnimationProperty(point.id, "y"), "number", point.y, point.y);
        });
    }

    private ensureTimelineTrack(targetId: string, property: string, valueType: AnimationTrack["valueType"]): AnimationTrack {
        const svg = this.editor.selectedSVG;
        if(!svg) {
            throw new Error("Cannot create animation track without an active SVG");
        }

        let track = svg.animation.tracks.find((candidate) => {
            return candidate.targetId === targetId && candidate.property === property;
        });
        if(!track) {
            track = {
                id: makeAnimationId("track"),
                targetId,
                property,
                valueType,
                keyframes: [],
                enabled: true,
            };
            svg.animation.tracks.push(track);
        }
        return track;
    }

    private cloneValue<T>(value: T): T {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    private timesMatch(a: number, b: number): boolean {
        return timelineTimesMatch(a, b);
    }

    private shouldIgnoreShortcut(event: KeyboardEvent): boolean {
        if(this.openColorEditorKey) {
            return true;
        }

        const target = event.target as HTMLElement | null;
        if(!target) {
            return false;
        }

        return !!target.closest("input, textarea, select, [contenteditable='true']");
    }

    private consumeShortcut(event: KeyboardEvent) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    private pruneKeyframeSelection() {
        this.editing.prune(this.editor.selectedSVG?.animation.tracks ?? []);
    }

    private rulerInterval(): number {
        return timelineRulerInterval(this.pixelsPerSecond);
    }

    private clampTimelineScale(value: number): number {
        return clampTimelineScale(value);
    }
}

interface TimelineRulerMark {
    time: number;
    label: string;
    left: number;
}

interface TimelineKeyframe extends Keyframe {
    groupedKeyframeIds?: string[];
    summaryCount?: number;
}

interface KeyframeDragEntry extends KeyframeEntry {
    startTime: number;
}

interface KeyframeDrag {
    pointerId: number;
    startX: number;
    latestX: number;
    moved: boolean;
    preview: boolean;
    capture?: HTMLElement;
    entries: KeyframeDragEntry[];
}

interface NumberDrag {
    row: PropertyTimelineRow;
    pointerId: number;
    startX: number;
    latestX: number;
    startValue: number;
    moved: boolean;
    step: number;
    capture: HTMLInputElement;
}

interface TimelineViewportPan {
    pointerId: number;
    viewport: HTMLElement;
    startX: number;
    startY: number;
    latestX: number;
    latestY: number;
    startScrollLeft: number;
    startScrollTop: number;
    startSpeedMin: number;
    startSpeedMax: number;
    graph: boolean;
}

interface KeyframeMarquee {
    pointerId: number;
    lane: HTMLElement;
    additive: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    active: boolean;
    baseSelection: Set<string>;
    rect: DOMRect;
}

interface EasingToolbarOption {
    type: EasingType;
    label: string;
    icon: string;
    className?: string;
}

type GraphAxis = "x" | "y" | "scalar";
interface GraphTrack { track: AnimationTrack; color: string; label: string; axis: GraphAxis; selected: boolean; }

interface GraphHandle {
    track: AnimationTrack;
    keyframe: Keyframe;
    other: Keyframe;
    side: "in" | "out";
    speed: number;
    influence: number;
}

interface GraphHandleSnapshot { handle: GraphHandle; temporal?: Keyframe["temporal"]; }

interface GraphHandleDrag {
    pointerId: number;
    startX: number;
    startY: number;
    latestX: number;
    latestY: number;
    moved: boolean;
    capture?: HTMLElement;
    snapshots: GraphHandleSnapshot[];
}

function lowerBound(keys: readonly TimelineKeyframe[], time: number): number {
    let low = 0;
    let high = keys.length;
    while(low < high) {
        const middle = (low + high) >>> 1;
        if(keys[middle].time < time) low = middle + 1; else high = middle;
    }
    return low;
}
