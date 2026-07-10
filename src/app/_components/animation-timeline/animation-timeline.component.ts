import { NgClass, NgFor, NgIf, NgStyle } from "@angular/common";
import { Component, ElementRef, EventEmitter, HostBinding, HostListener, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { AnimationPlaybackService } from "src/app/_services/animation-playback.service";
import { EditorService } from "src/app/_services/editor.service";
import { EditorPreferencesService } from "src/app/_services/editor-preferences.service";
import { ColorAttribute } from "../attributes/color/color.component";
import { ANIMATABLE_PROPERTIES, AnimatablePropertyDefinition, AnimationTrack, EasingType, Keyframe, makeAnimationId } from "src/app/editor/objects/animation.object";
import { parsePathPointProperty, pathPointAnimationProperty, readAnimationProperty } from "src/app/editor/objects/animation-targets";
import { Color } from "src/app/editor/objects/color.object";
import { Group } from "src/app/editor/objects/elements/group.object";
import { Path } from "src/app/editor/objects/elements/path.object";
import { AnyElement } from "src/app/editor/objects/svg.object";
import { GradientPaint, GradientStop, gradientAnimationProperties, isGradientPaint } from "src/app/editor/objects/paint.object";
import {
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
} from "src/app/_services/timeline-editing.service";

const PATH_SHAPE_PROPERTY: AnimatablePropertyDefinition = {
    property: "path.shape",
    label: "Path Shape",
    valueType: "string",
    group: "path",
    mvp: true,
};

@Component({
    standalone: true,
    selector: "animation-timeline",
    imports: [NgFor, NgIf, NgClass, NgStyle, FormsModule, FaIconComponent, ColorAttribute],
    templateUrl: "animation-timeline.component.html",
    styleUrls: ["animation-timeline.component.scss"],
    providers: [TimelineEditingService],
})
export class AnimationTimelineComponent {
    @Output() animationChange = new EventEmitter<void>();
    @HostBinding("style.flex-basis.px") timelineHeight = 310;
    @HostBinding("class.resizing") resizingTimeline = false;
    @HostBinding("class.dragging-keyframe") get draggingKeyframe() { return !!this.keyframeDrag; }
    @HostBinding("class.dragging-number") get draggingNumber() { return !!this.numberDrag; }
    @HostBinding("class.selecting-keyframes") get selectingKeyframes() { return !!this.marquee; }

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
    get selectedKeyframeIds(): Set<string> { return this.editing.selectedKeyframeIds; }
    set selectedKeyframeIds(value: Set<string>) { this.editing.selectedKeyframeIds = value; }
    openColorEditorKey?: string;
    paintPopoverPosition?: { left: number; top: number };
    pixelsPerSecond = 120;
    private scrubbing = false;
    private resizeStartY = 0;
    private resizeStartHeight = 310;
    private keyframeDrag?: KeyframeDrag;
    private numberDrag?: NumberDrag;
    marquee?: KeyframeMarquee;
    private colorCache = new Map<string, { source: string; color: Color }>();

    constructor(
        public editor: EditorService,
        public animation: AnimationPlaybackService,
        private host: ElementRef<HTMLElement>,
        private preferences: EditorPreferencesService,
        private editing: TimelineEditingService,
    ) {
        this.timelineHeight = this.clampTimelineHeight(this.preferences.timelineHeight);
    }

    get rows(): TimelineRow[] {
        return this.editing.projectRows(
            this.editor.selectedSVG?.elements ?? [],
            this.expandedLayerIds,
            this.properties,
            (element, property) => this.propertySupported(element, property),
            PATH_SHAPE_PROPERTY,
        );
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
        if(row.type === "property") {
            const match = /^settings\.(fill|stroke)\.gradient\./.exec(row.property.property);
            if(match) this.editor.selectedGradientPaintKey = match[1] as "fill" | "stroke";
        }
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

        return this.animation.tracksForElement(row.element)
            .flatMap((track) => track.keyframes);
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
        this.pixelsPerSecond = this.clampTimelineScale(this.pixelsPerSecond + delta);
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
        });
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
        event.preventDefault();
        event.stopPropagation();
        this.scrubbing = false;
        const ids = keyframe.groupedKeyframeIds?.length ? keyframe.groupedKeyframeIds : [keyframe.id];

        if(event.shiftKey) {
            if(ids.some((id) => this.selectedKeyframeIds.has(id))) {
                ids.forEach((id) => this.selectedKeyframeIds.delete(id));
            } else {
                ids.forEach((id) => this.selectedKeyframeIds.add(id));
            }
        } else if(!ids.some((id) => this.selectedKeyframeIds.has(id))) {
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
            moved: false,
            entries: entries.map((entry) => ({
                ...entry,
                startTime: entry.keyframe.time,
            })),
        };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
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

        const deltaTime = (event.clientX - this.keyframeDrag.startX) / this.pixelsPerSecond;
        if(Math.abs(event.clientX - this.keyframeDrag.startX) > 2) {
            this.keyframeDrag.moved = true;
        }

        this.keyframeDrag.entries.forEach((entry) => {
            entry.keyframe.time = this.snapTime(entry.startTime + deltaTime);
        });
        this.sortDraggedTracks();
    }

    endKeyframeDrag(event: PointerEvent) {
        if(!this.keyframeDrag || this.keyframeDrag.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const moved = this.keyframeDrag.moved;
        this.keyframeDrag = undefined;
        try {
            (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {}

        if(moved) {
            this.animationChange.emit();
        }
    }

    copySelectedKeyframes(): boolean {
        return this.editing.copy(this.editor.selectedSVG?.animation.tracks ?? []);
    }

    pasteKeyframes(): boolean {
        const svg = this.editor.selectedSVG;
        if(!svg || !this.editing.paste(svg.animation, this.animation.currentTime)) {
            return false;
        }
        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
        return true;
    }

    deleteSelectedKeyframes(): boolean {
        const svg = this.editor.selectedSVG;
        if(!svg || !this.editing.delete(svg.animation)) {
            return false;
        }
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
        this.paintPopoverPosition = this.popoverPosition(rect, gradient ? 270 : 244, gradient ? 420 : 360);
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
        const match = /^settings\.(fill|stroke)\.gradient\./.exec(row.property.property);
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
        const position = this.paintPopoverPosition;
        return position ? { left: `${position.left}px`, top: `${position.top}px` } : {};
    }

    setTimelineGradientStop(row: TimelineRow, stop: GradientStop, field: "offset" | "color", value: unknown) {
        if(row.type !== "property") return;
        const match = /^settings\.(fill|stroke)\.gradient\./.exec(row.property.property);
        if(!match) return;
        const property = `settings.${match[1]}.gradient.stops.${stop.id}.${field}`;
        this.animation.setAnimatedPropertyValue(row.element, property, field === "color" ? "color" : "number", value);
        this.animationChange.emit();
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
        this.numberDrag = {
            row,
            pointerId: event.pointerId,
            startX: event.clientX,
            startValue,
            moved: false,
        };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    updateNumberDrag(event: PointerEvent) {
        if(!this.numberDrag || this.numberDrag.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const deltaX = event.clientX - this.numberDrag.startX;
        if(Math.abs(deltaX) > 2) {
            this.numberDrag.moved = true;
        }

        const step = this.numericDragStep(this.numberDrag.row.property, event);
        const value = this.normalizeDraggedNumber(this.numberDrag.row.property, this.numberDrag.startValue + (deltaX * step));
        this.setPropertyValueInternal(this.numberDrag.row, value, false);
    }

    endNumberDrag(event: PointerEvent) {
        if(!this.numberDrag || this.numberDrag.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const moved = this.numberDrag.moved;
        this.numberDrag = undefined;
        try {
            (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {}

        if(moved) {
            this.animationChange.emit();
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
        this.scrubbing = true;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        this.scrubToEvent(event);
    }

    updateScrub(event: PointerEvent) {
        if(this.scrubbing) {
            this.scrubToEvent(event);
        }
    }

    endScrub(event: PointerEvent) {
        this.scrubbing = false;
        try {
            (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {}
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

    @HostListener("document:click")
    closeColorEditor() {
        this.openColorEditorKey = undefined;
        this.paintPopoverPosition = undefined;
    }

    @HostListener("document:keydown", ["$event"])
    handleTimelineShortcut(event: KeyboardEvent) {
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

    private attachMotionPath(element: AnyElement, path: Path) {
        element.motion.pathId = path.id;
        element.motion.progress = 0;
        element.motion.offsetX = 0;
        element.motion.offsetY = 0;

        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
    }

    private detachMotionPath(element: AnyElement) {
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
            if(property.property === "settings.fill" || property.property === "settings.stroke") {
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

    private scrubToEvent(event: PointerEvent) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const x = event.clientX - rect.left;
        this.animation.seek(this.xToTime(x));
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
        const match = /^settings\.(fill|stroke)\.gradient\.(geometry|stops)$/.exec(row.property.property);
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
        this.gradientGroupTracks(row).forEach((track) => {
            track.keyframes = track.keyframes.filter((keyframe) => !this.timesMatch(keyframe.time, this.animation.currentTime));
        });
        if(this.editor.selectedSVG) this.editor.selectedSVG.animation.tracks = this.editor.selectedSVG.animation.tracks.filter((track) => track.keyframes.length > 0);
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
        this.pathPointTracks(path).forEach((track) => {
            track.keyframes = track.keyframes.filter((keyframe) => !this.timesMatch(keyframe.time, this.animation.currentTime));
        });

        if(this.editor.selectedSVG) {
            this.editor.selectedSVG.animation.tracks = this.editor.selectedSVG.animation.tracks.filter((track) => track.keyframes.length > 0);
        }

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

    private popoverPosition(rect: DOMRect, width: number, preferredHeight: number): { left: number; top: number } {
        const margin = 8;
        const height = Math.min(preferredHeight, window.innerHeight - margin * 2);
        const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
        const below = rect.bottom + 4;
        const top = below + height <= window.innerHeight - margin
            ? below
            : Math.max(margin, rect.top - height - 4);
        return { left, top };
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
}

interface KeyframeDragEntry extends KeyframeEntry {
    startTime: number;
}

interface KeyframeDrag {
    pointerId: number;
    startX: number;
    moved: boolean;
    entries: KeyframeDragEntry[];
}

interface NumberDrag {
    row: PropertyTimelineRow;
    pointerId: number;
    startX: number;
    startValue: number;
    moved: boolean;
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
