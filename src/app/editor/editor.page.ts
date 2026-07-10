import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild } from "@angular/core";
import { NgClass, NgFor, NgIf, NgStyle, NgTemplateOutlet } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { EditorContextMenuItem, EditorService } from "../_services/editor.service";
import { AnimationPlaybackService } from "../_services/animation-playback.service";
import { HistoryService } from "../_services/history.service";
import { ProjectService } from "../_services/project.service";
import { DocumentMutationService } from "../_services/document-mutation.service";
import { ElementFactory } from "../_services/element-factory.service";
import { LayerContext, LayerOperationsService } from "../_services/layer-operations.service";
import { SVGDisplay } from "../_components/svg-display/svg-display.component";
import { AnimationTimelineComponent } from "../_components/animation-timeline/animation-timeline.component";
import { BoolAttribute } from "../_components/attributes/bool/bool.component";
import { ColorAttribute } from "../_components/attributes/color/color.component";
import { RangeAttribute } from "../_components/attributes/range/range.component";
import { SelectAttribut } from "../_components/attributes/select/select.component";
import { TextAttribute } from "../_components/attributes/text/text.component";
import { Color } from "./objects/color.object";
import { Group } from "./objects/elements/group.object";
import { ElementAttribute } from "./objects/elements/element";
import { Path } from "./objects/elements/path.object";
import { Point } from "./objects/point.object";
import { Shape } from "./objects/elements/shape.object";
import { TextElement } from "./objects/elements/text.object";
import { AnyElement, CanvasGuide } from "./objects/svg.object";
import { buildSVGMarkup } from "./svg-markup";
import { pinTransformOrigin, resolvedOrigin } from "./objects/element-bounds";
import { canConvertStrokeToPath, StrokeToPathProfile } from "./objects/stroke-outline.object";
import { ANIMATABLE_PROPERTIES, AnimatablePropertyDefinition, createAnimationColorValue } from "./objects/animation.object";
import { pathPointAnimationProperty, readAnimationProperty } from "./objects/animation-targets";

@Component({
    standalone: true,
    imports: [
        NgFor, NgIf, NgClass, NgStyle, NgTemplateOutlet,
        FormsModule,
        FaIconComponent,
        SVGDisplay,
        BoolAttribute,
        ColorAttribute,
        RangeAttribute,
        SelectAttribut,
        TextAttribute,
        AnimationTimelineComponent
    ],
    providers: [
        EditorService,
        HistoryService,
        AnimationPlaybackService,
        DocumentMutationService,
        ElementFactory,
        LayerOperationsService,
    ],
    templateUrl: 'editor.page.html',
    styleUrls: ['editor.page.scss']
})
export class EditorPage implements AfterViewInit, OnDestroy {
    scale: number = 1;

    movingView: boolean = false;
    moveStart: Point;
    private readonly viewportListeners = new AbortController();
    draggingLayer?: AnyElement;
    dragTargetLayer?: AnyElement;
    dragTargetPosition?: 'before' | 'after' | 'inside';
    private pendingLayerDrag?: { element: AnyElement; pointerId: number; startX: number; startY: number; row: HTMLElement };
    private suppressLayerClick = false;
    private animationTransformDragStart?: AnimationTransformDragStart;
    private animationPathPointDragStart?: AnimationPathPointDragStart;
    renamingLayer?: AnyElement;
    selectedLayers: AnyElement[] = [];
    private lastSelectedLayer?: AnyElement;
    private collapsedGroupIds = new Set<string>();
    guideDrag?: GuideDragState;
    guideInput?: GuideInputState;
    private lastRulerGuideCreated?: CanvasGuide;

    // ── New SVG dialog ────────────────────────────────────────────────
    showNewDialog = false;
    newName = 'Untitled';
    newWidth = 800;
    newHeight = 600;

    showExportDialog = false;
    exportBakeRoundedCorners = true;

    readonly ASPECT_RATIOS = [
        { label: '1920×1080', sublabel: '16:9 HD',     width: 1920, height: 1080 },
        { label: '1280×720',  sublabel: '16:9 720p',   width: 1280, height: 720  },
        { label: '800×800',   sublabel: 'Square',      width: 800,  height: 800  },
        { label: '800×600',   sublabel: '4:3',         width: 800,  height: 600  },
        { label: '595×842',   sublabel: 'A4 Portrait', width: 595,  height: 842  },
        { label: '1080×1920', sublabel: 'Story 9:16',  width: 1080, height: 1920 },
    ];
    readonly ANIMATABLE_PROPERTIES = ANIMATABLE_PROPERTIES;

    @ViewChild('canvas') canvas?: ElementRef<SVGElement>;
    @ViewChild('viewPort') viewPort?: ElementRef<HTMLElement>;

    @HostListener('document:keydown', ['$event']) handleKeyDown(event: KeyboardEvent) {
        if(this.showExportDialog) {
            if(event.key == 'Escape') this.cancelExport();
            return;
        }

        if(this.showNewDialog) {
            if(event.key == 'Escape') this.cancelNewSVG();
            return;
        }

        if(event.key == 'Escape' && this.editor.contextMenu) {
            this.editor.closeContextMenu();
            return;
        }

        if(event.key == 'Escape' && this.renamingLayer) {
            this.renamingLayer = undefined;
            return;
        }

        if((event.ctrlKey || event.metaKey) && !this.renamingLayer) {
            if(event.key.toLowerCase() == 'z' && !event.shiftKey) {
                event.preventDefault();
                this.mutations.undo();
                return;
            }
            if(event.key.toLowerCase() == 'y' || (event.key.toLowerCase() == 'z' && event.shiftKey)) {
                event.preventDefault();
                this.mutations.redo();
                return;
            }
            if(event.key.toLowerCase() == 'g' && this.canGroupSelectedLayers()) {
                event.preventDefault();
                this.groupSelectedLayers();
                return;
            }
        }

        if(this.animation.mode == 'edit' && this.selectedLayers.length > 1 && !this.renamingLayer) {
            if(event.key == 'Delete' || event.key == 'Backspace') {
                event.preventDefault();
                this.deleteSelectedLayers();
                return;
            }
        }

        if(this.editor.selectedElement && !this.renamingLayer) {
            if(event.key == 'Enter') {
                event.preventDefault();
                this.renamingLayer = this.editor.selectedElement;
                return;
            }

            if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() == 'd') {
                event.preventDefault();
                this.duplicateLayer(this.editor.selectedElement);
                return;
            }

            if(event.key == '[') {
                event.preventDefault();
                this.moveLayerBackward(this.editor.selectedElement);
                return;
            }

            if(event.key == ']') {
                event.preventDefault();
                this.moveLayerForward(this.editor.selectedElement);
                return;
            }

            if(this.animation.mode == 'edit' && (event.key == 'Delete' || event.key == 'Backspace') && !this.editor.selectedPathAnchor) {
                event.preventDefault();
                this.deleteLayer(this.editor.selectedElement);
                return;
            }
        }

