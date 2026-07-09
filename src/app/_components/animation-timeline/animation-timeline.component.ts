import { NgClass, NgFor, NgIf, NgStyle } from "@angular/common";
import { Component, ElementRef, EventEmitter, HostBinding, HostListener, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { AnimationPlaybackService } from "src/app/_services/animation-playback.service";
import { EditorService } from "src/app/_services/editor.service";
import { ColorAttribute } from "../attributes/color/color.component";
import { ANIMATABLE_PROPERTIES, AnimatablePropertyDefinition, AnimationTrack, Keyframe, makeAnimationId } from "src/app/editor/objects/animation.object";
import { readAnimationProperty } from "src/app/editor/objects/animation-targets";
import { Color } from "src/app/editor/objects/color.object";
import { Group } from "src/app/editor/objects/elements/group.object";
import { AnyElement } from "src/app/editor/objects/svg.object";

@Component({
    standalone: true,
    selector: "animation-timeline",
    imports: [NgFor, NgIf, NgClass, NgStyle, FormsModule, FaIconComponent, ColorAttribute],
    templateUrl: "animation-timeline.component.html",
    styleUrls: ["animation-timeline.component.scss"],
})
export class AnimationTimelineComponent {
    @Output() animationChange = new EventEmitter<void>();
    @HostBinding("style.flex-basis.px") timelineHeight = 310;
    @HostBinding("class.resizing") resizingTimeline = false;
    @HostBinding("class.dragging-keyframe") get draggingKeyframe() { return !!this.keyframeDrag; }
    @HostBinding("class.dragging-number") get draggingNumber() { return !!this.numberDrag; }
    @HostBinding("class.selecting-keyframes") get selectingKeyframes() { return !!this.marquee; }

    readonly properties = ANIMATABLE_PROPERTIES;
    readonly timePadding = 28;
    expandedLayerIds = new Set<string>();
    selectedRowKey?: string;
    selectedKeyframeIds = new Set<string>();
    openColorEditorKey?: string;
    pixelsPerSecond = 120;
    private scrubbing = false;
    private resizeStartY = 0;
    private resizeStartHeight = 310;
    private keyframeDrag?: KeyframeDrag;
    private numberDrag?: NumberDrag;
    marquee?: KeyframeMarquee;
    private keyframeClipboard: CopiedKeyframe[] = [];
    private colorCache = new Map<string, { source: string; color: Color }>();

    constructor(public editor: EditorService, public animation: AnimationPlaybackService, private host: ElementRef<HTMLElement>) {}

    get rows(): TimelineRow[] {
        const rows: TimelineRow[] = [];
        this.addRows(this.editor.selectedSVG?.elements ?? [], rows, 0);
        return rows;
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
    }

    keyframes(row: TimelineRow) {
        if(row.type === "property") {
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
            this.animation.removeKeyframeAtCurrentTime(row.element, row.property.property);
            this.pruneKeyframeSelection();
        } else {
            this.animation.upsertKeyframe(row.element, row.property.property, row.property.valueType);
        }

        this.animationChange.emit();
    }

    isKeyframeSelected(keyframe: Keyframe): boolean {
        return this.selectedKeyframeIds.has(keyframe.id);
    }

    beginKeyframeDrag(keyframe: Keyframe, event: PointerEvent) {
        event.preventDefault();
        event.stopPropagation();
        this.scrubbing = false;

        if(event.shiftKey) {
            if(this.selectedKeyframeIds.has(keyframe.id)) {
                this.selectedKeyframeIds.delete(keyframe.id);
            } else {
                this.selectedKeyframeIds.add(keyframe.id);
            }
        } else if(!this.selectedKeyframeIds.has(keyframe.id)) {
            this.selectedKeyframeIds.clear();
            this.selectedKeyframeIds.add(keyframe.id);
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
        const entries = this.selectedKeyframeEntries();
        if(entries.length === 0) {
            return false;
        }

        const earliestTime = Math.min(...entries.map((entry) => entry.keyframe.time));
        this.keyframeClipboard = entries.map((entry) => ({
            targetId: entry.track.targetId,
            property: entry.track.property,
            valueType: entry.track.valueType,
            timeOffset: entry.keyframe.time - earliestTime,
            value: this.cloneValue(entry.keyframe.value),
            easing: this.cloneValue(entry.keyframe.easing),
        }));
        return true;
    }

    pasteKeyframes(): boolean {
        const svg = this.editor.selectedSVG;
        if(!svg || this.keyframeClipboard.length === 0) {
            return false;
        }

        this.selectedKeyframeIds.clear();
        this.keyframeClipboard.forEach((copied) => {
            const track = this.ensureTimelineTrack(copied.targetId, copied.property, copied.valueType);
            const time = this.snapTime(this.animation.currentTime + copied.timeOffset);
            const existing = track.keyframes.find((keyframe) => this.timesMatch(keyframe.time, time));
            if(existing) {
                existing.value = this.cloneValue(copied.value);
                existing.easing = this.cloneValue(copied.easing);
                this.selectedKeyframeIds.add(existing.id);
            } else {
                const pasted: Keyframe = {
                    id: makeAnimationId("key"),
                    time,
                    value: this.cloneValue(copied.value),
                    easing: this.cloneValue(copied.easing),
                };
                track.keyframes.push(pasted);
                this.selectedKeyframeIds.add(pasted.id);
            }
            track.keyframes.sort((a, b) => a.time - b.time);
        });

        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
        return true;
    }

    deleteSelectedKeyframes(): boolean {
        const svg = this.editor.selectedSVG;
        if(!svg || this.selectedKeyframeIds.size === 0) {
            return false;
        }

        svg.animation.tracks.forEach((track) => {
            track.keyframes = track.keyframes.filter((keyframe) => !this.selectedKeyframeIds.has(keyframe.id));
        });
        svg.animation.tracks = svg.animation.tracks.filter((track) => track.keyframes.length > 0);
        this.selectedKeyframeIds.clear();
        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
        return true;
    }

    hasKeyAtTime(row: TimelineRow): boolean {
        return row.type === "property"
            ? this.animation.hasKeyframeAtCurrentTime(row.element, row.property.property)
            : false;
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
        this.openColorEditorKey = this.openColorEditorKey === key ? undefined : key;
    }

    colorEditorOpen(row: TimelineRow): boolean {
        return this.openColorEditorKey === this.colorRowKey(row);
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
        try {
            (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {}
    }

    @HostListener("document:click")
    closeColorEditor() {
        this.openColorEditorKey = undefined;
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

    private addRows(elements: AnyElement[], rows: TimelineRow[], depth: number) {
        [...elements].reverse().forEach((element) => {
            rows.push({ type: "layer", element, depth });
            if(this.expandedLayerIds.has(element.id)) {
                this.properties
                    .filter((property) => this.propertySupported(element, property))
                    .forEach((property) => rows.push({ type: "property", element, depth: depth + 1, property }));
            }
            if(element instanceof Group) {
                this.addRows(element.elements, rows, depth + 1);
            }
        });
    }

    private propertySupported(element: AnyElement, property: AnimatablePropertyDefinition): boolean {
        if(property.property.startsWith("transform.") || property.property === "visible" || property.property === "opacity") {
            return true;
        }

        if(property.property.startsWith("settings.")) {
            const key = property.property.slice("settings.".length);
            return key in (element.settings as Record<string, unknown>);
        }

        return readAnimationProperty(element, property.property) !== undefined;
    }

    private normalizeValue(property: AnimatablePropertyDefinition, value: unknown): unknown {
        if(property.valueType === "number") {
            const numeric = typeof value === "number" ? value : Number(value);
            return Number.isFinite(numeric) ? numeric : value;
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
                return 0.01;
            case "transform.rotation":
                return 1;
            case "settings.stroke_width":
                return 0.25;
            default:
                return 1;
        }
    }

    private normalizeDraggedNumber(property: AnimatablePropertyDefinition, value: number): number {
        let normalized = value;
        if(property.property === "opacity") {
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
        return this.timePadding + (Math.max(0, time) * this.pixelsPerSecond);
    }

    private xToTime(x: number): number {
        return Math.max(0, (x - this.timePadding) / this.pixelsPerSecond);
    }

    private snapTime(time: number): number {
        const clamped = Math.max(0, Math.min(this.animation.duration, time));
        return Math.round(clamped * 100) / 100;
    }

    private selectedKeyframeEntries(): KeyframeEntry[] {
        const svg = this.editor.selectedSVG;
        if(!svg || this.selectedKeyframeIds.size === 0) {
            return [];
        }

        return svg.animation.tracks.flatMap((track) => {
            return track.keyframes
                .filter((keyframe) => this.selectedKeyframeIds.has(keyframe.id))
                .map((keyframe) => ({ track, keyframe }));
        });
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
                const id = diamond.dataset["keyframeId"];
                if(id) {
                    nextSelection.add(id);
                }
            }
        });

        this.selectedKeyframeIds = nextSelection;
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
        return Math.abs(a - b) < 0.0005;
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
        const svg = this.editor.selectedSVG;
        if(!svg || this.selectedKeyframeIds.size === 0) {
            return;
        }

        const activeIds = new Set(svg.animation.tracks.flatMap((track) => track.keyframes.map((keyframe) => keyframe.id)));
        this.selectedKeyframeIds.forEach((id) => {
            if(!activeIds.has(id)) {
                this.selectedKeyframeIds.delete(id);
            }
        });
    }

    private rulerInterval(): number {
        if(this.pixelsPerSecond >= 220) {
            return 0.25;
        }
        if(this.pixelsPerSecond >= 120) {
            return 0.5;
        }
        if(this.pixelsPerSecond >= 70) {
            return 1;
        }
        return 2;
    }

    private clampTimelineScale(value: number): number {
        return Math.round(Math.max(40, Math.min(360, value)));
    }
}

type TimelineRow = LayerTimelineRow | PropertyTimelineRow;
type LayerTimelineRow = { type: "layer"; element: AnyElement; depth: number };
type PropertyTimelineRow = { type: "property"; element: AnyElement; depth: number; property: AnimatablePropertyDefinition };

interface TimelineRulerMark {
    time: number;
    label: string;
    left: number;
}

interface KeyframeEntry {
    track: AnimationTrack;
    keyframe: Keyframe;
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

interface CopiedKeyframe {
    targetId: string;
    property: string;
    valueType: AnimationTrack["valueType"];
    timeOffset: number;
    value: unknown;
    easing: Keyframe["easing"];
}
