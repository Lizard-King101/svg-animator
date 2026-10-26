import { adjacentKeyTime, filterTimelineHierarchy } from '../editor/animation/timeline-navigation';
import { planKeyframeRetime, RetimeOperation, RetimePlan } from '../editor/animation/keyframe-retiming';
import { loopEndpoints, syncLoopSeam } from '../editor/animation/loop-seam';
import { AnimationInspectionService } from './animation-inspection.service';
import { ChangeDetectorRef, ElementRef, EventEmitter, Injectable, NgZone, OnDestroy, Optional } from "@angular/core";
import { AnimationPlaybackService } from "src/app/_services/animation-playback.service";
import { EditorService } from "src/app/_services/editor.service";
import { EditorPreferencesService } from "src/app/_services/editor-preferences.service";
import { ANIMATABLE_PROPERTIES, AnimatablePropertyDefinition, AnimationDocument, AnimationTrack, applyEasingPresetToSelection, EasingType, evaluateTemporalSpeed, Keyframe, makeAnimationId, temporalTangentsForPreset, TemporalHandle } from "src/app/editor/objects/animation.object";
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
import { IconProp } from "@fortawesome/fontawesome-svg-core";
import { keyframeEasingIcon } from "src/app/_components/animation-timeline/keyframe-easing-icons";
import { isEditableEventTarget } from "src/app/editor/editable-event-target";
import { RigEditingService } from './rig-editing.service';
import { parseRigAnimationProperty, readDocumentAnimationProperty, rigAnimationProperty } from '../editor/rig-animation';
import {
    clampKeyframeTimeDelta,
    clampTimelineScale,
    KeyframeEntry,
    PropertyTimelineRow,
    NumericTimelineRow,
    RigPropertyTimelineRow,
    timelineRowTargetId,
    timelineRowId,
    rigTimelineProperties,
    rigBoneBranchIds,
    snapKeyframeTimeDelta,
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

const UNIFORM_SCALE_PROPERTY: AnimatablePropertyDefinition = {
    property: "transform.scale",
    label: "Scale",
    valueType: "number",
    group: "transform",
    mvp: true,
};

const TIMELINE_ROW_HEIGHT = 30;
const TIMELINE_VIRTUALIZATION_THRESHOLD = 120;
const TIMELINE_VIRTUAL_OVERSCAN = 8;
const KEYFRAME_PLAYHEAD_SNAP_PX = 8;

@Injectable()
export class TimelineEditorService implements OnDestroy {
    animationChange = new EventEmitter<void>();
    timelineHeight = 310;
    resizingTimeline = false;
    get draggingKeyframe() { return !!this.keyframeDrag; }
    get draggingNumber() { return !!this.numberDrag; }
    get selectingKeyframes() { return !!this.marquee; }
    get panningTimeline() { return !!this.viewportPan; }

    readonly properties = ANIMATABLE_PROPERTIES.flatMap((property) => property.property === "transform.scaleX"
        ? [UNIFORM_SCALE_PROPERTY, property]
        : [property]);
    readonly easingOptions: readonly EasingToolbarOption[] = [
        { type: "linear", label: "Linear", icon: keyframeEasingIcon("linear") },
        { type: "ease-in", label: "Ease In · start slowly after selected keyframe", icon: keyframeEasingIcon("ease-in") },
        { type: "ease-out", label: "Ease Out · stop smoothly at selected keyframe", icon: keyframeEasingIcon("ease-out") },
        { type: "ease-in-out", label: "Ease In Out · smooth both selected boundaries", icon: keyframeEasingIcon("ease-in-out") },
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
    rowSearch = '';
    selectedRowsOnly = false;
    animatedRowsOnly = false;
    private navigationFrame?: number;
    get filteringRows(): boolean { return !!this.rowSearch.trim() || this.selectedRowsOnly || this.animatedRowsOnly; }
    pixelsPerSecond = 120;
    surfaceMode: "timeline" | "graph" = "timeline";
    graphSpeedMin = -1;
    graphSpeedMax = 1;
    private activeHandleRef?: { animation: AnimationDocument; trackId: string; keyId: string; side: 'in' | 'out' };
    get activeGraphHandle(): GraphHandle | undefined {
        const ref = this.activeHandleRef;
        if(!ref || ref.animation !== this.activeAnimation) return undefined;
        const track = this.graphTracks().find(item => item.track.id === ref.trackId)?.track;
        return track && this.graphHandles(track).find(handle => handle.keyframe.id === ref.keyId && handle.side === ref.side);
    }
    set activeGraphHandle(handle: GraphHandle | undefined) {
        this.activeHandleRef = handle && this.activeAnimation ? { animation: this.activeAnimation,
            trackId: handle.track.id, keyId: handle.keyframe.id, side: handle.side } : undefined;
    }
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
    private workAreaDrag?: WorkAreaDrag;
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
    private scaleLinkOverrides = new Map<string, boolean>();
    private timeDomainCache?: { documentId: string; revision: number; duration: number; start: number; end: number };
    private historyRestoreSubscription: Subscription;
    private contextSubscription?: Subscription;
    get activeAnimation() { return this.animation.activeAnimation ?? this.editor.selectedSVG?.animation; }

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
        @Optional() public rig?: RigEditingService,
        @Optional() public inspection?: AnimationInspectionService,
    ) {
        this.contextSubscription = this.animation.contextChanging?.subscribe(reason => {
            if(reason !== 'seek') this.cancelContextGestures(); else this.cancelNumberDrag();
            this.cancelKeyframeDrag(); this.cancelGraphDrag(); this.closeColorEditor();
            if(!reason) {
                this.activeGraphHandle = undefined;
                this.selectedGraphHandleKeys.clear();
                this.selectedKeyframeIds = new Set(); this.selectedGraphTargetId = undefined;
                this.rowCacheKey = ''; this.layerSummaryCache.clear(); this.speedCurveCache.clear(); this.colorCache.clear();
            }
            this.changeDetector.markForCheck();
        });
        this.timelineHeight = this.clampTimelineHeight(this.preferences.timelineHeight);
        this.historyRestoreSubscription = this.mutations.historyRestored.subscribe(() => {
            this.cancelNumberDrag(false);
            this.cancelGraphDrag(false);
            this.cancelKeyframeDrag();
            this.activeGraphHandle = undefined;
            this.selectedGraphHandleKeys.clear();
            this.rowCacheKey = "";
            this.layerSummaryCache.clear();
            this.speedCurveCache.clear();
            this.colorCache.clear();
            this.scaleLinkOverrides.clear();
            this.changeDetector.markForCheck();
        });
    }

    ngOnDestroy(): void {
        if(this.navigationFrame != null) cancelAnimationFrame(this.navigationFrame);
        this.cancelGraphDrag();
        this.cancelKeyframeDrag();
        this.cancelNumberDrag();
        this.historyRestoreSubscription.unsubscribe();
        this.contextSubscription?.unsubscribe();
        this.clearGlobalPointerTracking();
        if(this.graphFrame != null) cancelAnimationFrame(this.graphFrame);
        if(this.keyframeFrame != null) cancelAnimationFrame(this.keyframeFrame);
        if(this.viewportPanFrame != null) cancelAnimationFrame(this.viewportPanFrame);
        if(this.numberDragFrame != null) cancelAnimationFrame(this.numberDragFrame);
        if(this.scrubFrame != null) cancelAnimationFrame(this.scrubFrame);
    }

    private cancelContextGestures(): void {
        this.cancelNumberDrag();
        const area = this.workAreaDrag;
        if(area) {
            this.animation.setWorkArea(area.start, area.end);
            try { area.capture.releasePointerCapture(area.pointerId); } catch {}
            this.workAreaDrag = undefined;
        }
        this.cancelScrub();
        this.marquee = undefined;
        this.clearGlobalPointerTracking();
    }

    get rows(): TimelineRow[] {
        const elements = this.editor.selectedSVG?.elements ?? [];
        const rigs = this.editor.selectedSVG?.rigs.armatures ?? [];
        const rigKey = rigs.map(rig => `${rig.id}:${rig.name}:${rig.bones.map(bone => `${bone.id}:${bone.parentId}:${bone.name}`).join(',')}`).join('|');
        const scope = this.selectionScope();
        const filterKey = JSON.stringify([this.rowSearch, this.selectedRowsOnly, this.animatedRowsOnly, [...scope.targets], [...scope.bones]]);
        const expanded = this.filteringRows ? this.allExpandedIds() : this.expandedLayerIds;
        const cacheKey = `${this.editor.selectedSVG?.id ?? ""}|${this.animation.revision}|${[...expanded].sort().join(",")}|${this.rowStructureKey(elements)}|${rigKey}|${filterKey}`;
        if(cacheKey === this.rowCacheKey) return this.rowCache;
        this.rowCacheKey = cacheKey;
        this.rowCache = [...this.editing.projectRigRows(rigs.filter(rig => !this.animation.allowsTarget || this.animation.allowsTarget(rig.id)), expanded), ...this.editing.projectRows(
            elements,
            expanded,
            this.properties,
            (element, property) => this.propertySupported(element, property),
            PATH_SHAPE_PROPERTY,
        ).filter(row => row.type === 'layer' || !this.animation.allowsTarget || this.animation.allowsTarget(row.element.id))];
        if(this.filteringRows) {
            const query = this.rowSearch.trim().toLocaleLowerCase();
            this.rowCache = filterTimelineHierarchy(this.rowCache, (row, ancestors) => {
                if(this.selectedRowsOnly && !this.rowInScope(row, scope)) return false;
                if(this.animatedRowsOnly && (!('property' in row) || !this.keyframes(row).length)) return false;
                return !query || [...ancestors, row].some(item => this.rowLabel(item).toLocaleLowerCase().includes(query));
            });
        }
        this.virtualStart = Math.min(this.virtualStart, Math.max(0, this.rowCache.length - this.virtualCount));
        return this.rowCache;
    }

    setRowFilters(search: string, selected: boolean, animated: boolean): void {
        this.cancelContextGestures(); this.cancelGraphDrag(); this.cancelKeyframeDrag();
        this.closeColorEditor(); this.activeGraphHandle = undefined; this.selectedGraphHandleKeys.clear();
        this.selectedKeyframeIds.clear();
        this.rowSearch = search; this.selectedRowsOnly = selected; this.animatedRowsOnly = animated;
        this.virtualStart = 0; this.rowCacheKey = '';
        this.host.nativeElement.querySelectorAll<HTMLElement>('.timeline-table, .graph-layer-scroll').forEach(view => view.scrollTop = 0);
    }

    private allExpandedIds(): Set<string> {
        const ids = new Set<string>();
        for(const element of this.editor.selectedSVG?.elements ?? []) this.summaryElements(element).forEach(item => ids.add(item.id));
        for(const rig of this.editor.selectedSVG?.rigs.armatures ?? []) {
            ids.add(rig.id); rig.bones.forEach(bone => ids.add(`${rig.id}:${bone.id}`));
        }
        return ids;
    }

    private selectionScope(): { targets: Set<string>; bones: Set<string> } {
        const targets = new Set((this.editor.selectedElements ?? []).flatMap(element => this.summaryElements(element).map(item => item.id)));
        const bones = new Set<string>();
        if(!targets.size && this.rig?.active) {
            targets.add(this.rig.active.id);
            if(this.rig.boneId) {
                rigBoneBranchIds(this.rig.active, this.rig.boneId).forEach(id => bones.add(id));
            }
        }
        return { targets, bones };
    }

    private rowInScope(row: TimelineRow, scope = this.selectionScope()): boolean {
        return scope.targets.has(timelineRowTargetId(row)) && (!('bone' in row) || !scope.bones.size || scope.bones.has(row.bone.id));
    }

    revealSelection(): void {
        const scope = this.selectionScope();
        if(!scope.targets.size) return;
        this.setRowFilters('', false, false);
        const fullyExpanded = this.allExpandedIds();
        // Expand only the selected branches and their ancestors; preserve unrelated expansion.
        const rows = [...this.editing.projectRigRows(this.editor.selectedSVG?.rigs.armatures ?? [], fullyExpanded),
            ...this.editing.projectRows(this.editor.selectedSVG?.elements ?? [], fullyExpanded, [], () => false, PATH_SHAPE_PROPERTY)];
        filterTimelineHierarchy(rows, row => this.rowInScope(row, scope)).forEach(row => this.expandedLayerIds.add(timelineRowId(row)));
        this.rowCacheKey = '';
        const index = this.rows.findIndex(row => this.rowInScope(row, scope) && (!scope.bones.size || 'bone' in row));
        if(index < 0) return;
        const viewport = this.host.nativeElement.querySelector<HTMLElement>(this.surfaceMode === 'graph' ? '.graph-layer-scroll' : '.timeline-table');
        if(!viewport) return;
        const header = this.surfaceMode === 'graph' || this.animation.activeAction ? 0
            : (this.editor.selectedSVG?.animation.composition?.placements.length ?? 0) * this.placementRowHeight;
        this.updateLayerWindow(index * TIMELINE_ROW_HEIGHT, viewport.clientHeight);
        this.afterNavigationLayout(() => viewport.scrollTop = header + index * TIMELINE_ROW_HEIGHT);
    }

    private navigationTracks(): AnimationTrack[] {
        this.pruneFilteredKeySelection();
        const tracks = (this.activeAnimation?.tracks ?? []).filter(track => track.enabled !== false && (!this.animation.allowsTarget || this.animation.allowsTarget(track.targetId)));
        const selected = tracks.filter(track => track.keyframes.some(key => this.selectedKeyframeIds.has(key.id)));
        if(selected.length) return selected;
        const scope = this.selectionScope();
        return scope.targets.size ? tracks.filter(track => scope.targets.has(track.targetId)
            && (!scope.bones.size || scope.bones.has(parseRigAnimationProperty(track.property)?.boneId ?? ''))) : tracks;
    }

    adjacentPoseTime(direction: -1 | 1): number | undefined {
        return adjacentKeyTime(this.navigationTracks().flatMap(track => track.keyframes.map(key => key.time))
            .filter(time => time >= 0 && time <= this.animation.duration), this.animation.currentTime, direction);
    }

    jumpToPose(direction: -1 | 1): void {
        const time = this.adjacentPoseTime(direction);
        if(time == null) return;
        this.animation.pause?.(); this.animation.seek(time);
    }

    get canFitSelectedKeys(): boolean { return this.selectedKeyframeEntries().length > 0; }

    get retimeSelection(): { count: number; start: number; end: number; signature: string } {
        const entries = this.selectedKeyframeEntries();
        const times = entries.map(entry => entry.keyframe.time);
        return { count: entries.length, start: times.length ? Math.min(...times) : 0, end: times.length ? Math.max(...times) : 0,
            signature: JSON.stringify(entries.map(({ track, keyframe }) => [track.id, keyframe.id, keyframe.time])) };
    }

    planSelectedKeyRetime(operation: RetimeOperation): RetimePlan {
        this.pruneFilteredKeySelection();
        return planKeyframeRetime(this.activeAnimation?.tracks ?? [], this.selectedKeyframeIds, operation);
    }

    retimeSelectedKeys(operation: RetimeOperation): boolean {
        this.cancelContextGestures(); this.cancelGraphDrag(); this.cancelKeyframeDrag();
        const plan = this.planSelectedKeyRetime(operation);
        if(plan.problem) { this.animation.contextMessage = plan.problem; return false; }
        if(!plan.updates.length) return false;
        this.animation.pause?.();
        // Preserve key identities and route the single completion through the timeline's mutation boundary.
        plan.updates.forEach(({ track, keyframes }) => {
            const byId = new Map(track.keyframes.map(key => [key.id, key]));
            track.keyframes = keyframes.map(key => Object.assign(byId.get(key.id)!, key));
        });
        this.activeGraphHandle = undefined; this.selectedGraphHandleKeys.clear();
        this.speedCurveCache.clear(); this.layerSummaryCache.clear();
        this.animation.invalidate(plan.updates.map(update => update.track.id));
        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
        this.changeDetector.markForCheck();
        return true;
    }
    fitSelectedKeys(): void {
        const times = this.selectedKeyframeEntries().map(entry => entry.keyframe.time);
        if(times.length) this.fitTimeRange(Math.min(...times), Math.max(...times));
    }
    fitWorkArea(): void { this.fitTimeRange(this.animation.workArea.start, this.animation.workArea.end); }

    private fitTimeRange(start: number, end: number): void {
        const viewport = this.host.nativeElement.querySelector<HTMLElement>('.timeline-table, .graph-time-pane');
        const layerWidth = viewport?.classList.contains('timeline-table') ? 360 : 0;
        const width = Math.max(100, (viewport?.clientWidth ?? 600) - layerWidth);
        const span = Math.max(.5, end - start);
        this.pixelsPerSecond = this.clampTimelineScale((width - this.timePadding * 2) / span);
        if(viewport) this.afterNavigationLayout(() => {
            viewport.scrollLeft = Math.max(0, this.timeToX((start + end) / 2) - width / 2);
            this.updateVisibleTime(viewport.scrollLeft, viewport.clientWidth, layerWidth);
        });
    }
    private afterNavigationLayout(callback: () => void): void {
        if(this.navigationFrame != null) cancelAnimationFrame(this.navigationFrame);
        this.navigationFrame = requestAnimationFrame(() => { this.navigationFrame = undefined; callback(); this.changeDetector.markForCheck(); });
    }

    trackRow(_index: number, row: TimelineRow): string {
        return 'property' in row ? `property:${timelineRowTargetId(row)}:${row.property.property}` : `${row.type}:${timelineRowId(row)}`;
    }

    isPropertyRow(row: TimelineRow): row is NumericTimelineRow { return 'property' in row; }
    rowExpanded(row: TimelineRow): boolean { return this.filteringRows || this.expandedLayerIds.has(timelineRowId(row)); }
    toggleRow(row: TimelineRow): void {
        if(this.filteringRows) return;
        const id = timelineRowId(row);
        if(this.expandedLayerIds.has(id)) this.expandedLayerIds.delete(id); else this.expandedLayerIds.add(id);
    }
    rowLabel(row: TimelineRow): string { return 'property' in row ? row.property.label : row.type === 'rig' ? row.rig.name : row.type === 'bone' ? row.bone.name : row.element.name; }
    rowSelected(row: TimelineRow): boolean { return 'rig' in row ? this.rig?.activeId === row.rig.id && (row.type === 'rig' || this.rig?.boneId === row.bone.id) : this.editor.selectedElements.includes(row.element); }
    rowDisabledReason(row: TimelineRow): string {
        if(row.type !== 'rig-property') return '';
        if(this.animation.playing) return 'Pause playback to edit pose keys.';
        const constraint = row.rig.constraints?.find(item => item.enabled && [item.upperBoneId, item.lowerBoneId].includes(row.bone.id));
        return constraint ? `Posed by IK. Animate ${row.rig.bones.find(bone => bone.id === constraint.targetBoneId)?.name ?? 'the target'} instead.` : '';
    }
    rowLoopLabel(row: TimelineRow): string {
        if(!('property' in row)) return '';
        const property = row.property.property === 'transform.scale' ? 'transform.scaleX' : row.property.property;
        const track = this.activeAnimation?.tracks.find(track => track.targetId === timelineRowTargetId(row) && track.property === property);
        const seam = track && loopEndpoints(track);
        return seam ? `Linked loop endpoints: ${seam.start.time}–${seam.end.time}s${track!.loopSeam?.smooth ? ', matching seam speed' : ''}` : '';
    }

    private rowTrack(row: NumericTimelineRow, property = row.property.property): AnimationTrack | undefined {
        return this.activeAnimation?.tracks.find(track => track.targetId === timelineRowTargetId(row) && track.property === property);
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
        this.cancelGraphDrag();
        this.activeGraphHandle = undefined;
        this.selectedGraphHandleKeys.clear();
        if('rig' in row) {
            this.editor.selectedElements = [];
            if(row.type === 'rig') this.rig?.select(row.rig.id); else this.rig?.selectBone(row.rig.id, row.bone.id);
            if(row.type === 'rig-property') {
                this.selectedRowKey = `${row.rig.id}:${row.property.property}`;
                this.selectedGraphTargetId = row.rig.id; this.selectedGraphProperty = row.property.property;
            } else {
                const track = this.rigRowTracks(row)[0];
                if(track) { this.selectedGraphTargetId = row.rig.id; this.selectedGraphProperty = track.property; }
            }
            if(this.surfaceMode === 'graph') this.fitSpeed();
            return;
        }
        this.selectLayer(row.element);
        if(row.type === "layer" && this.surfaceMode === "graph") {
            const first = this.animation.tracksForElement(row.element).find((track) => track.valueType === "number");
            if(first) {
                this.selectedGraphTargetId = row.element.id;
                this.selectedGraphProperty = (first.property === "transform.scaleX" || first.property === "transform.scaleY")
                    && this.elementScaleLinked(row.element) ? UNIFORM_SCALE_PROPERTY.property : first.property;
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
        if(row.type === 'rig-property') return this.rowTrack(row)?.keyframes ?? [];
        if(row.type === 'rig' || row.type === 'bone') {
            if(this.rowExpanded(row)) return [];
            const summaries: TimelineKeyframe[] = [];
            this.rigRowTracks(row).flatMap(track => track.keyframes).sort((a,b) => a.time - b.time).forEach(key => {
                const previous = summaries.at(-1);
                if(previous && this.timesMatch(previous.time, key.time)) previous.summaryCount = (previous.summaryCount ?? 1) + 1;
                else summaries.push({ id: `summary:${timelineRowId(row)}:${key.time}`, time: key.time, value: undefined, summaryCount: 1 });
            });
            return summaries;
        }
        if(row.type === "property") {
            if(this.isUniformScaleRow(row)) return this.uniformScaleKeyframes(row.element);
            if(this.isPathShapeRow(row)) {
                return this.pathShapeKeyframes(row.element);
            }
            if(this.isGradientGroupRow(row)) return this.gradientGroupKeyframes(row);

            return this.animation.trackFor(row.element, row.property.property)?.keyframes ?? [];
        }

        if(this.rowExpanded(row)) return [];
        const cacheKey = `${this.editor.selectedSVG?.id ?? ""}:${row.element.id}`;
        const cached = this.layerSummaryCache.get(cacheKey);
        if(cached?.revision === this.animation.revision) return cached.keyframes;
        const summaries: TimelineKeyframe[] = [];
        this.summaryElements(row.element)
            .flatMap((element) => this.animation.tracksForElement(element))
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

    private rigRowTracks(row: Extract<TimelineRow, {type: 'rig' | 'bone'}>): AnimationTrack[] {
        const ids = rigBoneBranchIds(row.rig, row.type === 'bone' ? row.bone.id : undefined);
        return this.activeAnimation?.tracks.filter(track => track.targetId === row.rig.id && ids.has(parseRigAnimationProperty(track.property)?.boneId ?? '')) ?? [];
    }

    private summaryElements(element: AnyElement): AnyElement[] {
        return element instanceof Group
            ? [element, ...element.elements.flatMap((child) => this.summaryElements(child))]
            : [element];
    }

    get visibleRows(): TimelineRow[] {
        const rows = this.rows;
        if(!this.timelineVirtualized) return rows;
        return rows.slice(this.virtualStart, Math.min(rows.length, this.virtualStart + this.virtualCount));
    }

    private get timelineVirtualized(): boolean { return this.rows.length > TIMELINE_VIRTUALIZATION_THRESHOLD; }

    get virtualTopHeight(): number { return this.timelineVirtualized ? this.virtualStart * TIMELINE_ROW_HEIGHT : 0; }
    get virtualBottomHeight(): number {
        return this.timelineVirtualized
            ? Math.max(0, (this.rows.length - this.virtualStart - this.visibleRows.length) * TIMELINE_ROW_HEIGHT)
            : 0;
    }

    readonly placementRowHeight = 64;
    get placementGridRows(): string {
        const count = this.animation.activeAction ? 0 : this.editor.selectedSVG?.animation.composition?.placements.length ?? 0;
        return count ? '30px repeat(' + count + ', ' + this.placementRowHeight + 'px)' : '30px';
    }

    updateTimelineViewport(event: Event): void {
        const viewport = event.currentTarget as HTMLElement;
        const header = 30 + (this.animation.activeAction ? 0 : (this.editor.selectedSVG?.animation.composition?.placements.length ?? 0) * this.placementRowHeight);
        this.updateLayerWindow(Math.max(0, viewport.scrollTop - header), Math.max(0, viewport.clientHeight - Math.max(0, header - viewport.scrollTop)));
        this.updateVisibleTime(viewport.scrollLeft, viewport.clientWidth, 360);
    }

    updateLayerViewport(event: Event): void {
        const viewport = event.currentTarget as HTMLElement;
        this.updateLayerWindow(viewport.scrollTop, viewport.clientHeight);
    }

    updateGraphViewport(event: Event): void {
        const viewport = event.currentTarget as HTMLElement;
        this.updateVisibleTime(viewport.scrollLeft, viewport.clientWidth, 0);
    }

    private updateLayerWindow(scrollTop: number, clientHeight: number): void {
        const nextCount = Math.max(40, Math.ceil(Math.max(0, clientHeight) / TIMELINE_ROW_HEIGHT) + TIMELINE_VIRTUAL_OVERSCAN * 2);
        const rowStart = Math.max(0, Math.floor(scrollTop / TIMELINE_ROW_HEIGHT) - TIMELINE_VIRTUAL_OVERSCAN);
        this.virtualCount = nextCount;
        this.virtualStart = this.timelineVirtualized
            ? Math.min(rowStart, Math.max(0, this.rows.length - nextCount))
            : 0;
    }

    private updateVisibleTime(scrollLeft: number, clientWidth: number, layerWidth: number): void {
        const timelineLeft = Math.max(0, scrollLeft - layerWidth - this.timePadding);
        this.visibleTimeStart = this.timeDomainStart + timelineLeft / this.pixelsPerSecond - 0.5;
        this.visibleTimeEnd = this.timeDomainStart + (timelineLeft + clientWidth + layerWidth) / this.pixelsPerSecond + 0.5;
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
        this.virtualStart = 0;
        if(mode === "graph") {
            if(!this.selectedNumericRow()) {
                const first = this.rows.find((row): row is NumericTimelineRow => 'property' in row && row.property.valueType === "number"
                    && !!this.rowTrack(row));
                if(first) this.selectedRowKey = `${timelineRowTargetId(first)}:${first.property.property}`;
                if(first) {
                    this.selectedGraphTargetId = timelineRowTargetId(first);
                    this.selectedGraphProperty = first.property.property;
                } else {
                    const track = this.activeAnimation?.tracks.find((candidate) => candidate.valueType === "number");
                    if(track) {
                        this.selectedGraphTargetId = track.targetId;
                        const element = findAnimationTarget(this.editor.selectedSVG?.elements ?? [], track.targetId);
                        this.selectedGraphProperty = element && (track.property === "transform.scaleX" || track.property === "transform.scaleY")
                            && this.elementScaleLinked(element) ? UNIFORM_SCALE_PROPERTY.property : track.property;
                    }
                }
            }
            this.fitSpeed();
        }
    }

    selectedNumericRow(): NumericTimelineRow | undefined {
        const direct = this.rows.find((row): row is NumericTimelineRow => 'property' in row
            && row.property.valueType === "number"
            && timelineRowTargetId(row) === this.selectedGraphTargetId
            && row.property.property === this.selectedGraphProperty);
        if(direct) return direct;
        const rig = this.editor.selectedSVG?.rigs.armatures.find(rig => rig.id === this.selectedGraphTargetId);
        const parsed = parseRigAnimationProperty(this.selectedGraphProperty ?? '');
        const bone = parsed && rig?.bones.find(bone => bone.id === parsed.boneId);
        if(rig && bone) return { type: 'rig-property', rig, bone, depth: 1, property: rigTimelineProperties(bone).find(property => property.property === this.selectedGraphProperty)! };
        const element = findAnimationTarget(this.editor.selectedSVG?.elements ?? [], this.selectedGraphTargetId ?? "");
        const track = this.activeAnimation?.tracks.find((candidate) => candidate.targetId === this.selectedGraphTargetId
            && candidate.property === this.selectedGraphProperty && candidate.valueType === "number");
        if(element && this.selectedGraphProperty === UNIFORM_SCALE_PROPERTY.property && this.elementScaleLinked(element)) {
            return { type: "property", element, depth: 1, property: UNIFORM_SCALE_PROPERTY };
        }
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
        if(row.type === 'property' && this.isUniformScaleRow(row)) {
            const track = this.animation.trackFor(row.element, "transform.scaleX")
                ?? this.animation.trackFor(row.element, "transform.scaleY");
            return track ? [{ track, label: UNIFORM_SCALE_PROPERTY.label, axis: "scalar", selected: true, color: "#a78bfa" }] : [];
        }
        const primary = this.rowTrack(row);
        const partnerProperty = semanticPartnerProperty(row.property.property);
        const partner = partnerProperty ? this.rowTrack(row, partnerProperty) : undefined;
        return [primary, partner].flatMap((track) => track ? [this.graphTrackDescriptor(track, track === primary
            ? row.property.label : this.propertyLabel(track.property), track === primary)] : []);
    }

    graphTrackOptions(): { property: string; label: string }[] {
        const targetId = this.selectedGraphTargetId ?? this.editor.selectedElement?.id;
        const seen = new Set<string>();
        return (this.activeAnimation?.tracks ?? []).flatMap((track) => {
            if(track.targetId !== targetId || track.valueType !== "number" || seen.has(track.property)) return [];
            const target = findAnimationTarget(this.editor.selectedSVG?.elements ?? [], track.targetId);
            if(target && (track.property === "transform.scaleX" || track.property === "transform.scaleY") && this.elementScaleLinked(target)) {
                if(seen.has(UNIFORM_SCALE_PROPERTY.property)) return [];
                seen.add(UNIFORM_SCALE_PROPERTY.property);
                seen.add("transform.scaleX");
                seen.add("transform.scaleY");
                return [{ property: UNIFORM_SCALE_PROPERTY.property, label: UNIFORM_SCALE_PROPERTY.label }];
            }
            seen.add(track.property);
            return [{ property: track.property, label: this.propertyLabel(track.property) }];
        });
    }

    graphRenderTracks(): GraphTrack[] {
        return [...this.graphTracks()].sort((a, b) => Number(a.selected) - Number(b.selected));
    }

    selectGraphProperty(property: string): void {
        this.cancelGraphDrag();
        this.activeGraphHandle = undefined;
        this.selectedGraphHandleKeys.clear();
        const target = findAnimationTarget(this.editor.selectedSVG?.elements ?? [], this.selectedGraphTargetId ?? "");
        this.selectedGraphProperty = target && (property === "transform.scaleX" || property === "transform.scaleY")
            && this.elementScaleLinked(target) ? UNIFORM_SCALE_PROPERTY.property : property;
        this.fitSpeed();
    }

    graphViewportHeight?: number;
    graphHeight(): number { return Math.max(60, (this.graphViewportHeight ?? this.timelineHeight - 150) - 30); }
    graphZeroY(): number { return this.graphSpeedY(0); }
    graphPlayheadX(): number { return this.timeToX(this.animation.currentTime); }

    speedCurvePath(track: AnimationTrack): string {
        const keys = track.keyframes;
        if(keys.length < 2) return "";
        const cacheKey = `${this.timeDomainStart}:${this.pixelsPerSecond}:${this.graphSpeedMin}:${this.graphSpeedMax}:${this.graphHeight()}:${keys.map((key) => `${key.time}:${key.value}:${key.easing?.type ?? "linear"}:${key.temporal?.in?.speed ?? ""}:${key.temporal?.in?.influence ?? ""}:${key.temporal?.out?.speed ?? ""}:${key.temporal?.out?.influence ?? ""}`).join("|")}`;
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
        if(this.selectedGraphProperty === UNIFORM_SCALE_PROPERTY.property) return this.graphHandleY(handle);
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
        if(!selected.length) { this.activeGraphHandle = undefined; return; }
        this.animation.pause?.();
        const tracks = new Set(selected.map(handle => handle.track));
        if(this.selectedGraphProperty === UNIFORM_SCALE_PROPERTY.property) {
            for(const track of [...tracks]) {
                const partner = this.activeAnimation?.tracks.find(candidate => candidate.targetId === track.targetId
                    && candidate.property === (track.property === 'transform.scaleX' ? 'transform.scaleY' : 'transform.scaleX'));
                if(partner) tracks.add(partner);
            }
        }
        const originalTemporal = [...tracks].flatMap(track => track.keyframes.map(keyframe =>
            ({ track, keyframe, temporal: this.cloneValue(keyframe.temporal) })));
        this.activeGraphHandle = handle;
        this.graphDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            latestX: event.clientX,
            latestY: event.clientY,
            moved: false,
            uniformScale: this.selectedGraphProperty === UNIFORM_SCALE_PROPERTY.property,
            capture: (event.currentTarget as Element).closest<HTMLElement>(".speed-graph-surface") ?? undefined,
            unlink: event.altKey,
            originalTemporal,
            snapshots: selected.map(handle => ({ handle, temporal: this.cloneValue(handle.keyframe.temporal) })),
        };
        try { this.graphDrag.capture?.setPointerCapture(event.pointerId); } catch {}
        this.installGlobalPointerTracking(
            event.pointerId,
            (pointerEvent) => this.updateGraphHandleDrag(pointerEvent),
            (pointerEvent) => this.zone.run(() => this.endGraphHandleDrag(pointerEvent)),
            () => this.zone.run(() => this.cancelGraphDrag()),
        );
    }

    updateGraphHandleDrag(event: PointerEvent): void {
        if(!this.graphDrag || this.graphDrag.pointerId !== event.pointerId) return;
        event.preventDefault();
        this.graphDrag.latestX = event.clientX;
        this.graphDrag.latestY = event.clientY;
        if(Math.hypot(event.clientX - this.graphDrag.startX, event.clientY - this.graphDrag.startY) > 1) this.graphDrag.moved = true;
        if(this.graphDrag.moved && this.graphFrame == null) {
            this.zone.runOutsideAngular(() => this.graphFrame = requestAnimationFrame(() => this.zone.run(() => this.applyGraphDragFrame())));
        }
    }

    endGraphHandleDrag(event: PointerEvent): void {
        if(!this.graphDrag || this.graphDrag.pointerId !== event.pointerId) return;
        if(this.graphFrame != null) { cancelAnimationFrame(this.graphFrame); this.graphFrame = undefined; this.applyGraphDragFrame(); }
        const drag = this.graphDrag;
        const moved = drag.moved && drag.originalTemporal.some(snapshot =>
            JSON.stringify(snapshot.keyframe.temporal) !== JSON.stringify(snapshot.temporal));
        if(!moved) this.restoreGraphTangents(drag);
        this.graphDrag = undefined;
        try { drag.capture?.releasePointerCapture(event.pointerId); } catch {}
        this.clearGlobalPointerTracking();
        this.changeDetector.markForCheck();
        if(moved) this.animationChange.emit();
    }

    setActiveHandleValue(field: "speed" | "influence", value: number | string): void {
        const active = this.activeGraphHandle;
        if(!active) return;
        const numeric = Number(value);
        if(!Number.isFinite(numeric)) return;
        const next = field === "influence" ? Math.max(0, Math.min(1, numeric)) : numeric;
        if(next === active[field]) return;
        const handle = this.initializeGraphHandle(active);
        handle[field] = field === "influence" ? Math.max(0, Math.min(1, numeric)) : numeric;
        this.linkGraphHandleSpeed(active);
        const trackIds = new Set([active.track.id]);
        if(this.selectedGraphProperty === UNIFORM_SCALE_PROPERTY.property) {
            const partner = this.mirrorScaleTrack(active.track);
            if(partner) trackIds.add(partner.id);
        }
        this.animation.invalidate(trackIds);
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
        syncLoopSeam(active.track, undefined, active.keyframe.id);
        const trackIds = new Set([active.track.id]);
        if(this.selectedGraphProperty === UNIFORM_SCALE_PROPERTY.property) {
            const partner = this.mirrorScaleTrack(active.track);
            if(partner) trackIds.add(partner.id);
        }
        this.animation.invalidate(trackIds);
        this.animation.previewAt(this.animation.currentTime);
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
        if(this.selectedGraphProperty === UNIFORM_SCALE_PROPERTY.property) return UNIFORM_SCALE_PROPERTY.label;
        const axis = this.graphAxis(active.track.property);
        return axis === "scalar" ? this.propertyLabel(active.track.property) : `${axis.toUpperCase()} · ${this.propertyLabel(active.track.property)}`;
    }

    get timelineContentWidth(): number {
        return Math.max(360, ((this.timeDomainEnd - this.timeDomainStart) * this.pixelsPerSecond) + (this.timePadding * 2));
    }

    get timeDomainStart(): number { return Math.min(this.timeDomainBounds().start,
        this.inspection?.loopGhosts ? this.animation.workArea.start - this.loopGhostSpan : 0); }
    get timeDomainEnd(): number { return Math.max(this.timeDomainBounds().end,
        this.inspection?.loopGhosts ? this.animation.workArea.end + this.loopGhostSpan : 0); }
    private get loopGhostSpan(): number { return (this.animation.workArea.end - this.animation.workArea.start) * .2; }
    loopSeamX(side: 'start' | 'end'): number { return this.timeToX(this.animation.workArea[side]); }
    loopGhostPath(track: AnimationTrack): string {
        if(!this.inspection?.loopGhosts) return '';
        const {start, end} = this.animation.workArea, span = end - start;
        if(span <= 0) return '';
        const parts: string[] = [];
        for(const direction of [-1, 1]) for(let index = 0; index <= 48; index++) {
            const t = direction < 0 ? start - this.loopGhostSpan + this.loopGhostSpan * index / 48 : end + this.loopGhostSpan * index / 48;
            const sample = direction < 0 ? t + span : t - span;
            const keys = track.keyframes;
            const i = keys.findIndex((key, i) => i < keys.length - 1 && sample >= key.time && sample <= keys[i+1].time);
            const speed = i < 0 ? 0 : this.segmentSpeed(keys[i], keys[i+1], sample);
            parts.push(`${index ? 'L' : 'M'}${this.timeToX(t).toFixed(2)},${this.graphSpeedY(speed).toFixed(2)}`);
        }
        return parts.join(' ');
    }

    get overscrollHeight(): number {
        const toolbarHeight = 36;
        const rulerHeight = 30;
        const availableHeight = this.timelineHeight - toolbarHeight - rulerHeight;
        const usedRowHeight = this.rows.length * TIMELINE_ROW_HEIGHT;
        return Math.max(0, availableHeight - usedRowHeight);
    }

    keyframeLeft(time: number): string {
        return `${this.timeToX(time)}px`;
    }

    playheadLeft(): string {
        return this.keyframeLeft(this.animation.currentTime);
    }

    workAreaLeft(): number { return this.timeToX(this.animation.workArea.start); }
    workAreaWidth(): number { return Math.max(2, (this.animation.workArea.end - this.animation.workArea.start) * this.pixelsPerSecond); }
    playableStartLeft(): number { return this.timeToX(0); }
    playableWidth(): number { return this.animation.duration * this.pixelsPerSecond; }

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
        const table = this.host.nativeElement.querySelector<HTMLElement>(".timeline-table, .graph-time-pane");
        const oldScale = this.pixelsPerSecond;
        const nextScale = this.clampTimelineScale(oldScale * factor);
        if(nextScale === oldScale) return;
        if(!table) {
            this.pixelsPerSecond = nextScale;
            return;
        }
        const rect = table.getBoundingClientRect();
        const layerWidth = table.classList.contains("timeline-table") ? 360 : 0;
        let anchorScreen = clientX == null ? layerWidth + (table.clientWidth - layerWidth) / 2 : clientX - rect.left;
        let anchorTime: number;
        if(clientX == null) {
            anchorTime = this.animation.currentTime;
            const playheadScreen = layerWidth + this.timePadding + (anchorTime - this.timeDomainStart) * oldScale - table.scrollLeft;
            if(playheadScreen >= layerWidth && playheadScreen <= table.clientWidth) anchorScreen = playheadScreen;
        } else {
            anchorTime = this.timeDomainStart + (table.scrollLeft + anchorScreen - layerWidth - this.timePadding) / oldScale;
        }
        this.pixelsPerSecond = nextScale;
        table.scrollLeft = Math.max(0, layerWidth + this.timePadding + (anchorTime - this.timeDomainStart) * nextScale - anchorScreen);
    }

    fitTimeline() { this.fitTimeRange(this.timeDomainStart, this.timeDomainEnd); }

    rulerMarks(): TimelineRulerMark[] {
        const start = this.timeDomainStart;
        const duration = this.timeDomainEnd;
        const interval = this.rulerInterval();
        const marks: TimelineRulerMark[] = [];

        for(let time = Math.ceil(start / interval) * interval; time <= duration + 0.0001; time += interval) {
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
        return `${this.timeToX(0)}px`;
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

    beginWorkAreaDrag(side: "start" | "end" | "range", event: PointerEvent): void {
        if(event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        const area = this.animation.workArea;
        this.workAreaDrag = {
            pointerId: event.pointerId,
            side,
            startX: event.clientX,
            start: area.start,
            end: area.end,
            capture: event.currentTarget as HTMLElement,
        };
        try { this.workAreaDrag.capture.setPointerCapture(event.pointerId); } catch {}
        this.installGlobalPointerTracking(event.pointerId,
            (pointerEvent) => this.updateWorkAreaDrag(pointerEvent),
            (pointerEvent) => this.zone.run(() => this.endWorkAreaDrag(pointerEvent)));
    }

    updateWorkAreaDrag(event: PointerEvent): void {
        const drag = this.workAreaDrag;
        if(!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        const delta = (event.clientX - drag.startX) / this.pixelsPerSecond;
        const minimum = 0.01;
        if(drag.side === "start") {
            this.animation.setWorkArea(Math.min(drag.end - minimum, Math.max(0, this.snapUnclamped(drag.start + delta))), drag.end);
        } else if(drag.side === "end") {
            this.animation.setWorkArea(drag.start, Math.max(drag.start + minimum, Math.min(this.animation.duration, this.snapUnclamped(drag.end + delta))));
        } else {
            const span = drag.end - drag.start;
            const start = Math.max(0, Math.min(this.animation.duration - span, this.snapUnclamped(drag.start + delta)));
            this.animation.setWorkArea(start, start + span);
        }
        this.changeDetector.markForCheck();
    }

    endWorkAreaDrag(event: PointerEvent): void {
        const drag = this.workAreaDrag;
        if(!drag || drag.pointerId !== event.pointerId) return;
        if(event.type === "pointercancel") this.animation.setWorkArea(drag.start, drag.end);
        else this.updateWorkAreaDrag(event);
        try { drag.capture.releasePointerCapture(event.pointerId); } catch {}
        this.workAreaDrag = undefined;
        this.clearGlobalPointerTracking();
        if(event.type !== "pointercancel") this.animationChange.emit();
    }

    adjustWorkArea(side: "start" | "end", event: KeyboardEvent): void {
        if(event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault(); event.stopPropagation();
        const delta = (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 0.1 : 0.01);
        const area = this.animation.workArea;
        if(side === "start") this.animation.setWorkArea(area.start + delta, area.end);
        else this.animation.setWorkArea(area.start, area.end + delta);
        this.animationChange.emit();
    }

    openWorkAreaContextMenu(event: MouseEvent): void {
        event.preventDefault(); event.stopPropagation();
        this.editor.openContextMenu(event.clientX, event.clientY, [
            { label: "Set Work Area Start at Playhead", action: () => this.setWorkAreaBoundary("start") },
            { label: "Set Work Area End at Playhead", action: () => this.setWorkAreaBoundary("end") },
            { label: "Reset Work Area", action: () => { this.animation.resetWorkArea(); this.animationChange.emit(); } },
            { label: "Trim Time to Work Area", action: () => this.trimToWorkArea() },
        ]);
    }

    trimToWorkArea(): void {
        if(!this.animation.trimToWorkArea()) return;
        this.selectedKeyframeIds.clear();
        this.animationChange.emit();
    }

    toggleKey(row: TimelineRow) {
        if(row.type === 'rig-property') {
            if(this.hasKeyAtTime(row)) this.animation.removeTargetKeyframeAtCurrentTime(row.rig.id, row.property.property);
            else if(!this.rowDisabledReason(row)) this.animation.upsertTargetKeyframe(row.rig.id, row.property.property, 'number', this.propertyValue(row));
            else return;
            this.pruneKeyframeSelection(); this.animationChange.emit(); return;
        }
        if(row.type !== "property") {
            return;
        }

        if(this.isUniformScaleRow(row)) {
            if(this.hasKeyAtTime(row)) {
                this.animation.removeKeyframeAtCurrentTime(row.element, "transform.scaleX");
                this.animation.removeKeyframeAtCurrentTime(row.element, "transform.scaleY");
                this.pruneKeyframeSelection();
            } else {
                const value = readAnimationProperty(row.element, "transform.scaleX");
                this.animation.upsertKeyframe(row.element, "transform.scaleX", "number", value);
                this.animation.upsertKeyframe(row.element, "transform.scaleY", "number", value);
            }
            this.animationChange.emit();
            return;
        }

        const scalePartner = this.linkedScalePartner(row);
        if(this.hasKeyAtTime(row)) {
            if(this.isPathShapeRow(row)) {
                this.removePathShapeKeyframesAtCurrentTime(row.element);
            } else if(this.isGradientGroupRow(row)) {
                this.removeGradientGroupKeyframesAtCurrentTime(row);
            } else {
                this.animation.removeKeyframeAtCurrentTime(row.element, row.property.property);
                if(scalePartner) this.animation.removeKeyframeAtCurrentTime(row.element, scalePartner.property);
            }
            this.pruneKeyframeSelection();
        } else {
            if(this.isPathShapeRow(row)) {
                this.addPathShapeKeyframesAtCurrentTime(row.element);
            } else if(this.isGradientGroupRow(row)) {
                this.addGradientGroupKeyframesAtCurrentTime(row);
            } else {
                const value = readAnimationProperty(row.element, row.property.property);
                this.animation.upsertKeyframe(row.element, row.property.property, row.property.valueType, value);
                if(scalePartner) this.animation.upsertKeyframe(row.element, scalePartner.property, scalePartner.valueType, value);
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

        return this.boundaryEasingType(entries);
    }

    setSelectedEasing(type: EasingType) {
        const entries = this.selectedKeyframeEntries();
        if(entries.length === 0) {
            return;
        }

        const selectedByTrack = new Map<AnimationTrack, Set<string>>();
        entries.forEach((entry) => {
            const selected = selectedByTrack.get(entry.track) ?? new Set<string>();
            selected.add(entry.keyframe.id);
            selectedByTrack.set(entry.track, selected);
        });
        selectedByTrack.forEach((selected, track) => {
            const previous = structuredClone(track);
            applyEasingPresetToSelection(track, selected, type);
            syncLoopSeam(track, previous);
        });
        this.animation.invalidate(new Set([...selectedByTrack.keys()].map((track) => track.id)));
        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
    }

    keyframeEasingIcon(keyframe: TimelineKeyframe): IconProp {
        const type = this.timelineKeyframeEasingType(keyframe);
        return keyframeEasingIcon(type, this.isKeyframeSelected(keyframe));
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
        const ids = [handle.keyframe.id];
        if(this.selectedGraphProperty === UNIFORM_SCALE_PROPERTY.property) {
            const partner = this.scalePartnerKeyframe(handle.track, handle.keyframe);
            if(partner) ids.push(partner.id);
        }
        this.startKeyframeDrag(
            ids,
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
        if(entries.length === 0 || this.loopBoundaryRetimeBlocked(entries)) return;
        this.animation.pause?.();

        this.keyframeDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            latestX: event.clientX,
            moved: false,
            preview,
            capture: capture ?? undefined,
            anchorStartTime: entries.find((entry) => ids.includes(entry.keyframe.id))?.keyframe.time ?? entries[0].keyframe.time,
            entries: entries.map((entry) => ({
                ...entry,
                startTime: entry.keyframe.time,
            })),
        };
        this.changeDetector.markForCheck();
        try { this.keyframeDrag.capture?.setPointerCapture(event.pointerId); } catch {}
        this.installGlobalPointerTracking(
            event.pointerId,
            (pointerEvent) => this.updateKeyframeDrag(pointerEvent),
            (pointerEvent) => this.zone.run(() => this.endKeyframeDrag(pointerEvent)),
            () => this.zone.run(() => this.cancelKeyframeDrag()),
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
        this.changeDetector.markForCheck();

        if(moved) {
            this.animation.invalidate(new Set(drag.entries.map((entry) => entry.track.id)));
            this.animation.previewAt(this.animation.currentTime);
            this.animationChange.emit();
        }
    }

    copySelectedKeyframes(): boolean {
        this.pruneFilteredKeySelection();
        return this.editing.copy(this.activeAnimation?.tracks ?? []);
    }

    pasteKeyframes(): boolean {
        const svg = this.editor.selectedSVG;
        const rigSelected = this.editor.selectedElements.length === 0 && this.rig?.visible ? this.rig.active : undefined;
        const copiedBones = new Set(this.editing.copiedChannels.map(channel => parseRigAnimationProperty(channel.property)?.boneId).filter(Boolean));
        const destination = rigSelected ?? this.editor.selectedElement;
        if(!svg || !this.editing.paste(
            this.activeAnimation!,
            this.animation.currentTime,
            destination,
            (element, property, sourceTargetId) => {
                const parsed = parseRigAnimationProperty(property);
                if(rigSelected) {
                    if(!parsed) return undefined;
                    // Reuse channels on their original bones; an explicitly selected destination bone remaps one bone's keys.
                    return copiedBones.size === 1 && this.rig?.boneId ? rigAnimationProperty(this.rig.boneId, parsed.field) : property;
                }
                if(parsed) return undefined;
                const source = findAnimationTarget(svg.elements, sourceTargetId);
                return source ? matchingAnimationProperty(source, element as AnyElement, property) : undefined;
            },
            id => !this.animation.allowsTarget || this.animation.allowsTarget(id),
            (id, property) => {
                const parsed = parseRigAnimationProperty(property);
                if(!parsed) return !!findAnimationTarget(svg.elements, id);
                const rig = svg.rigs.armatures.find(rig => rig.id === id), bone = rig?.bones.find(bone => bone.id === parsed.boneId);
                return !!rig && !!bone && !this.rowDisabledReason({ type: 'rig-property', rig, bone, depth: 0, property: rigTimelineProperties(bone).find(p => p.property === property)! });
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
        this.pruneFilteredKeySelection();
        const svg = this.editor.selectedSVG;
        if(!svg || !this.editing.delete(this.activeAnimation!)) {
            return false;
        }
        this.animation.invalidate();
        this.animation.previewAt(this.animation.currentTime);
        this.animationChange.emit();
        return true;
    }

    hasKeyAtTime(row: TimelineRow): boolean {
        if(row.type === 'rig-property') return this.keyframes(row).some(key => this.timesMatch(key.time, this.animation.currentTime));
        if(row.type !== "property") {
            return false;
        }

        if(this.isUniformScaleRow(row)) {
            return this.animation.hasKeyframeAtCurrentTime(row.element, "transform.scaleX")
                && this.animation.hasKeyframeAtCurrentTime(row.element, "transform.scaleY");
        }
        if(this.isPathShapeRow(row)) {
            return this.pathShapeKeyframes(row.element).some((keyframe) => this.timesMatch(keyframe.time, this.animation.currentTime));
        }
        if(this.isGradientGroupRow(row)) return this.gradientGroupKeyframes(row).some((keyframe) => this.timesMatch(keyframe.time, this.animation.currentTime));

        return this.animation.hasKeyframeAtCurrentTime(row.element, row.property.property);
    }

    previousKeyframeTime(row: TimelineRow): number | undefined {
        if(!('property' in row)) {
            return undefined;
        }

        const currentTime = this.animation.currentTime;
        return this.keyframes(row)
            .map((keyframe) => keyframe.time)
            .filter((time) => time < currentTime - 0.0005)
            .sort((a, b) => b - a)[0];
    }

    nextKeyframeTime(row: TimelineRow): number | undefined {
        if(!('property' in row)) {
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
        if(row.type === 'rig-property') return this.editor.selectedSVG && readDocumentAnimationProperty(this.editor.selectedSVG, row.rig.id, row.property.property);
        if(row.type === "property" && this.isUniformScaleRow(row)) {
            return readAnimationProperty(row.element, "transform.scaleX");
        }
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
        return 'property' in row ? `${timelineRowTargetId(row)}:${row.property.property}` : timelineRowId(row);
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
        if(!('property' in row) || row.property.valueType !== "number" || event.button !== 0 || this.rowDisabledReason(row)) {
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
            startTracks: this.cloneValue(this.activeAnimation?.tracks ?? []),
            animation: this.activeAnimation!, documentId: this.editor.selectedSVG?.id, revision: this.mutations.revision,
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
            () => this.zone.run(() => this.cancelNumberDrag()),
        );
    }

    updateNumberDrag(event: PointerEvent) {
        if(!this.numberDrag || this.numberDrag.pointerId !== event.pointerId) {
            return;
        }
        if(!this.numberDragCurrent()) { this.cancelNumberDrag(false); return; }

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
        if(event.type === 'pointercancel') { this.cancelNumberDrag(); return; }
        if(!this.numberDragCurrent()) { this.cancelNumberDrag(false); return; }

        const drag = this.numberDrag;
        if(this.numberDragFrame != null) {
            cancelAnimationFrame(this.numberDragFrame);
            this.numberDragFrame = undefined;
            this.applyNumberDragFrame();
        }
        const moved = drag.moved;
        if(moved) event.preventDefault();
        if(moved) event.stopPropagation();
        if(moved && Number(this.propertyValue(drag.row)) === drag.startValue) { this.cancelNumberDrag(); return; }
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

    private numberDragCurrent(): boolean {
        const drag = this.numberDrag;
        return !!drag && drag.documentId === this.editor.selectedSVG?.id && drag.animation === this.activeAnimation && drag.revision === this.mutations.revision;
    }
    private cancelNumberDrag(restore = true): void {
        const drag = this.numberDrag;
        if(!drag) return;
        if(this.numberDragFrame != null) cancelAnimationFrame(this.numberDragFrame);
        this.numberDragFrame = undefined;
        if(restore && this.numberDragCurrent()) {
            this.animation.restorePreview();
            drag.animation.tracks = drag.startTracks;
            this.animation.invalidate();
            this.animation.previewAt(this.animation.currentTime);
            drag.capture.value = String(drag.startValue);
        }
        this.numberDrag = undefined;
        try { drag.capture.releasePointerCapture(drag.pointerId); } catch {}
        this.clearGlobalPointerTracking();
        this.changeDetector.markForCheck();
    }

    private setPropertyValueInternal(row: TimelineRow, value: unknown, emitChange: boolean) {
        if(row.type === 'rig-property') {
            if(this.rowDisabledReason(row)) return;
            const normalized = this.normalizeValue(row.property, value);
            if(typeof normalized !== 'number' || !Number.isFinite(normalized)) return;
            this.animation.setAnimatedTargetPropertyValue(row.rig.id, row.property.property, 'number', normalized);
            if(emitChange) this.animationChange.emit();
            return;
        }
        if(row.type !== "property") {
            return;
        }

        const normalized = this.normalizeValue(row.property, value);
        if(this.isUniformScaleRow(row)) {
            this.animation.setAnimatedPropertyValue(row.element, "transform.scaleX", "number", normalized);
            this.animation.setAnimatedPropertyValue(row.element, "transform.scaleY", "number", normalized);
            if(emitChange) this.animationChange.emit();
            return;
        }
        this.animation.setAnimatedPropertyValue(row.element, row.property.property, row.property.valueType, normalized);
        const scalePartner = this.linkedScalePartner(row);
        if(scalePartner) this.animation.setAnimatedPropertyValue(row.element, scalePartner.property, scalePartner.valueType, normalized);
        if(emitChange) {
            this.animationChange.emit();
        }
    }

    isScaleRow(row: TimelineRow): row is PropertyTimelineRow {
        return row.type === "property"
            && (row.property.property === UNIFORM_SCALE_PROPERTY.property
                || row.property.property === "transform.scaleX"
                || row.property.property === "transform.scaleY");
    }

    private isUniformScaleRow(row: TimelineRow): boolean {
        return row.type === "property" && row.property.property === UNIFORM_SCALE_PROPERTY.property;
    }

    private isScaleAxisRow(row: TimelineRow): boolean {
        return row.type === "property"
            && (row.property.property === "transform.scaleX" || row.property.property === "transform.scaleY");
    }

    scaleLinked(row: TimelineRow): boolean {
        return this.isScaleRow(row) && this.elementScaleLinked(row.element);
    }

    toggleScaleLinked(row: TimelineRow, event: MouseEvent): void {
        event.stopPropagation();
        if(!this.isScaleRow(row)) return;
        const linked = !this.scaleLinked(row);
        this.scaleLinkOverrides.set(row.element.id, linked);
        if(linked) {
            this.synchronizeScaleTracks(row.element, row.property.property === "transform.scaleY" ? "transform.scaleY" : "transform.scaleX");
            this.selectedGraphTargetId = row.element.id;
            this.selectedGraphProperty = UNIFORM_SCALE_PROPERTY.property;
        } else {
            this.selectedGraphProperty = "transform.scaleX";
        }
        this.rowCacheKey = "";
        this.animationChange.emit();
    }

    beginScrub(event: PointerEvent) {
        if(event.button !== 0) return;
        event.preventDefault();
        this.animation.pause?.();
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
            () => this.cancelScrub(),
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
        this.cancelScrub();
    }

    private cancelScrub(): void {
        if(!this.scrubbing) return;
        if(this.scrubFrame != null) cancelAnimationFrame(this.scrubFrame);
        this.scrubFrame = undefined;
        const pointerId = this.scrubPointerId;
        this.scrubbing = false;
        this.scrubPointerId = undefined;
        this.scrubRect = undefined;
        if(pointerId != null) { try { this.scrubCapture?.releasePointerCapture(pointerId); } catch {} }
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
        if(event.key === 'Escape' && this.numberDrag) { this.cancelNumberDrag(); this.consumeShortcut(event); return; }
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
        if(event.defaultPrevented || this.animation.mode !== 'animate' || this.shouldIgnoreShortcut(event)) {
            return;
        }

        const commandKey = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();

        if(event.altKey && !commandKey && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            this.jumpToPose(event.key === 'ArrowLeft' ? -1 : 1);
            this.consumeShortcut(event); return;
        }

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
            parts.push(`${element.id}:${element.name}:${element.motion.pathId ?? ""}:${fill}:${stroke}`);
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
        if(from.easing?.type === "hold") return 0;
        if(from.temporal?.out || to.temporal?.in) return evaluateTemporalSpeed(from, to, time);
        const duration = to.time - from.time;
        if(duration <= 0) return 0;
        const base = (Number(to.value) - Number(from.value)) / duration;
        const t = Math.max(0, Math.min(1, (time - from.time) / duration));
        switch(from.easing?.type ?? "linear") {
            case "ease-in": return base * 2 * t;
            case "ease-out": return base * 2 * (1 - t);
            case "ease-in-out": return base * (t < 0.5 ? 4 * t : 4 * (1 - t));
            default: return base;
        }
    }

    private propertyLabel(property: string): string {
        const parsed = parseRigAnimationProperty(property);
        if(parsed) {
            const bone = this.editor.selectedSVG?.rigs.armatures.flatMap(rig => rig.bones).find(bone => bone.id === parsed.boneId);
            return `${bone?.name ?? 'Bone'} · ${parsed.field === 'pose' ? 'Rotation' : parsed.field === 'poseX' ? 'Offset X' : 'Offset Y'}`;
        }
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
        if(temporal?.linked) {
            const active = temporal[handle.side];
            const opposite = handle.side === 'in' ? temporal.out : temporal.in;
            if(active && opposite) opposite.speed = active.speed;
        }
        syncLoopSeam(handle.track, undefined, handle.keyframe.id);
    }

    private applyGraphDragFrame(): void {
        this.graphFrame = undefined;
        const drag = this.graphDrag;
        if(!drag) return;
        const speedPerPixel = (this.graphSpeedMax - this.graphSpeedMin) / Math.max(1, this.graphHeight() - 20);
        const deltaSpeed = (drag.startY - drag.latestY) * speedPerPixel;
        this.restoreGraphTangents(drag);
        drag.snapshots.forEach((snapshot) => {
            if(drag.unlink) {
                snapshot.handle.keyframe.temporal ??= { linked: false };
                snapshot.handle.keyframe.temporal.linked = false;
            }
            const value = this.initializeGraphHandle(snapshot.handle);
            const original = snapshot.temporal?.[snapshot.handle.side] ?? { speed: snapshot.handle.speed, influence: snapshot.handle.influence };
            const duration = Math.max(1e-9, Math.abs(snapshot.handle.other.time - snapshot.handle.keyframe.time));
            const direction = snapshot.handle.side === "out" ? 1 : -1;
            value.speed = original.speed + deltaSpeed;
            value.influence = Math.max(0, Math.min(1, original.influence + direction * (drag.latestX - drag.startX) / (duration * this.pixelsPerSecond)));
            this.linkGraphHandleSpeed(snapshot.handle);
        });
        const trackIds = new Set(drag.snapshots.map((snapshot) => snapshot.handle.track.id));
        if(drag.uniformScale) {
            drag.snapshots.forEach((snapshot) => {
                const partner = this.mirrorScaleTrack(snapshot.handle.track);
                if(partner) trackIds.add(partner.id);
            });
        }
        this.animation.invalidate(trackIds);
        this.animation.previewAt(this.animation.currentTime);
        this.changeDetector.markForCheck();
    }

    private restoreGraphTangents(drag: GraphHandleDrag): void {
        for(const snapshot of drag.originalTemporal) {
            const key = snapshot.track.keyframes.find(key => key.id === snapshot.keyframe.id);
            if(key) key.temporal = this.cloneValue(snapshot.temporal);
        }
    }

    private cancelGraphDrag(restore = true): void {
        const drag = this.graphDrag;
        if(!drag) return;
        if(this.graphFrame != null) cancelAnimationFrame(this.graphFrame);
        this.graphFrame = undefined;
        if(restore) this.restoreGraphTangents(drag);
        this.graphDrag = undefined;
        try { drag.capture?.releasePointerCapture(drag.pointerId); } catch {}
        this.clearGlobalPointerTracking();
        if(restore) {
            this.animation.invalidate(new Set(drag.originalTemporal.map(snapshot => snapshot.track.id)));
            this.animation.previewAt(this.animation.currentTime);
        }
        this.changeDetector.markForCheck();
    }

    private applyKeyframeDragFrame(): void {
        this.keyframeFrame = undefined;
        const drag = this.keyframeDrag;
        if(!drag?.moved) return;
        const requestedDelta = (drag.latestX - drag.startX) / this.pixelsPerSecond;
        const startTimes = drag.entries.map((entry) => entry.startTime);
        const snappedDelta = snapKeyframeTimeDelta(
            startTimes,
            drag.anchorStartTime,
            requestedDelta,
            this.animation.currentTime,
            KEYFRAME_PLAYHEAD_SNAP_PX / this.pixelsPerSecond,
        );
        const deltaTime = clampKeyframeTimeDelta(startTimes, snappedDelta, this.animation.duration);
        drag.entries.forEach((entry) => entry.keyframe.time = entry.startTime + deltaTime);
        this.sortDraggedTracks();
        this.changeDetector.markForCheck();
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
        this.changeDetector.markForCheck();
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
        if(this.animation.allowsTarget && !this.animation.allowsTarget(element.id)) return false;
        if(property.property === UNIFORM_SCALE_PROPERTY.property) return this.elementScaleLinked(element);
        if(property.property === "transform.scaleX" || property.property === "transform.scaleY") {
            return !this.elementScaleLinked(element);
        }
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

    private linkedScalePartner(row: TimelineRow): AnimatablePropertyDefinition | undefined {
        if(row.type !== "property" || !this.isScaleAxisRow(row) || !this.scaleLinked(row)) return undefined;
        const partner = row.property.property === "transform.scaleX" ? "transform.scaleY" : "transform.scaleX";
        return this.properties.find((property) => property.property === partner);
    }

    private elementScaleLinked(element: AnyElement): boolean {
        const override = this.scaleLinkOverrides.get(element.id);
        return override ?? this.inferredScaleLinked(element);
    }

    private inferredScaleLinked(element: AnyElement): boolean {
        if(Math.abs(element.transform.scaleX - element.transform.scaleY) > 0.000001) return false;
        const x = this.animation.trackFor(element, "transform.scaleX");
        const y = this.animation.trackFor(element, "transform.scaleY");
        if(!x && !y) return true;
        if(!x || !y || x.keyframes.length !== y.keyframes.length) return false;
        const signature = (track: AnimationTrack) => JSON.stringify(track.keyframes.map((keyframe) => ({
            time: keyframe.time,
            value: keyframe.value,
            easing: keyframe.easing,
            temporal: keyframe.temporal,
        })));
        return signature(x) === signature(y);
    }

    private synchronizeScaleTracks(element: AnyElement, preferredProperty: "transform.scaleX" | "transform.scaleY"): void {
        const partnerProperty = preferredProperty === "transform.scaleX" ? "transform.scaleY" : "transform.scaleX";
        const preferred = this.animation.trackFor(element, preferredProperty);
        const partner = this.animation.trackFor(element, partnerProperty);
        const source = preferred ?? partner;
        if(!source) {
            const value = readAnimationProperty(element, preferredProperty);
            this.animation.setAnimatedPropertyValue(element, preferredProperty, "number", value);
            this.animation.setAnimatedPropertyValue(element, partnerProperty, "number", value);
            return;
        }

        const destination = this.mirrorScaleTrack(source);
        if(!destination) return;
        this.animation.invalidate([source.id, destination.id]);
        this.animation.previewAt(this.animation.currentTime);
    }

    private mirrorScaleTrack(source: AnimationTrack): AnimationTrack | undefined {
        if(source.property !== "transform.scaleX" && source.property !== "transform.scaleY") return undefined;
        const destinationProperty = source.property === "transform.scaleX" ? "transform.scaleY" : "transform.scaleX";
        const destination = this.ensureTimelineTrack(source.targetId, destinationProperty, "number");
        const existing = destination.keyframes;
        destination.enabled = source.enabled;
        destination.keyframes = source.keyframes.map((keyframe, index) => ({
            id: existing[index]?.id ?? makeAnimationId("key"),
            time: keyframe.time,
            value: this.cloneValue(keyframe.value),
            easing: this.cloneValue(keyframe.easing),
            temporal: this.cloneValue(keyframe.temporal),
        }));
        return destination;
    }

    private scalePartnerKeyframe(track: AnimationTrack, keyframe: Keyframe): Keyframe | undefined {
        if(track.property !== "transform.scaleX" && track.property !== "transform.scaleY") return undefined;
        const partnerProperty = track.property === "transform.scaleX" ? "transform.scaleY" : "transform.scaleX";
        const partner = this.activeAnimation?.tracks.find((candidate) => candidate.targetId === track.targetId
            && candidate.property === partnerProperty);
        const index = track.keyframes.indexOf(keyframe);
        if(!partner || index < 0) return undefined;
        const indexed = partner.keyframes[index];
        if(indexed && this.timesMatch(indexed.time, keyframe.time)) return indexed;
        return partner.keyframes.find((candidate) => this.timesMatch(candidate.time, keyframe.time));
    }

    private uniformScaleKeyframes(element: AnyElement): TimelineKeyframe[] {
        const x = this.animation.trackFor(element, "transform.scaleX");
        const y = this.animation.trackFor(element, "transform.scaleY");
        if(!x || !y) return [];
        return x.keyframes.flatMap((keyframe, index) => {
            const partner = y.keyframes[index];
            if(!partner || !this.timesMatch(keyframe.time, partner.time)) return [];
            return [{
                ...keyframe,
                id: `uniform-scale-${element.id}-${keyframe.time}`,
                groupedKeyframeIds: [keyframe.id, partner.id],
            }];
        });
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
            case "settings.stroke_dashoffset":
                return 1;
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
        if(!this.numberDragCurrent()) { this.cancelNumberDrag(false); return; }
        const deltaX = drag.latestX - drag.startX;
        const value = this.normalizeDraggedNumber(drag.row.property, drag.startValue + (deltaX * drag.step));
        this.setPropertyValueInternal(drag.row, value, false);
        drag.capture.value = String(value);
    }

    private installGlobalPointerTracking(
        pointerId: number,
        moveCallback: (event: PointerEvent) => void,
        endCallback: (event: PointerEvent) => void,
        cancelCallback?: () => void,
    ): void {
        this.clearGlobalPointerTracking();
        this.zone.runOutsideAngular(() => {
            const move = (event: PointerEvent) => { if(event.pointerId === pointerId) moveCallback(event); };
            const end = (event: PointerEvent) => { if(event.pointerId === pointerId) endCallback(event); };
            document.addEventListener("pointermove", move, { capture: true, passive: false });
            document.addEventListener("pointerup", end, true);
            const cancel = (event: PointerEvent) => {
                if(event.pointerId === pointerId) { if(cancelCallback) cancelCallback(); else endCallback(event); }
            };
            document.addEventListener("pointercancel", cancel, true);
            if(cancelCallback) document.addEventListener('lostpointercapture', cancel, true);
            if(cancelCallback) window.addEventListener('blur', cancelCallback);
            this.globalPointerCleanup = () => {
                document.removeEventListener("pointermove", move, true);
                document.removeEventListener("pointerup", end, true);
                document.removeEventListener("pointercancel", cancel, true);
                if(cancelCallback) document.removeEventListener('lostpointercapture', cancel, true);
                if(cancelCallback) window.removeEventListener('blur', cancelCallback);
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
        const maxHeight = Math.min(1024, Math.max(260, window.innerHeight * 0.68));
        return Math.round(Math.max(minHeight, Math.min(maxHeight, value)));
    }

    private timeToX(time: number): number {
        return timelineTimeToX(time, this.timePadding, this.pixelsPerSecond, this.timeDomainStart);
    }

    private xToTime(x: number): number {
        return timelineXToTime(x, this.timePadding, this.pixelsPerSecond, this.timeDomainStart);
    }

    private snapTime(time: number): number {
        return snapTimelineTime(time);
    }

    private snapUnclamped(time: number): number { return snapTimelineTime(time); }

    private timeDomainBounds(): { start: number; end: number } {
        const animation = this.activeAnimation;
        const documentId = this.editor.selectedSVG?.id ?? "";
        const cached = this.timeDomainCache;
        if(this.keyframeDrag && cached?.documentId === documentId) return cached;
        if(cached && cached.documentId === documentId && cached.revision === this.animation.revision
            && cached.duration === this.animation.duration) return cached;
        const times = animation ? [animation.duration, ...animation.markers.map((marker) => marker.time),
            ...animation.tracks.flatMap((track) => track.keyframes.map((keyframe) => keyframe.time))] : [0];
        const next = { documentId, revision: this.animation.revision, duration: this.animation.duration,
            start: Math.min(0, ...times), end: Math.max(this.animation.duration, ...times) };
        this.timeDomainCache = next;
        return next;
    }

    private setWorkAreaBoundary(side: "start" | "end"): void {
        const area = this.animation.workArea;
        if(side === "start") this.animation.setWorkArea(this.animation.currentTime, area.end);
        else this.animation.setWorkArea(area.start, this.animation.currentTime);
        this.animationChange.emit();
    }

    private selectedKeyframeEntries(): KeyframeEntry[] {
        this.pruneFilteredKeySelection();
        return this.editing.entries(this.activeAnimation?.tracks ?? []);
    }

    private pruneFilteredKeySelection(): void {
        if(!this.filteringRows) return;
        const visible = new Set(this.rows.filter(row => 'property' in row).flatMap(row => this.keyframes(row)
            .flatMap(key => key.groupedKeyframeIds ?? [key.id])));
        if(this.surfaceMode === 'graph') this.graphTracks().forEach(({track}) => track.keyframes.forEach(key => visible.add(key.id)));
        this.editing.selectedKeyframeIds.forEach(id => { if(!visible.has(id)) this.editing.selectedKeyframeIds.delete(id); });
    }

    private timelineKeyframeEasingType(keyframe: TimelineKeyframe): EasingType | "mixed" {
        const svg = this.editor.selectedSVG;
        if(!svg) return "linear";
        const ids = new Set(keyframe.groupedKeyframeIds?.length ? keyframe.groupedKeyframeIds : [keyframe.id]);
        const entries = this.activeAnimation!.tracks.flatMap((track) => track.keyframes
            .filter((candidate) => ids.has(candidate.id))
            .map((candidate) => ({ track, keyframe: candidate })));
        return entries.length ? this.boundaryEasingType(entries) : "linear";
    }

    private boundaryEasingType(entries: readonly KeyframeEntry[]): EasingType | "mixed" {
        let hasIncoming = false;
        let hasOutgoing = false;
        let incomingEased = true;
        let outgoingEased = true;
        let allLinear = true;

        entries.forEach(({ track, keyframe }) => {
            const index = track.keyframes.indexOf(keyframe);
            if(index > 0) {
                const type = track.keyframes[index - 1].easing?.type ?? "linear";
                hasIncoming = true;
                incomingEased &&= type === "ease-out" || type === "ease-in-out";
                allLinear &&= type === "linear";
            }
            if(index >= 0 && index < track.keyframes.length - 1) {
                const type = keyframe.easing?.type ?? "linear";
                hasOutgoing = true;
                outgoingEased &&= type === "ease-in" || type === "ease-in-out";
                allLinear &&= type === "linear";
            }
        });

        if(allLinear) return "linear";
        const easedIn = hasOutgoing && outgoingEased;
        const easedOut = hasIncoming && incomingEased;
        if(easedIn && easedOut) return "ease-in-out";
        if(easedOut) return "ease-out";
        if(easedIn) return "ease-in";
        return "mixed";
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

    private loopBoundaryRetimeBlocked(entries: readonly KeyframeEntry[]): boolean {
        if(!entries.some(({track, keyframe}) => track.loopSeam
            && [track.loopSeam.startKeyId, track.loopSeam.endKeyId].includes(keyframe.id))) return false;
        this.animation.contextMessage = 'Unlink loop endpoints before retiming boundary keys. Their values remain editable.';
        return true;
    }

    private nudgeSelectedKeyframes(direction: -1 | 1, largeStep: boolean): boolean {
        const entries = this.selectedKeyframeEntries();
        if(entries.length === 0) {
            return false;
        }

        if(this.loopBoundaryRetimeBlocked(entries)) return true;
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
        return this.activeAnimation?.tracks.filter((track) => track.targetId === row.element.id && properties.has(track.property)) ?? [];
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
        if(this.editor.selectedSVG) this.activeAnimation!.tracks = this.activeAnimation!.tracks.filter((track) => track.keyframes.length > 0);
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

        return this.activeAnimation!.tracks.filter((track) => {
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
            this.activeAnimation!.tracks = this.activeAnimation!.tracks.filter((track) => track.keyframes.length > 0);
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

        let track = this.activeAnimation!.tracks.find((candidate) => {
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
            this.activeAnimation!.tracks.push(track);
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

        return isEditableEventTarget(event.target);
    }

    private consumeShortcut(event: KeyboardEvent) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    private pruneKeyframeSelection() {
        this.editing.prune(this.activeAnimation?.tracks ?? []);
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

interface WorkAreaDrag {
    pointerId: number;
    side: "start" | "end" | "range";
    startX: number;
    start: number;
    end: number;
    capture: HTMLElement;
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
    anchorStartTime: number;
    entries: KeyframeDragEntry[];
}

interface NumberDrag {
    startTracks: AnimationTrack[];
    animation: AnimationDocument;
    documentId?: string;
    revision: number;
    row: NumericTimelineRow;
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
    icon: IconProp;
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
    uniformScale: boolean;
    capture?: HTMLElement;
    snapshots: GraphHandleSnapshot[];
    unlink: boolean;
    originalTemporal: { track: AnimationTrack; keyframe: Keyframe; temporal?: Keyframe['temporal'] }[];
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