        const beforeState = this.currentElementsState();
        this.editor.keyPressed(event.key);
        this.snapshotAndSaveIfChanged(beforeState);
    }
    @HostListener('document:keyup', ['$event']) handleKeyUp(event: KeyboardEvent) {
        this.editor.keyReleased(event.key);
    }

    constructor(
        public editor: EditorService,
        public animation: AnimationPlaybackService,
        public mutations: DocumentMutationService,
        public projectService: ProjectService,
        private layerOperations: LayerOperationsService,
        private route: ActivatedRoute,
        private ngZone: NgZone,
        private cdr: ChangeDetectorRef
    ) {
        this.moveStart = new Point(0, 0);
    }

    ngOnDestroy(): void {
        this.viewportListeners.abort();
    }

    ngAfterViewInit() {
        const viewport = <HTMLElement>this.viewPort?.nativeElement;

        viewport.addEventListener('mousedown', (event: MouseEvent) => {
            this.ngZone.run(() => {
                this.editor.closeContextMenu();
                const start = this.editor.toViewportPoint(event.x, event.y);
                switch (event.button) {
                    case 0:
                        if (this.editor.selectedTool) {
                            this.editor.selectedTool.down(event);
                            this.captureAnimationTransformDragStart();
                            this.captureAnimationPathPointDragStart();
                        }
                        break;
                    case 1:
                        this.movingView = true;
                        this.moveStart = start;
                        break;
                    case 2:
                        event.preventDefault();
                        break;
                }
            });
        }, { signal: this.viewportListeners.signal });

        viewport.addEventListener('mouseup', (event: MouseEvent) => {
            this.ngZone.run(() => {
                const wasMovingView = this.movingView;
                if (this.editor.selectedTool) this.editor.selectedTool.up(event);
                this.commitAnimationTransformDrag();
                this.commitAnimationPathPointDrag();
                this.movingView = false;
                if(wasMovingView && this.editor.selectedSVG) {
                    this.editor.rememberCanvasView(this.editor.selectedSVG);
                }
                // Skip snapshot on right-click — contextmenu fires next and handles it
                if (event.button !== 2) this.snapshotAndSave();
            });
        }, { signal: this.viewportListeners.signal });

        viewport.addEventListener('wheel', (event: WheelEvent) => {
            this.ngZone.run(() => {
                this.editor.closeContextMenu();
                const svg = this.editor.selectedSVG;
                if (svg) {
                    const oldZoom = svg.zoom;
                    const step = oldZoom * 0.1;
                    const newZoom = Math.max(0.05, event.deltaY > 0 ? oldZoom - step : oldZoom + step);

                    // Cursor relative to the viewport element
                    const vpRect = viewport.getBoundingClientRect();
                    const vx = event.clientX - vpRect.left;
                    const vy = event.clientY - vpRect.top;

                    // CSS scale: zoom origin is the element center, so rendered top-left is:
                    //   pos + svgSize * (1 - zoom) / 2
                    const renderedLeft = svg.pos.x + svg.width  * (1 - oldZoom) / 2;
                    const renderedTop  = svg.pos.y + svg.height * (1 - oldZoom) / 2;

                    // After zoom, shift pos so the canvas point under the cursor stays put
                    const newRenderedLeft = vx - (vx - renderedLeft) * newZoom / oldZoom;
                    const newRenderedTop  = vy - (vy - renderedTop)  * newZoom / oldZoom;

                    svg.pos.x = newRenderedLeft - svg.width  * (1 - newZoom) / 2;
                    svg.pos.y = newRenderedTop  - svg.height * (1 - newZoom) / 2;
                    this.editor.setZoom(svg, newZoom);
                }
            });
        }, { passive: true, signal: this.viewportListeners.signal });

        viewport.addEventListener('contextmenu', (event: MouseEvent) => {
            this.ngZone.run(() => {
                event.preventDefault();
                if (this.editor.selectedTool) this.editor.selectedTool.contextMenu(event);
                this.snapshotAndSave();
            });
        }, { signal: this.viewportListeners.signal });

        viewport.addEventListener('mousemove', (event: MouseEvent) => {
            this.ngZone.run(() => {
                if (this.movingView && this.editor.selectedSVG != undefined) {
                    const pos = this.editor.toViewportPoint(event.x, event.y);
                    const delta = pos.subtract(this.moveStart);
                    this.moveStart.addTo(delta.x, delta.y);
                    this.editor.selectedSVG.pos.addTo(delta);
                }
                if (this.editor.selectedTool) this.editor.selectedTool.drag(event);
            });
        }, { signal: this.viewportListeners.signal });

        viewport.addEventListener('click', (event: MouseEvent) => {
            this.ngZone.run(() => {
                this.editor.closeContextMenu();
                if (this.editor.selectedTool && event.button == 0) {
                    this.editor.selectedTool.click(event);
                    this.snapshotAndSave();
                }
            });
        }, { signal: this.viewportListeners.signal });

        viewport.addEventListener('dblclick', (event: MouseEvent) => {
            this.ngZone.run(() => {
                this.editor.closeContextMenu();
                if (this.editor.selectedTool && event.button == 0) {
                    this.editor.selectedTool.doubleClick(event);
                    this.snapshotAndSave();
                }
            });
        }, { signal: this.viewportListeners.signal });

        viewport.addEventListener('mouseleave', (event: MouseEvent) => {
            if(this.movingView && this.editor.selectedSVG) {
                this.editor.rememberCanvasView(this.editor.selectedSVG);
            }
            this.movingView = false;
        }, { signal: this.viewportListeners.signal });

        this.editor.setViewPort(viewport);

        // Load project from query params, or auto-open new-project dialog
        const params = this.route.snapshot.queryParamMap;
        const projectId = params.get('id');
        if (projectId) {
            const record = this.projectService.get(projectId);
            if (record) {
                this.editor.loadSVG(record.svgData);
                this.restoreAnimationPreview();
                this.mutations.resetBaseline();
            }
        } else {
            this.openNewDialog();
        }
    }

    // ── New SVG dialog ────────────────────────────────────────────────

    openNewDialog() {
        this.newName = 'Untitled';
        this.newWidth = 800;
        this.newHeight = 600;
        this.showNewDialog = true;
    }

    confirmNewSVG() {
        const name = this.newName.trim() || 'Untitled';
        this.editor.newSVG(this.newWidth, this.newHeight, name);
        this.restoreAnimationPreview();
        this.showNewDialog = false;
        this.mutations.resetBaseline();
        this.mutations.save();
    }

    cancelNewSVG() {
        this.showNewDialog = false;
    }

    pickAspectRatio(r: { width: number; height: number }) {
        this.newWidth = r.width;
        this.newHeight = r.height;
    }

    isAspectSelected(r: { width: number; height: number }): boolean {
        return this.newWidth === r.width && this.newHeight === r.height;
    }

    // ── Rulers and guides ────────────────────────────────────────────

    get rulerSize(): number {
        return 24;
    }

    get activeGuideValue(): number | undefined {
        return this.guideDrag ? this.guideDrag.value : undefined;
    }

    canvasRenderedLeft(): number {
        const svg = this.editor.selectedSVG;
        const rect = this.canvasRectInViewport();
        return rect ? rect.left : svg ? svg.pos.x + (svg.width * (1 - svg.zoom) / 2) : 0;
    }

    canvasRenderedTop(): number {
        const svg = this.editor.selectedSVG;
        const rect = this.canvasRectInViewport();
        return rect ? rect.top : svg ? svg.pos.y + (svg.height * (1 - svg.zoom) / 2) : 0;
    }

    canvasToViewportX(value: number): number {
        const svg = this.editor.selectedSVG;
        const rect = this.canvasRectInViewport();
        if(rect && svg?.width) {
            return rect.left + (value * rect.width / svg.width);
        }
        return svg ? this.canvasRenderedLeft() + (value * svg.zoom) : 0;
    }

    canvasToViewportY(value: number): number {
        const svg = this.editor.selectedSVG;
        const rect = this.canvasRectInViewport();
        if(rect && svg?.height) {
            return rect.top + (value * rect.height / svg.height);
        }
        return svg ? this.canvasRenderedTop() + (value * svg.zoom) : 0;
    }

    guideScreenPosition(guide: CanvasGuide): number {
        return guide.axis === 'x'
            ? this.canvasToViewportX(guide.value)
            : this.canvasToViewportY(guide.value);
    }

    activeGuideScreenPosition(): number {
        if(!this.guideDrag) {
            return 0;
        }

        return this.guideDrag.axis === 'x'
            ? this.canvasToViewportX(this.guideDrag.value)
            : this.canvasToViewportY(this.guideDrag.value);
    }

    activeGuideLabel(): string {
        if(!this.guideDrag) {
            return '';
        }

        return `${this.guideDrag.axis} ${this.formatGuideValue(this.guideDrag.value)}`;
    }

    activeGuideBadgeStyle(): Record<string, string> {
        if(!this.guideDrag) {
            return {};
        }

        const left = this.guideDrag.axis === 'x'
            ? this.activeGuideScreenPosition() + 8
            : this.rulerSize + 8;
        const top = this.guideDrag.axis === 'y'
            ? this.activeGuideScreenPosition() + 8
            : this.rulerSize + 8;

        return {
            left: `${left}px`,
            top: `${top}px`,
        };
    }

    rulerMarks(axis: "x" | "y"): RulerMark[] {
        const svg = this.editor.selectedSVG;
        const viewport = this.viewPort?.nativeElement;
        if(!svg || !viewport) {
            return [];
        }

        const length = axis === "x" ? svg.width : svg.height;
        const viewportLength = axis === "x" ? viewport.clientWidth : viewport.clientHeight;
        const step = this.rulerStep(svg.zoom);
        const start = 0;
        const marks: RulerMark[] = [];

        for(let value = start; value <= length + 0.0001; value += step) {
            const position = axis === "x"
                ? this.canvasToViewportX(value) - this.rulerSize
                : this.canvasToViewportY(value) - this.rulerSize;
            if(position < -80 || position > viewportLength - this.rulerSize + 80) {
                continue;
            }

            marks.push({
                value,
                position,
                major: true,
                label: String(Math.round(value)),
            });
        }

        return marks;
    }

    canDragGuides(): boolean {
        return !this.editor.selectedSVG?.guidesLocked && (this.editor.selectedTool?.interactsWithGuides ?? false);
    }

    toggleGuideLock(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        const svg = this.editor.selectedSVG;
        if(!svg) {
            return;
        }

        svg.guidesLocked = !svg.guidesLocked;
        this.guideDrag = undefined;
        this.guideInput = undefined;
        this.editor.closeContextMenu();
        this.snapshotAndSave();
    }

    beginRulerGuideDrag(axis: "x" | "y", event: PointerEvent) {
        if(event.button !== 0 || !this.editor.selectedSVG || this.editor.selectedSVG.guidesLocked) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        if(event.detail > 1) {
            return;
        }

        const guide: CanvasGuide = {
            id: this.editor.ID,
            axis,
            value: this.guideValueFromEvent(axis, event, event.shiftKey),
        };
        this.editor.selectedSVG.guides.push(guide);
        this.guideDrag = {
            pointerId: event.pointerId,
            guide,
            axis,
            value: guide.value,
            created: true,
        };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    beginExistingGuideDrag(guide: CanvasGuide, event: PointerEvent) {
        if(event.button !== 0 || this.editor.selectedSVG?.guidesLocked) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.guideDrag = {
            pointerId: event.pointerId,
            guide,
            axis: guide.axis,
            value: guide.value,
            created: false,
        };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    updateGuideDrag(event: PointerEvent) {
        if(!this.guideDrag || this.guideDrag.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.guideDrag.value = this.guideValueFromEvent(this.guideDrag.axis, event, event.shiftKey);
        this.guideDrag.guide.value = this.guideDrag.value;
    }

    endGuideDrag(event: PointerEvent) {
        if(!this.guideDrag || this.guideDrag.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        try {
            (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {}

        const shouldDelete = this.guideIsInDeleteZone(this.guideDrag.axis, event);
        if(shouldDelete) {
            this.deleteGuideFromSvg(this.guideDrag.guide);
            this.lastRulerGuideCreated = undefined;
            this.guideDrag = undefined;
            this.snapshotAndSave();
            return;
        }

        this.guideDrag.guide.value = this.guideDrag.value;
        if(this.guideDrag.created) {
            this.lastRulerGuideCreated = this.guideDrag.guide;
        }
        this.guideDrag = undefined;
        this.snapshotAndSave();
    }

    openGuideContextMenu(guide: CanvasGuide, event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        if(this.editor.selectedSVG?.guidesLocked) {
            return;
        }

        this.editor.openContextMenu(event.clientX, event.clientY, [
            {
                label: 'Edit Position',
                action: () => {
                    this.openGuideInput(guide.axis, event.clientX, event.clientY, guide);
                },
            },
            {
                label: 'Delete Guide',
                shortcut: 'Del',
                action: () => {
                    this.deleteGuide(guide);
                },
            },
        ]);
    }

    openRulerInput(axis: "x" | "y", event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        if(this.editor.selectedSVG?.guidesLocked) {
            return;
        }

        this.removeLastRulerGuideIfMatching(axis, event);
        this.openGuideInput(axis, event.clientX, event.clientY);
    }

    openGuideInput(axis: "x" | "y", clientX: number, clientY: number, guide?: CanvasGuide) {
        if(this.editor.selectedSVG?.guidesLocked) {
            return;
        }

        const viewport = this.viewPort?.nativeElement.getBoundingClientRect();
        const existingValue = guide?.value ?? this.guideValueFromClient(axis, clientX, clientY, false);
        this.guideInput = {
            axis,
            guide,
            value: this.formatGuideValue(existingValue),
            x: viewport ? Math.max(this.rulerSize + 4, Math.min(viewport.width - 180, clientX - viewport.left)) : clientX,
            y: viewport ? Math.max(this.rulerSize + 4, Math.min(viewport.height - 48, clientY - viewport.top)) : clientY,
            error: undefined,
        };
        this.editor.closeContextMenu();
    }

    applyGuideInput() {
        if(!this.guideInput || !this.editor.selectedSVG || this.editor.selectedSVG.guidesLocked) {
            return;
        }

        const parsed = this.parseGuideExpression(this.guideInput.value, this.guideInput.axis);
        if(parsed == null) {
            this.guideInput.error = 'Invalid position';
            return;
        }

        const guide = this.guideInput.guide ?? {
            id: this.editor.ID,
            axis: this.guideInput.axis,
            value: parsed,
        };
        guide.value = parsed;
        if(!this.guideInput.guide) {
            this.editor.selectedSVG.guides.push(guide);
        }

        this.guideInput = undefined;
        this.snapshotAndSave();
    }

    cancelGuideInput() {
        this.guideInput = undefined;
    }

    deleteGuide(guide: CanvasGuide) {
        if(this.editor.selectedSVG?.guidesLocked) {
            return;
        }

        this.deleteGuideFromSvg(guide);
        this.snapshotAndSave();
    }

    private guideValueFromEvent(axis: "x" | "y", event: PointerEvent | MouseEvent, roundToTen: boolean): number {
        return this.guideValueFromClient(axis, event.clientX, event.clientY, roundToTen);
    }

    private removeLastRulerGuideIfMatching(axis: "x" | "y", event: MouseEvent) {
        const svg = this.editor.selectedSVG;
        const guide = this.lastRulerGuideCreated;
        if(!svg || !guide || guide.axis !== axis) {
            return;
        }

        const value = this.guideValueFromEvent(axis, event, false);
        const threshold = 6 / Math.max(0.01, svg.zoom || 1);
        if(Math.abs(guide.value - value) <= threshold) {
            this.deleteGuideFromSvg(guide);
            this.lastRulerGuideCreated = undefined;
            this.snapshotAndSave();
        }
    }

    private guideValueFromClient(axis: "x" | "y", clientX: number, clientY: number, roundToTen: boolean): number {
        const canvasPoint = this.editor.toCanvasPoint(clientX, clientY);
        let value = axis === "x" ? canvasPoint.x : canvasPoint.y;
        if(roundToTen) {
            value = Math.round(value / 10) * 10;
        }

        return value;
    }

    private canvasRectInViewport(): { left: number; top: number; width: number; height: number } | undefined {
        const canvas = this.canvas?.nativeElement;
        const viewport = this.viewPort?.nativeElement;
        if(!canvas || !viewport) {
            return undefined;
        }

        const canvasRect = canvas.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        return {
            left: canvasRect.left - viewportRect.left,
            top: canvasRect.top - viewportRect.top,
            width: canvasRect.width,
            height: canvasRect.height,
        };
    }

    private guideIsInDeleteZone(axis: "x" | "y", event: PointerEvent): boolean {
        const viewport = this.viewPort?.nativeElement.getBoundingClientRect();
        if(!viewport) {
            return false;
        }

        return axis === "x"
            ? event.clientX <= viewport.left + this.rulerSize
            : event.clientY <= viewport.top + this.rulerSize;
    }

    private deleteGuideFromSvg(guide: CanvasGuide) {
        const svg = this.editor.selectedSVG;
        if(!svg) {
            return;
        }

        svg.guides = svg.guides.filter((candidate) => candidate !== guide);
    }

    private formatGuideValue(value: number): string {
        return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
    }

    private rulerStep(zoom: number): number {
        const targetPx = 96;
        const raw = targetPx / Math.max(0.01, zoom);
        const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
        const normalized = raw / magnitude;
        const step = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
        return step * magnitude;
    }

    private parseGuideExpression(input: string, axis: "x" | "y"): number | undefined {
        const svg = this.editor.selectedSVG;
        if(!svg) {
            return undefined;
        }

        const raw = input.trim().toLowerCase();
        const axisLength = axis === "x" ? svg.width : svg.height;
        if(raw === "center") {
            return axisLength / 2;
        }

        const negativeNumber = /^-\d+(\.\d+)?$/.exec(raw);
        if(negativeNumber) {
            return axisLength + Number(raw);
        }

        const percent = /^(-?\d+(\.\d+)?)%$/.exec(raw);
        if(percent) {
            return axisLength * Number(percent[1]) / 100;
        }

        const tokens = this.tokenizeGuideExpression(raw);
        if(tokens.length === 0) {
            return undefined;
        }

        let index = 0;
        const peek = () => tokens[index];
        const consume = () => tokens[index++];

        const parseFactor = (): number | undefined => {
            const token = consume();
            if(!token) {
                return undefined;
            }

            if(token === "+") {
                return parseFactor();
            }

            if(token === "-") {
                const value = parseFactor();
                return value == null ? undefined : -value;
            }

            if(token === "(") {
                const value = parseExpression();
                if(consume() !== ")") {
                    return undefined;
                }
                return value;
            }

            if(token === "w") {
                return svg.width;
            }

            if(token === "h") {
                return svg.height;
            }

            const numeric = Number(token);
            return Number.isFinite(numeric) ? numeric : undefined;
        };

        const parseTerm = (): number | undefined => {
            let value = parseFactor();
            while(value != null && (peek() === "*" || peek() === "/")) {
                const operator = consume();
                const right = parseFactor();
                if(right == null) {
                    return undefined;
                }
                value = operator === "*" ? value * right : value / right;
            }
            return value;
        };

        const parseExpression = (): number | undefined => {
            let value = parseTerm();
            while(value != null && (peek() === "+" || peek() === "-")) {
                const operator = consume();
                const right = parseTerm();
                if(right == null) {
                    return undefined;
                }
                value = operator === "+" ? value + right : value - right;
            }
            return value;
        };

        const value = parseExpression();
        if(value == null || index !== tokens.length || !Number.isFinite(value)) {
            return undefined;
        }

        return value;
    }

    private tokenizeGuideExpression(input: string): string[] {
        const tokens: string[] = [];
        let i = 0;
        while(i < input.length) {
            const char = input[i];
            if(/\s/.test(char)) {
                i++;
                continue;
            }

            if(/[()+\-*/]/.test(char)) {
                tokens.push(char);
                i++;
                continue;
            }

            const numberMatch = /^\d+(\.\d+)?/.exec(input.slice(i));
            if(numberMatch) {
                tokens.push(numberMatch[0]);
                i += numberMatch[0].length;
                continue;
            }

            if(char === "w" || char === "h") {
                tokens.push(char);
                i++;
                continue;
            }

            return [];
        }

        return tokens;
    }

    // ── Auto-save ────────────────────────────────────────────────────

    autoSave() {
        this.mutations.save();
    }

    private snapshotAndSave() {
        this.mutations.commit();
    }

    private currentElementsState(): string | undefined {
        return this.mutations.captureState();
    }

    private snapshotAndSaveIfChanged(beforeState?: string, beforeRevision = this.mutations.revision) {
        if(this.mutations.revision !== beforeRevision) {
            return;
        }

        const afterState = this.currentElementsState();
        if(beforeState !== afterState) {
            this.snapshotAndSave();
        }
    }

    scheduleAttributeSnapshot() {
        this.mutations.schedule();
    }

    runContextMenuItem(item: EditorContextMenuItem) {
        const beforeRevision = this.mutations.revision;
        const beforeState = this.currentElementsState();
        this.editor.runContextMenuItem(item);
        this.snapshotAndSaveIfChanged(beforeState, beforeRevision);
    }

    contextMenuOpensLeft(): boolean {
        return !!this.editor.contextMenu
            && typeof window !== 'undefined'
            && this.editor.contextMenu.x > window.innerWidth / 2;
    }

    // ── Export ───────────────────────────────────────────────────────

    openExportDialog() {
        if(!this.editor.selectedSVG) return;
        this.exportBakeRoundedCorners = true;
        this.showExportDialog = true;
    }

    cancelExport() {
        this.showExportDialog = false;
    }

    confirmExportSVG() {
        const svg = this.editor.selectedSVG;
        if(!svg) return;
        const options = { bakeRoundedCorners: this.exportBakeRoundedCorners };
        const markup = this.animation.mode === 'animate'
            ? buildSVGMarkup(svg, options)
            : this.animation.withBaseState(() => buildSVGMarkup(svg, options));
        const blob = new Blob([markup], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${svg.name ?? 'drawing'}.svg`;
        a.click();
        URL.revokeObjectURL(url);
        this.showExportDialog = false;
    }

    setEditorMode(mode: 'edit' | 'animate') {
        this.animation.setMode(mode);
    }

    private restoreAnimationPreview() {
        if(this.animation.mode === 'animate') {
            this.animation.seek(this.animation.currentTime);
        }
    }

    setAnimationDuration(value: number | string | null) {
        const numeric = typeof value === 'number' ? value : Number(value);
        if(!Number.isFinite(numeric)) {
            return;
        }

        this.animation.setDuration(numeric);
        this.scheduleAttributeSnapshot();
    }

    setAnimationLoop(value: boolean) {
        this.animation.setLoop(value);
        this.scheduleAttributeSnapshot();
    }

    handleTimelineChange() {
        this.snapshotAndSave();
    }

    selectSVGTab(id: string) {
        this.animation.pause();
        this.animation.restorePreview();
        this.editor.selectSVG(id);
        if(this.animation.mode === 'animate') {
            this.animation.seek(0);
        }
        this.mutations.resetBaseline();
    }

    closeSVGTab(id: string) {
        this.animation.pause();
        this.animation.restorePreview();
        this.editor.closeSVG(id);
        if(this.animation.mode === 'animate') {
            this.animation.seek(0);
        }
        this.mutations.resetBaseline();
    }

    get layers() {
        return [...(this.editor.selectedSVG?.elements ?? [])].reverse();
    }

    get layerRows(): LayerRow[] {
        return this.buildLayerRows(this.editor.selectedSVG?.elements ?? [], 0);
    }

    trackLayerRow(_index: number, row: LayerRow): string {
        return row.element.id;
    }

    private buildLayerRows(elements: AnyElement[], depth: number, parent?: Group): LayerRow[] {
        const rows: LayerRow[] = [];

        [...elements].reverse().forEach((element) => {
            rows.push({ element, depth, parent });
            if(element instanceof Group && !this.groupIsCollapsed(element)) {
                rows.push(...this.buildLayerRows(element.elements, depth + 1, element));
            }
        });

        return rows;
    }

    asGroup(element: AnyElement): Group | null {
        return element instanceof Group ? element : null;
    }

    asShape(element: AnyElement | undefined): Shape | null {
        return element instanceof Shape ? element : null;
    }

    asPath(element: AnyElement | undefined): Path | null {
        return element instanceof Path ? element : null;
    }

    groupIsCollapsed(group: Group): boolean {
        return this.collapsedGroupIds.has(group.id);
    }

    toggleGroupCollapsed(event: MouseEvent, group: Group) {
        event.stopPropagation();
        if(this.collapsedGroupIds.has(group.id)) {
            this.collapsedGroupIds.delete(group.id);
        } else {
            this.collapsedGroupIds.add(group.id);
        }
    }

    isLayerSelected(element: AnyElement): boolean {
        return this.selectedLayers.includes(element) || this.editor.selectedElement === element;
    }

    clippingGroupFor(element: AnyElement): Group | undefined {
        const context = this.layerContext(element);
        return context?.parent?.clipElementId === element.id ? context.parent : undefined;
    }

    isClippingMask(element: AnyElement): boolean {
        return !!this.clippingGroupFor(element);
    }

    /** Bridge for template dynamic-key access on the now-typed settings object. */
    settingsOf(element: AnyElement | undefined): Record<string, any> {
        return (element?.settings ?? {}) as Record<string, any>;
    }

    handleAttributeChange(element: AnyElement | undefined, attr: ElementAttribute, value: unknown) {
        if(!element) {
            return;
        }

        const property = `settings.${attr.output}`;
        const definition = this.ANIMATABLE_PROPERTIES.find((candidate) => candidate.property === property);
        if(this.animation.mode === 'animate' && definition && this.animationPropertySupported(element, definition)) {
            this.animation.setAnimatedPropertyValue(element, property, definition.valueType, this.normalizeAnimationValue(value, definition));
            this.scheduleAttributeSnapshot();
            return;
        }

        this.settingsOf(element)[attr.output] = value;
        this.scheduleAttributeSnapshot();
    }

    transformValue(element: AnyElement | undefined, field: TransformField): number {
        if(!element) {
            return 0;
        }

        if(field === 'originX' || field === 'originY') {
            const origin = resolvedOrigin(element);
            return field === 'originX' ? origin.x : origin.y;
        }

        return element.transform[field];
    }

    setTransformValue(element: AnyElement | undefined, field: TransformField, value: number | string | null) {
        if(!element) {
            return;
        }

        const numeric = typeof value === 'number' ? value : Number(value);
        if(!Number.isFinite(numeric)) {
            return;
        }

        if(this.animation.mode === 'animate') {
            if((field === 'scaleX' || field === 'scaleY' || field === 'rotation') && (element.transform.originX == null || element.transform.originY == null)) {
                pinTransformOrigin(element);
            }
            this.animation.setAnimatedPropertyValue(element, `transform.${field}`, 'number', numeric);
            this.scheduleAttributeSnapshot();
            return;
        }

        if((field === 'scaleX' || field === 'scaleY' || field === 'rotation') && (element.transform.originX == null || element.transform.originY == null)) {
            pinTransformOrigin(element);
        }

        element.transform[field] = numeric;
        this.scheduleAttributeSnapshot();
    }

    flipElement(element: AnyElement | undefined, axis: 'x' | 'y') {
        if(!element) {
            return;
        }

        if(element.transform.originX == null || element.transform.originY == null) {
            pinTransformOrigin(element);
        }

        if(axis === 'x') {
            element.transform.scaleX = -element.transform.scaleX;
        } else {
            element.transform.scaleY = -element.transform.scaleY;
        }

        this.scheduleAttributeSnapshot();
    }

    shapeFrameValue(shape: Shape, field: ShapeFrameField): number {
        switch(field) {
            case 'x': return shape.position.x;
            case 'y': return shape.position.y;
            case 'width': return shape.settings.width;
            case 'height': return shape.settings.height;
        }
    }

    setShapeFrameValue(shape: Shape, field: ShapeFrameField, value: number | string | null) {
        const numeric = typeof value === 'number' ? value : Number(value);
        if(!Number.isFinite(numeric)) {
            return;
        }

        switch(field) {
            case 'x':
                shape.position.x = numeric;
                break;
            case 'y':
                shape.position.y = numeric;
                break;
            case 'width':
                shape.settings.width = Math.max(1, numeric);
                break;
            case 'height':
                shape.settings.height = Math.max(1, numeric);
                break;
        }

        this.scheduleAttributeSnapshot();
    }

    selectedCornerAnchor(path: Path): Point | null {
        const anchor = this.editor.selectedPathAnchor;
        return anchor && path.findPointById(anchor.id) === anchor ? anchor : null;
    }

    cornerRadiusValue(anchor: Point): number {
        return anchor.cornerRadius ?? 0;
    }

    cornerRadiusEnabled(path: Path, anchor: Point): boolean {
        return path.cornerEligible(anchor);
    }

    anchorPositionValue(anchor: Point, axis: 'x' | 'y'): number {
        return anchor[axis];
    }

    setAnchorPositionValue(path: Path, anchor: Point, axis: 'x' | 'y', value: number | string | null) {
        const numeric = typeof value === 'number' ? value : Number(value);
        if(!Number.isFinite(numeric)) {
            return;
        }

        const delta = axis === 'x'
            ? new Point(numeric - anchor.x, 0)
            : new Point(0, numeric - anchor.y);
        this.movePathAnchor(path, anchor, delta);
        this.scheduleAttributeSnapshot();
    }

    setCornerRadius(path: Path, anchor: Point, value: number | string | null) {
        const numeric = typeof value === 'number' ? value : Number(value);
        if(!Number.isFinite(numeric)) {
            return;
        }

        anchor.cornerRadius = Math.max(0, numeric);
        this.scheduleAttributeSnapshot();
    }

    private movePathAnchor(path: Path, anchor: Point, delta: Point) {
        const moved: Point[] = [anchor];
        anchor.addTo(delta);

        path.contours.flatMap((contour) => contour.lines).forEach((line) => {
            if(line.points[0] == anchor && line.controlStart && !moved.includes(line.controlStart)) {
                line.controlStart.addTo(delta);
                moved.push(line.controlStart);
            }

            if(line.points[1] == anchor && line.controlEnd && !moved.includes(line.controlEnd)) {
                line.controlEnd.addTo(delta);
                moved.push(line.controlEnd);
            }
        });
    }

    animationPropertiesFor(element: AnyElement | undefined): readonly AnimatablePropertyDefinition[] {
        if(!element) {
            return [];
        }

        return this.ANIMATABLE_PROPERTIES.filter((definition) => this.animationPropertySupported(element, definition));
    }

    addOrUpdateAnimationKey(element: AnyElement, definition: AnimatablePropertyDefinition) {
        if((definition.property === 'transform.scaleX' || definition.property === 'transform.scaleY' || definition.property === 'transform.rotation') && (element.transform.originX == null || element.transform.originY == null)) {
            pinTransformOrigin(element);
        }

        this.animation.upsertKeyframe(element, definition.property, definition.valueType);
        this.snapshotAndSave();
    }

    removeAnimationKey(element: AnyElement, definition: AnimatablePropertyDefinition) {
        this.animation.removeKeyframeAtCurrentTime(element, definition.property);
        this.snapshotAndSave();
    }

    animationPropertyValue(element: AnyElement, definition: AnimatablePropertyDefinition): string {
        const value = readAnimationProperty(element, definition.property);
        if(typeof value === 'number') {
            return Number.isInteger(value) ? String(value) : value.toFixed(2);
        }

        if(value == null) {
            return '-';
        }

        return String(value);
    }

    private animationPropertySupported(element: AnyElement, definition: AnimatablePropertyDefinition): boolean {
        if(definition.property === 'path.drawProgress') {
            return element instanceof Path;
        }

        if(definition.property.startsWith('motion.')) {
            return !!element.motion.pathId;
        }

        if(definition.property.startsWith('transform.') || definition.property === 'visible' || definition.property === 'opacity') {
            return true;
        }

        if(definition.property.startsWith('settings.')) {
            const key = definition.property.slice('settings.'.length);
            return key in (element.settings as Record<string, unknown>);
        }

        return readAnimationProperty(element, definition.property) !== undefined;
    }

    private normalizeAnimationValue(value: unknown, definition: AnimatablePropertyDefinition): unknown {
        if(definition.valueType === 'color') {
            return createAnimationColorValue(value, value instanceof Color ? value.preferredSpace : 'rgb');
        }

        if(definition.valueType === 'number') {
            const numeric = typeof value === 'number' ? value : Number(value);
            if(!Number.isFinite(numeric)) {
                return value;
            }

            return definition.property === 'path.drawProgress' || definition.property === 'motion.progress'
                ? Math.max(0, Math.min(1, numeric))
                : numeric;
        }

        return value;
    }

    private captureAnimationTransformDragStart() {
        if(this.animation.mode !== 'animate' || !this.editor.selectedElement) {
            this.animationTransformDragStart = undefined;
            return;
        }

        this.animationTransformDragStart = {
            element: this.editor.selectedElement,
            values: this.transformAnimationValues(this.editor.selectedElement),
        };
    }

    private commitAnimationTransformDrag() {
        const start = this.animationTransformDragStart;
        this.animationTransformDragStart = undefined;
        if(this.animation.mode !== 'animate' || !start || this.editor.selectedElement !== start.element) {
            return;
        }

        if(start.element instanceof Path && this.animationPathPointDragStart?.path === start.element && this.pathPointValuesChanged(this.animationPathPointDragStart)) {
            return;
        }

        const currentValues = this.transformAnimationValues(start.element);
        this.ANIMATABLE_PROPERTIES
            .filter((definition) => definition.property.startsWith('transform.'))
            .forEach((definition) => {
                const startValue = start.values[definition.property];
                const currentValue = currentValues[definition.property];
                if(startValue == null || currentValue == null || Math.abs(currentValue - startValue) < 0.0005) {
                    return;
                }

                this.animation.upsertKeyframe(start.element, definition.property, definition.valueType, currentValue, startValue);
            });
    }

    private captureAnimationPathPointDragStart() {
        if(this.animation.mode !== 'animate' || !(this.editor.selectedElement instanceof Path)) {
            this.animationPathPointDragStart = undefined;
            return;
        }

        this.animationPathPointDragStart = {
            path: this.editor.selectedElement,
            values: this.pathPointAnimationValues(this.editor.selectedElement),
        };
    }

    private commitAnimationPathPointDrag() {
        const start = this.animationPathPointDragStart;
        this.animationPathPointDragStart = undefined;
        if(this.animation.mode !== 'animate' || !start || this.editor.selectedElement !== start.path) {
            return;
        }

        const currentValues = this.pathPointAnimationValues(start.path);
        const changed: Array<{ id: string; axis: 'x' | 'y'; value: number; baseline: number }> = [];
        Object.entries(currentValues).forEach(([id, current]) => {
            const baseline = start.values[id];
            if(!baseline) {
                return;
            }

            if(Math.abs(current.x - baseline.x) >= 0.0005) {
                changed.push({ id, axis: 'x', value: current.x, baseline: baseline.x });
            }

            if(Math.abs(current.y - baseline.y) >= 0.0005) {
                changed.push({ id, axis: 'y', value: current.y, baseline: baseline.y });
            }
        });

        if(changed.length === 0) {
            return;
        }

        changed.forEach((change) => {
            this.animation.upsertKeyframe(
                start.path,
                pathPointAnimationProperty(change.id, change.axis),
                'number',
                change.value,
                change.baseline
            );
        });
    }

    private transformAnimationValues(element: AnyElement): Record<string, number> {
        const values: Record<string, number> = {};
        this.ANIMATABLE_PROPERTIES
            .filter((definition) => definition.property.startsWith('transform.'))
            .forEach((definition) => {
                const value = readAnimationProperty(element, definition.property);
                if(typeof value === 'number' && Number.isFinite(value)) {
                    values[definition.property] = value;
                }
        });
        return values;
    }

    private pathPointValuesChanged(start: AnimationPathPointDragStart): boolean {
        const currentValues = this.pathPointAnimationValues(start.path);
        return Object.entries(currentValues).some(([id, current]) => {
            const baseline = start.values[id];
            return !!baseline && (
                Math.abs(current.x - baseline.x) >= 0.0005 ||
                Math.abs(current.y - baseline.y) >= 0.0005
            );
        });
    }

    private pathPointAnimationValues(path: Path): Record<string, { x: number; y: number }> {
        const values: Record<string, { x: number; y: number }> = {};
        path.pathPoints().forEach((point) => {
            values[point.id] = { x: point.x, y: point.y };
        });
        return values;
    }

    selectLayer(element: AnyElement, event?: MouseEvent) {
        if(this.suppressLayerClick) {
            return;
        }

        this.renamingLayer = undefined;
        if(event?.shiftKey && this.lastSelectedLayer) {
            const rows = this.layerRows.map((row) => row.element);
            const start = rows.indexOf(this.lastSelectedLayer);
            const end = rows.indexOf(element);
            if(start >= 0 && end >= 0) {
                const [from, to] = start < end ? [start, end] : [end, start];
                this.selectedLayers = rows.slice(from, to + 1);
            } else {
                this.selectedLayers = [element];
            }
        } else if(event?.ctrlKey || event?.metaKey) {
            if(this.selectedLayers.includes(element)) {
                this.selectedLayers = this.selectedLayers.filter((layer) => layer !== element);
            } else {
                this.selectedLayers = [...this.selectedLayers, element];
            }
            this.lastSelectedLayer = element;
        } else {
            this.selectedLayers = [element];
            this.lastSelectedLayer = element;
        }

        this.editor.selectedElement = this.selectedLayers.length == 1 ? this.selectedLayers[0] : undefined;
        this.editor.selectedPathAnchor = undefined;
        this.editor.selectedPathLine = undefined;
        this.editor.selectedPathLines = [];
    }

    private layerContext(element: AnyElement): LayerContext | undefined {
        return this.layerOperations.context(element);
    }

    private canGroupWithBelow(element: AnyElement): boolean {
        const context = this.layerContext(element);
        return !!context && context.index > 0;
    }

    private canClipWithLayerBelow(element: AnyElement): boolean {
        return this.canGroupWithBelow(element);
    }

    private selectedLayerContexts(): LayerContext[] {
        return this.layerOperations.contexts(this.selectedLayers);
    }

    canGroupSelectedLayers(): boolean {
        return this.layerOperations.canGroup(this.selectedLayers);
    }

    canCombineSelectedPaths(target: AnyElement): target is Path {
        return this.layerOperations.canCombine(this.selectedLayers, target);
    }

    combineSelectedPaths(target: Path) {
        if(this.layerOperations.combine(this.selectedLayers, target)) {
            this.selectLayer(target);
            this.snapshotAndSave();
        }
    }

    groupSelectedLayers() {
        const group = this.layerOperations.group(this.selectedLayers);
        if(group) {
            this.selectLayer(group);
            this.snapshotAndSave();
        }
    }

    private elementContains(parent: AnyElement, child: AnyElement): boolean {
        return this.layerOperations.contains(parent, child);
    }

    private removeLayerFromSelection(element: AnyElement) {
        this.selectedLayers = this.selectedLayers.filter((layer) => {
            return layer !== element && !this.elementContains(element, layer);
        });
        if(this.lastSelectedLayer && (this.lastSelectedLayer === element || this.elementContains(element, this.lastSelectedLayer))) {
            this.lastSelectedLayer = undefined;
        }
    }

    beginLayerRename(event: MouseEvent, element: AnyElement) {
        event.stopPropagation();
        this.selectLayer(element);
        this.renamingLayer = element;
    }

    finishLayerRename() {
        if(this.renamingLayer) {
            this.renamingLayer.name = this.renamingLayer.name.trim() || 'Layer';
            this.snapshotAndSave();
        }
        this.renamingLayer = undefined;
    }

    duplicateLayer(element: AnyElement) {
        const duplicate = this.layerOperations.duplicate(element);
        if(duplicate) {
            this.selectLayer(duplicate);
            this.snapshotAndSave();
        }
    }

    convertLayerStrokeToPath(path: Path, profile: StrokeToPathProfile) {
        const converted = this.layerOperations.convertStroke(path, profile);
        if(converted) {
            this.selectLayer(converted);
            this.snapshotAndSave();
        }
    }

    deleteLayer(element: AnyElement) {
        if(!this.layerOperations.delete(element)) return;
        if(this.editor.selectedElement === element || (this.editor.selectedElement && this.elementContains(element, this.editor.selectedElement))) {
            this.editor.selectedElement = undefined;
            this.editor.selectedPathAnchor = undefined;
            this.editor.selectedPathLine = undefined;
            this.editor.selectedPathLines = [];
        }
        this.removeLayerFromSelection(element);
        this.snapshotAndSave();
    }

    deleteSelectedLayers() {
        if(!this.editor.selectedSVG || this.selectedLayers.length == 0) {
            return;
        }

        if(!this.layerOperations.deleteMany(this.selectedLayers)) return;

        this.selectedLayers = [];
        this.lastSelectedLayer = undefined;
        this.editor.selectedElement = undefined;
        this.editor.selectedPathAnchor = undefined;
        this.editor.selectedPathLine = undefined;
        this.editor.selectedPathLines = [];
        this.snapshotAndSave();
    }

    moveLayerBackward(element: AnyElement) {
        if(this.layerOperations.moveBackward(element)) this.snapshotAndSave();
    }

    moveLayerForward(element: AnyElement) {
        if(this.layerOperations.moveForward(element)) this.snapshotAndSave();
    }

    groupLayerWithBelow(element: AnyElement) {
        const group = this.layerOperations.groupWithBelow(element);
        if(group) {
            this.selectLayer(group);
            this.snapshotAndSave();
        }
    }

    clipLayerWithBelow(element: AnyElement) {
        if(this.layerOperations.groupWithBelow(element, true)) {
            this.selectLayer(element);
            this.snapshotAndSave();
        }
    }

    ungroupLayer(group: Group) {
        const elements = this.layerOperations.ungroup(group);
        if(!elements) return;
        this.selectedLayers = elements;
        this.lastSelectedLayer = this.selectedLayers[this.selectedLayers.length - 1];
        if(this.editor.selectedElement === group) {
            this.editor.selectedElement = undefined;
            this.editor.selectedPathAnchor = undefined;
            this.editor.selectedPathLine = undefined;
            this.editor.selectedPathLines = [];
        }
        this.snapshotAndSave();
    }

    canUseAsClippingMask(element: AnyElement): boolean {
        const context = this.layerContext(element);
        return !!context?.parent && context.parent.clipElementId !== element.id;
    }

    useLayerAsClippingMask(element: AnyElement) {
        if(this.layerOperations.useAsClippingMask(element)) this.snapshotAndSave();
    }

    releaseClippingMask(group: Group) {
        if(this.layerOperations.releaseClippingMask(group)) this.snapshotAndSave();
    }

    availableMotionPaths(element: AnyElement): Path[] {
        return this.layerOperations.availableMotionPaths(element);
    }

    attachMotionPath(element: AnyElement, path: Path) {
        if(this.layerOperations.attachMotionPath(element, path)) this.snapshotAndSave();
    }

    detachMotionPath(element: AnyElement) {
        if(this.layerOperations.detachMotionPath(element)) this.snapshotAndSave();
    }

    openLayerContextMenu(event: MouseEvent, element: AnyElement) {
        event.preventDefault();
        event.stopPropagation();
        if(!this.selectedLayers.includes(element)) {
            this.selectLayer(element);
        }

        const menuPosition = new Point(event.clientX, event.clientY);
        const motionPaths = this.availableMotionPaths(element);
        const items: EditorContextMenuItem[] = [
            {
                label: 'Rename Layer',
                shortcut: 'Enter',
                action: () => {
                    this.renamingLayer = element;
                }
            },
            {
                label: 'Duplicate Layer',
                shortcut: 'Ctrl+D',
                action: () => {
                    this.duplicateLayer(element);
                }
            },
            ...(motionPaths.length ? [{
                label: 'Attach Motion To',
                children: motionPaths.map((path) => ({
                    label: path.name,
                    action: () => {
                        this.attachMotionPath(element, path);
                    }
                }))
            }] : []),
            ...(element.motion.pathId ? [{
                label: 'Detach Motion Path',
                action: () => {
                    this.detachMotionPath(element);
                }
            }] : []),
            ...(element instanceof Path && canConvertStrokeToPath(element) ? [{
                label: 'Convert Stroke To Path',
                children: [{
                    label: 'Optimized',
                    action: () => {
                        this.convertLayerStrokeToPath(element, 'optimized');
                    }
                }, {
                    label: 'Precise',
                    action: () => {
                        this.convertLayerStrokeToPath(element, 'precise');
                    }
                }]
            }] : []),
            ...(this.canCombineSelectedPaths(element) ? [{
                label: 'Combine Selected Paths',
                action: () => {
                    this.combineSelectedPaths(element);
                }
            }] : []),
            ...(this.canGroupSelectedLayers() ? [{
                label: 'Group Selection',
                shortcut: 'Ctrl+G',
                action: () => {
                    this.groupSelectedLayers();
                }
            }] : []),
            ...(this.selectedLayers.length > 1 ? [{
                label: 'Delete Selection',
                shortcut: 'Del',
                action: () => {
                    this.deleteSelectedLayers();
                }
            }] : []),
            ...(this.canGroupWithBelow(element) ? [{
                label: 'Group With Layer Below',
                action: () => {
                    this.groupLayerWithBelow(element);
                }
            }] : []),
            ...(this.canClipWithLayerBelow(element) ? [{
                label: 'Clip With Layer Below',
                action: () => {
                    this.clipLayerWithBelow(element);
                }
            }] : []),
            ...(element instanceof Group ? [{
                label: 'Ungroup',
                action: () => {
                    this.ungroupLayer(element);
                }
            }] : []),
            ...(this.canUseAsClippingMask(element) ? [{
                label: 'Use As Clipping Mask',
                action: () => {
                    this.useLayerAsClippingMask(element);
                }
            }] : []),
            ...(this.clippingGroupFor(element) ? [{
                label: 'Release Clipping Mask',
                action: () => {
                    this.releaseClippingMask(this.clippingGroupFor(element)!);
                }
            }] : []),
            ...(element instanceof Group && element.clipElement ? [{
                label: 'Release Clipping Mask',
                action: () => {
                    this.releaseClippingMask(element);
                }
            }] : []),
            {
                label: 'Move Forward',
                shortcut: ']',
                action: () => {
                    this.moveLayerForward(element);
                }
            },
            {
                label: 'Move Backward',
                shortcut: '[',
                action: () => {
                    this.moveLayerBackward(element);
                }
            },
            {
                label: 'Delete Layer',
                shortcut: 'Del',
                action: () => {
                    this.deleteLayer(element);
                }
            }
        ];

        this.editor.openContextMenu(menuPosition.x, menuPosition.y, items);
        this.editor.contextMenu!.infoTitle = 'Layer Shortcuts';
        this.editor.contextMenu!.infoLines = [
            'Enter: rename selected layer',
            'Ctrl+D: duplicate selected layer',
            'Group layers from the layer context menu',
            ']: move selected layer forward',
            '[: move selected layer backward',
            'Del: delete selected layer',
        ];
    }

    toggleLayerVisibility(event: MouseEvent, element: AnyElement) {
        event.stopPropagation();
        this.layerOperations.toggleVisibility(element);
        if(!element.visible && this.editor.selectedElement && (this.editor.selectedElement == element || this.elementContains(element, this.editor.selectedElement))) {
            this.editor.selectedPathAnchor = undefined;
            this.editor.selectedPathLine = undefined;
            this.editor.selectedPathLines = [];
        }
        this.snapshotAndSave();
    }

    toggleLayerLock(event: MouseEvent, element: AnyElement) {
        event.stopPropagation();
        this.layerOperations.toggleLock(element);
        if(element.locked && this.editor.selectedElement && (this.editor.selectedElement == element || this.elementContains(element, this.editor.selectedElement))) {
            this.editor.selectedPathAnchor = undefined;
            this.editor.selectedPathLine = undefined;
            this.editor.selectedPathLines = [];
        }
        this.snapshotAndSave();
    }

    layerIcon(element: AnyElement) {
        if(element instanceof Path) {
            return 'draw-polygon';
        }

        if(element instanceof Shape) {
            return element.type == 'rectangle' ? 'square' : 'circle';
        }

        if(element instanceof TextElement) {
            return 'font';
        }

        return 'object-group';
    }

    beginLayerPointerDrag(event: PointerEvent, element: AnyElement) {
        if(event.button !== 0 || this.renamingLayer) {
            return;
        }

        event.stopPropagation();
        const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('.layer-row[data-layer-id]');
        if(!row) {
            return;
        }

        this.pendingLayerDrag = {
            element,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            row,
        };
        row.setPointerCapture(event.pointerId);
    }

    updateLayerPointerDrag(event: PointerEvent) {
        const pending = this.pendingLayerDrag;
        if(!pending || pending.pointerId !== event.pointerId) {
            return;
        }

        const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
        if(!this.draggingLayer && distance < 4) {
            return;
        }

        if(!this.draggingLayer) {
            this.draggingLayer = pending.element;
        }

        event.preventDefault();
        const target = this.layerDropTargetFromPoint(event.clientX, event.clientY);
        if(!target || target.element === this.draggingLayer || this.elementContains(this.draggingLayer, target.element)) {
            this.dragTargetLayer = undefined;
            this.dragTargetPosition = undefined;
            return;
        }

        this.updateLayerDropTarget(target.element, target.row, event.clientY);
    }

    finishLayerPointerDrag(event: PointerEvent) {
        const pending = this.pendingLayerDrag;
        if(!pending || pending.pointerId !== event.pointerId) {
            return;
        }

        if(pending.row.hasPointerCapture(event.pointerId)) {
            pending.row.releasePointerCapture(event.pointerId);
        }

        if(this.draggingLayer) {
            event.preventDefault();
            this.commitLayerDrop();
            this.suppressLayerClick = true;
            setTimeout(() => {
                this.suppressLayerClick = false;
            });
        }

        this.pendingLayerDrag = undefined;
    }

    cancelLayerPointerDrag(event: PointerEvent) {
        const pending = this.pendingLayerDrag;
        if(pending?.pointerId === event.pointerId) {
            this.pendingLayerDrag = undefined;
            this.endLayerDrag();
        }
    }

    private layerDropTargetFromPoint(x: number, y: number): { element: AnyElement; row: HTMLElement } | undefined {
        const target = document.elementFromPoint(x, y);
        const row = target instanceof Element ? target.closest<HTMLElement>('.layer-row[data-layer-id]') : null;
        if(!row) {
            return undefined;
        }

        const id = row.dataset['layerId'];
        const element = id ? this.layerRows.find((candidate) => candidate.element.id === id)?.element : undefined;
        return element ? { element, row } : undefined;
    }

    private updateLayerDropTarget(element: AnyElement, row: HTMLElement, clientY: number) {
        const bounds = row.getBoundingClientRect();
        const offsetY = clientY - bounds.top;
        this.dragTargetLayer = element;
        if(element instanceof Group && offsetY > bounds.height / 3 && offsetY < (bounds.height * 2 / 3)) {
            this.dragTargetPosition = 'inside';
        } else {
            this.dragTargetPosition = offsetY < (bounds.height / 2) ? 'before' : 'after';
        }
    }

    startLayerDrag(event: DragEvent, element: AnyElement) {
        this.draggingLayer = element;
        event.dataTransfer?.setData('text/plain', element.id);
        if(event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
        }
    }

    updateLayerDrop(event: DragEvent, element: AnyElement) {
        event.preventDefault();
        if(
            !this.draggingLayer ||
            this.draggingLayer == element ||
            this.elementContains(this.draggingLayer, element)
        ) {
            this.dragTargetLayer = undefined;
            this.dragTargetPosition = undefined;
            return;
        }

        this.updateLayerDropTarget(element, event.currentTarget as HTMLElement, event.clientY);
        if(event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
    }

    endLayerDrag() {
        this.draggingLayer = undefined;
        this.dragTargetLayer = undefined;
        this.dragTargetPosition = undefined;
    }

    clearLayerDrop(element: AnyElement) {
        if(this.dragTargetLayer == element) {
            this.dragTargetLayer = undefined;
            this.dragTargetPosition = undefined;
        }
    }

    dropLayer(event: DragEvent, element: AnyElement) {
        event.preventDefault();
        if(!this.editor.selectedSVG || !this.draggingLayer || this.draggingLayer == element) {
            this.endLayerDrag();
            return;
        }

        if(this.elementContains(this.draggingLayer, element)) {
            this.endLayerDrag();
            return;
        }

        this.commitLayerDrop();
    }

    private commitLayerDrop() {
        if(!this.editor.selectedSVG || !this.draggingLayer || !this.dragTargetLayer || !this.dragTargetPosition) {
            this.endLayerDrag();
            return;
        }

        const element = this.dragTargetLayer;
        const sourceContext = this.layerContext(this.draggingLayer);
        const targetContext = this.layerContext(element);
        if(!sourceContext || !targetContext) {
            this.endLayerDrag();
            return;
        }

        let targetElements: AnyElement[];
        let insertionIndex: number;
        if(this.dragTargetPosition == 'inside' && element instanceof Group) {
            targetElements = element.elements;
            insertionIndex = targetElements.length;
            this.collapsedGroupIds.delete(element.id);
        } else {
            targetElements = targetContext.elements;
            insertionIndex = targetContext.index + (this.dragTargetPosition == 'before' ? 1 : 0);
        }

        sourceContext.elements.splice(sourceContext.index, 1);
        if(sourceContext.elements === targetElements && sourceContext.index < insertionIndex) {
            insertionIndex--;
        }
        targetElements.splice(insertionIndex, 0, this.draggingLayer);
        this.snapshotAndSave();
        this.endLayerDrag();
    }
}

interface LayerRow {
    element: AnyElement;
    depth: number;
    parent?: Group;
}

type TransformField = 'translateX' | 'translateY' | 'scaleX' | 'scaleY' | 'rotation' | 'originX' | 'originY';
type ShapeFrameField = 'x' | 'y' | 'width' | 'height';

interface AnimationTransformDragStart {
    element: AnyElement;
    values: Record<string, number>;
}

interface AnimationPathPointDragStart {
    path: Path;
    values: Record<string, { x: number; y: number }>;
}

interface GuideDragState {
    pointerId: number;
    guide: CanvasGuide;
    axis: "x" | "y";
    value: number;
    created: boolean;
}

interface GuideInputState {
    axis: "x" | "y";
    guide?: CanvasGuide;
    value: string;
    x: number;
    y: number;
    error?: string;
}

interface RulerMark {
    value: number;
    position: number;
    major: boolean;
    label: string;
}
