import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, ViewChild } from "@angular/core";
import { NgClass, NgFor, NgIf } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { EditorContextMenuItem, EditorService } from "../_services/editor.service";
import { HistoryService } from "../_services/history.service";
import { ProjectService } from "../_services/project.service";
import { SVGDisplay } from "../_components/svg-display/svg-display.component";
import { BoolAttribute } from "../_components/attributes/bool/bool.component";
import { ColorAttribute } from "../_components/attributes/color/color.component";
import { RangeAttribute } from "../_components/attributes/range/range.component";
import { SelectAttribut } from "../_components/attributes/select/select.component";
import { TextAttribute } from "../_components/attributes/text/text.component";
import { Color } from "./objects/color.object";
import { Group } from "./objects/elements/group.object";
import { Line } from "./objects/line.object";
import { Path } from "./objects/elements/path.object";
import { Point } from "./objects/point.object";
import { Shape } from "./objects/elements/shape.object";
import { TextElement } from "./objects/elements/text.object";
import { AnyElement, SVG } from "./objects/svg.object";

@Component({
    standalone: true,
    imports: [
        NgFor, NgIf, NgClass,
        FormsModule,
        FaIconComponent,
        SVGDisplay,
        BoolAttribute,
        ColorAttribute,
        RangeAttribute,
        SelectAttribut,
        TextAttribute
    ],
    providers: [EditorService, HistoryService],
    templateUrl: 'editor.page.html',
    styleUrls: ['editor.page.scss']
})
export class EditorPage implements AfterViewInit {
    scale: number = 1;

    movingView: boolean = false;
    moveStart: Point;
    private attributeSaveTimer?: ReturnType<typeof setTimeout>;
    private saveRevision = 0;
    draggingLayer?: AnyElement;
    dragTargetLayer?: AnyElement;
    dragTargetPosition?: 'before' | 'after' | 'inside';
    private pendingLayerDrag?: { element: AnyElement; pointerId: number; startX: number; startY: number; row: HTMLElement };
    private suppressLayerClick = false;
    renamingLayer?: AnyElement;
    selectedLayers: AnyElement[] = [];
    private lastSelectedLayer?: AnyElement;
    private collapsedGroupIds = new Set<string>();

    // ── New SVG dialog ────────────────────────────────────────────────
    showNewDialog = false;
    newName = 'Untitled';
    newWidth = 800;
    newHeight = 600;

    readonly ASPECT_RATIOS = [
        { label: '1920×1080', sublabel: '16:9 HD',     width: 1920, height: 1080 },
        { label: '1280×720',  sublabel: '16:9 720p',   width: 1280, height: 720  },
        { label: '800×800',   sublabel: 'Square',      width: 800,  height: 800  },
        { label: '800×600',   sublabel: '4:3',         width: 800,  height: 600  },
        { label: '595×842',   sublabel: 'A4 Portrait', width: 595,  height: 842  },
        { label: '1080×1920', sublabel: 'Story 9:16',  width: 1080, height: 1920 },
    ];

    @ViewChild('canvas') canvas?: ElementRef<SVGElement>;
    @ViewChild('viewPort') viewPort?: ElementRef<HTMLElement>;

    @HostListener('document:keydown', ['$event']) handleKeyDown(event: KeyboardEvent) {
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
                this.history.undo(this.editor);
                return;
            }
            if(event.key.toLowerCase() == 'y' || (event.key.toLowerCase() == 'z' && event.shiftKey)) {
                event.preventDefault();
                this.history.redo(this.editor);
                return;
            }
            if(event.key.toLowerCase() == 'g' && this.canGroupSelectedLayers()) {
                event.preventDefault();
                this.groupSelectedLayers();
                return;
            }
        }

        if(this.selectedLayers.length > 1 && !this.renamingLayer) {
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

            if((event.key == 'Delete' || event.key == 'Backspace') && !this.editor.selectedPathAnchor) {
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
        public history: HistoryService,
        public projectService: ProjectService,
        private route: ActivatedRoute,
        private ngZone: NgZone,
        private cdr: ChangeDetectorRef
    ) {
        this.moveStart = new Point(0, 0);
        this.history.init(editor);
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
        });

        viewport.addEventListener('mouseup', (event: MouseEvent) => {
            this.ngZone.run(() => {
                if (this.editor.selectedTool) this.editor.selectedTool.up(event);
                this.movingView = false;
                // Skip snapshot on right-click — contextmenu fires next and handles it
                if (event.button !== 2) this.snapshotAndSave();
            });
        });

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
                    svg.zoom  = newZoom;
                }
            });
        }, { passive: true });

        viewport.addEventListener('contextmenu', (event: MouseEvent) => {
            this.ngZone.run(() => {
                event.preventDefault();
                if (this.editor.selectedTool) this.editor.selectedTool.contextMenu(event);
                this.snapshotAndSave();
            });
        });

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
        });

        viewport.addEventListener('click', (event: MouseEvent) => {
            this.ngZone.run(() => {
                this.editor.closeContextMenu();
                if (this.editor.selectedTool && event.button == 0) {
                    this.editor.selectedTool.click(event);
                    this.snapshotAndSave();
                }
            });
        });

        viewport.addEventListener('mouseleave', (event: MouseEvent) => {
            this.movingView = false;
        })

        this.editor.setViewPort(viewport);

        // Load project from query params, or auto-open new-project dialog
        const params = this.route.snapshot.queryParamMap;
        const projectId = params.get('id');
        if (projectId) {
            const record = this.projectService.get(projectId);
            if (record) this.editor.loadSVG(record.svgData);
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
        this.showNewDialog = false;
        this.autoSave();
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

    // ── SVG rendering ────────────────────────────────────────────────

    private buildSVGMarkup(svg: SVG): string {
        const attr = (name: string, value: any) =>
            value != null ? ` ${name}="${value}"` : '';

        const lines: string[] = [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${svg.width}" height="${svg.height}" viewBox="0 0 ${svg.width} ${svg.height}">`
        ];

        const appendElements = (elements: AnyElement[], depth: number) => {
            const indent = '  '.repeat(depth);
            for(const element of elements) {
                if(!element.visible) continue;

                if(element instanceof Group) {
                    lines.push(`${indent}<g${attr('id', element.id)}>`);
                    appendElements(element.elements, depth + 1);
                    lines.push(`${indent}</g>`);
                } else if(element instanceof Path) {
                    const s = element.settings;
                    lines.push(
                        `${indent}<path` +
                        attr('d', element.raw) +
                        attr('fill', s.fill_enabled && s.fill ? s.fill.hex : 'none') +
                        attr('stroke', s.stroke?.hex ?? null) +
                        attr('stroke-width', s.stroke_width ?? null) +
                        attr('stroke-linecap', s.line_cap ?? null) +
                        attr('stroke-linejoin', s.line_join ?? null) +
                        `/>`
                    );
                } else if(element instanceof TextElement) {
                    const s = element.settings;
                    const tspanIndent = '  '.repeat(depth + 1);
                    const tspans = element.lines.map((line, i) =>
                        `${tspanIndent}<tspan${i === 0 ? '' : ` x="${element.x}" dy="${element.lineHeight}"`}>${line}</tspan>`
                    ).join('\n');
                    lines.push(
                        `${indent}<text` +
                        attr('x', element.x) +
                        attr('y', element.y) +
                        attr('font-size', s.font_size) +
                        attr('font-family', s.font_family) +
                        attr('font-weight', s.font_weight) +
                        attr('fill', s.color?.hex ?? '#000000') +
                        ` dominant-baseline="hanging">` +
                        `\n${tspans}\n${indent}</text>`
                    );
                } else if(element instanceof Shape) {
                    const s = element.settings;
                    const fillAttr = attr('fill', s.fill?.hex ?? 'none');
                    const strokeAttr = attr('stroke', s.stroke?.hex ?? null);
                    const swAttr = attr('stroke-width', s.stroke_width ?? null);
                    if(element.type === 'rectangle') {
                        const cr = s.corner_radius || null;
                        lines.push(
                            `${indent}<rect` +
                            attr('x', element.x) +
                            attr('y', element.y) +
                            attr('width', element.width) +
                            attr('height', element.height) +
                            attr('rx', cr) +
                            attr('ry', cr) +
                            fillAttr + strokeAttr + swAttr +
                            `/>`
                        );
                    } else {
                        lines.push(
                            `${indent}<ellipse` +
                            attr('cx', element.centerX) +
                            attr('cy', element.centerY) +
                            attr('rx', element.radiusX) +
                            attr('ry', element.radiusY) +
                            fillAttr + strokeAttr + swAttr +
                            `/>`
                        );
                    }
                }
            }
        };

        appendElements(svg.elements, 1);

        lines.push('</svg>');
        return lines.join('\n');
    }

    // ── Auto-save ────────────────────────────────────────────────────

    autoSave() {
        const svg = this.editor.selectedSVG;
        if(!svg) return;
        const thumbnail = this.buildSVGMarkup(svg);
        this.projectService.upsert(svg.save(), thumbnail);
    }

    private snapshotAndSave() {
        this.history.snapshot(this.editor);
        this.autoSave();
        this.saveRevision++;
    }

    private currentElementsState(): string | undefined {
        const svg = this.editor.selectedSVG;
        return svg ? JSON.stringify(svg.save().elements) : undefined;
    }

    private snapshotAndSaveIfChanged(beforeState?: string, beforeRevision = this.saveRevision) {
        if(this.saveRevision !== beforeRevision) {
            return;
        }

        const afterState = this.currentElementsState();
        if(beforeState !== afterState) {
            this.snapshotAndSave();
        }
    }

    scheduleAttributeSnapshot() {
        if(this.attributeSaveTimer) {
            clearTimeout(this.attributeSaveTimer);
        }

        this.attributeSaveTimer = setTimeout(() => {
            this.attributeSaveTimer = undefined;
            this.snapshotAndSave();
        }, 250);
    }

    runContextMenuItem(item: EditorContextMenuItem) {
        const beforeRevision = this.saveRevision;
        const beforeState = this.currentElementsState();
        this.editor.runContextMenuItem(item);
        this.snapshotAndSaveIfChanged(beforeState, beforeRevision);
    }

    // ── Export ───────────────────────────────────────────────────────

    exportSVG() {
        const svg = this.editor.selectedSVG;
        if(!svg) return;
        const markup = this.buildSVGMarkup(svg);
        const blob = new Blob([markup], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${svg.name ?? 'drawing'}.svg`;
        a.click();
        URL.revokeObjectURL(url);
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

    /** Bridge for template dynamic-key access on the now-typed settings object. */
    settingsOf(element: AnyElement | undefined): Record<string, any> {
        return (element?.settings ?? {}) as Record<string, any>;
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
    }

    private clonePoint(point: Point, pointMap: Map<string, Point>) {
        let cloned = pointMap.get(point.id);
        if(!cloned) {
            cloned = new Point(point.x, point.y);
            pointMap.set(point.id, cloned);
        }
        return cloned;
    }

    private cloneColor(value: any) {
        return value instanceof Color ? new Color(value.hex) : value;
    }

    private clonePath(path: Path) {
        const clone = new Path(this.editor);
        const pointMap = new Map<string, Point>();

        clone.name = `${path.name} Copy`;
        clone.visible = path.visible;
        clone.locked = false;
        clone.closed = path.closed;
        clone.settings = {
            ...path.settings,
            stroke: this.cloneColor(path.settings.stroke),
            fill: this.cloneColor(path.settings.fill),
        };
        clone.lines = path.lines.map((line) => {
            return new Line(this.editor, {
                type: line.type,
                points: line.points.map((point) => this.clonePoint(point, pointMap)),
                controlStart: line.controlStart ? this.clonePoint(line.controlStart, pointMap) : undefined,
                controlEnd: line.controlEnd ? this.clonePoint(line.controlEnd, pointMap) : undefined,
            });
        });
        clone.moveElement(new Point(12, 12));
        return clone;
    }

    private cloneShape(shape: Shape) {
        const clone = new Shape(this.editor, {
            type: shape.type,
            position: new Point(shape.position.x + 12, shape.position.y + 12),
            width: shape.width,
            height: shape.height,
        });

        clone.name = `${shape.name} Copy`;
        clone.visible = shape.visible;
        clone.locked = false;
        clone.settings = {
            ...shape.settings,
            stroke: this.cloneColor(shape.settings.stroke),
            fill: this.cloneColor(shape.settings.fill),
        };
        return clone;
    }

    private cloneText(text: TextElement) {
        const clone = new TextElement(this.editor, new Point(text.position.x + 12, text.position.y + 12));
        clone.name = `${text.name} Copy`;
        clone.visible = text.visible;
        clone.locked = false;
        clone.settings = {
            ...text.settings,
            color: text.settings.color ? new Color(text.settings.color.hex) : null,
        };
        return clone;
    }

    private cloneGroup(group: Group) {
        const clone = new Group(this.editor);
        clone.name = `${group.name} Copy`;
        clone.visible = group.visible;
        clone.locked = false;
        clone.elements = group.elements.map((element) => this.cloneElement(element));
        return clone;
    }

    private cloneElement(element: AnyElement): AnyElement {
        if(element instanceof Path) return this.clonePath(element);
        if(element instanceof Shape) return this.cloneShape(element);
        if(element instanceof TextElement) return this.cloneText(element);
        return this.cloneGroup(element);
    }

    private setElementOrder(elements: AnyElement[]) {
        if(this.editor.selectedSVG) {
            this.editor.selectedSVG.elements = elements;
        }
    }

    private layerContext(element: AnyElement): LayerContext | undefined {
        if(!this.editor.selectedSVG) {
            return undefined;
        }

        return this.findLayerContext(this.editor.selectedSVG.elements, element);
    }

    private findLayerContext(elements: AnyElement[], element: AnyElement, parent?: Group): LayerContext | undefined {
        const index = elements.indexOf(element);
        if(index >= 0) {
            return { elements, index, parent };
        }

        for(const candidate of elements) {
            if(candidate instanceof Group) {
                const found = this.findLayerContext(candidate.elements, element, candidate);
                if(found) {
                    return found;
                }
            }
        }

        return undefined;
    }

    private canGroupWithBelow(element: AnyElement): boolean {
        const context = this.layerContext(element);
        return !!context && context.index > 0;
    }

    private selectedLayerContexts(): LayerContext[] {
        return this.selectedLayers
            .map((layer) => this.layerContext(layer))
            .filter((context): context is LayerContext => !!context);
    }

    canGroupSelectedLayers(): boolean {
        if(this.selectedLayers.length < 2) {
            return false;
        }

        const contexts = this.selectedLayerContexts();
        if(contexts.length !== this.selectedLayers.length) {
            return false;
        }

        const parentElements = contexts[0].elements;
        return contexts.every((context) => context.elements === parentElements);
    }

    groupSelectedLayers() {
        if(!this.canGroupSelectedLayers()) {
            return;
        }

        const contexts = this.selectedLayerContexts();
        const elements = contexts[0].elements;
        const selected = new Set(this.selectedLayers);
        const selectedInDrawOrder = elements.filter((element) => selected.has(element));
        const firstIndex = elements.findIndex((element) => selected.has(element));

        const group = new Group(this.editor);
        group.name = `Group ${selectedInDrawOrder.length} Layers`;
        group.elements = selectedInDrawOrder;

        selectedInDrawOrder.forEach((element) => {
            const index = elements.indexOf(element);
            if(index >= 0) {
                elements.splice(index, 1);
            }
        });
        elements.splice(firstIndex, 0, group);
        this.selectLayer(group);
        this.snapshotAndSave();
    }

    private elementContains(parent: AnyElement, child: AnyElement): boolean {
        return parent instanceof Group && parent.elements.some((element) => {
            return element === child || this.elementContains(element, child);
        });
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
        if(!this.editor.selectedSVG) {
            return;
        }

        const context = this.layerContext(element);
        if(!context) {
            return;
        }

        const duplicate = this.cloneElement(element);
        context.elements.splice(context.index + 1, 0, duplicate);
        this.selectLayer(duplicate);
        this.snapshotAndSave();
    }

    deleteLayer(element: AnyElement) {
        if(!this.editor.selectedSVG) return;
        const context = this.layerContext(element);
        if(!context) return;
        context.elements.splice(context.index, 1);
        if(this.editor.selectedElement === element || (this.editor.selectedElement && this.elementContains(element, this.editor.selectedElement))) {
            this.editor.selectedElement = undefined;
            this.editor.selectedPathAnchor = undefined;
            this.editor.selectedPathLine = undefined;
        }
        this.removeLayerFromSelection(element);
        this.snapshotAndSave();
    }

    deleteSelectedLayers() {
        if(!this.editor.selectedSVG || this.selectedLayers.length == 0) {
            return;
        }

        const selected = [...this.selectedLayers].filter((layer) => {
            return !this.selectedLayers.some((candidate) => candidate !== layer && this.elementContains(candidate, layer));
        });

        selected.forEach((layer) => {
            const context = this.layerContext(layer);
            if(context) {
                context.elements.splice(context.index, 1);
            }
        });

        this.selectedLayers = [];
        this.lastSelectedLayer = undefined;
        this.editor.selectedElement = undefined;
        this.editor.selectedPathAnchor = undefined;
        this.editor.selectedPathLine = undefined;
        this.snapshotAndSave();
    }

    moveLayerBackward(element: AnyElement) {
        if(!this.editor.selectedSVG) {
            return;
        }

        const context = this.layerContext(element);
        if(!context || context.index <= 0) {
            return;
        }

        // elements.splice(index, 1);
        // elements.splice(index - 1, 0, element);
        // this.setElementOrder(elements);
        this.snapshotAndSave();
        context.elements.splice(context.index, 1);
        context.elements.splice(context.index - 1, 0, element);
    }

    moveLayerForward(element: AnyElement) {
        if(!this.editor.selectedSVG) {
            return;
        }

        const context = this.layerContext(element);
        if(!context || context.index >= context.elements.length - 1) {
            return;
        }

        context.elements.splice(context.index, 1);
        context.elements.splice(context.index + 1, 0, element);
    }

    groupLayerWithBelow(element: AnyElement) {
        const context = this.layerContext(element);
        if(!context || context.index <= 0) {
            return;
        }

        const below = context.elements[context.index - 1];
        const group = new Group(this.editor);
        group.name = `Group ${below.name}, ${element.name}`;
        group.elements = [below, element];
        context.elements.splice(context.index - 1, 2, group);
        this.selectLayer(group);
        this.snapshotAndSave();
    }

    ungroupLayer(group: Group) {
        const context = this.layerContext(group);
        if(!context) {
            return;
        }

        // elements.splice(index, 1);
        // elements.splice(index + 1, 0, element);
        // this.setElementOrder(elements);
        context.elements.splice(context.index, 1, ...group.elements);
        this.selectedLayers = [...group.elements];
        this.lastSelectedLayer = this.selectedLayers[this.selectedLayers.length - 1];
        if(this.editor.selectedElement === group) {
            this.editor.selectedElement = undefined;
            this.editor.selectedPathAnchor = undefined;
            this.editor.selectedPathLine = undefined;
        }
        this.snapshotAndSave();
    }

    openLayerContextMenu(event: MouseEvent, element: AnyElement) {
        event.preventDefault();
        event.stopPropagation();
        if(!this.selectedLayers.includes(element)) {
            this.selectLayer(element);
        }

        const menuPosition = new Point(event.clientX, event.clientY);
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
            ...(element instanceof Group ? [{
                label: 'Ungroup',
                action: () => {
                    this.ungroupLayer(element);
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
        element.visible = !element.visible;
        if(!element.visible && this.editor.selectedElement && (this.editor.selectedElement == element || this.elementContains(element, this.editor.selectedElement))) {
            this.editor.selectedPathAnchor = undefined;
            this.editor.selectedPathLine = undefined;
        }
        this.snapshotAndSave();
    }

    toggleLayerLock(event: MouseEvent, element: AnyElement) {
        event.stopPropagation();
        element.locked = !element.locked;
        if(element.locked && this.editor.selectedElement && (this.editor.selectedElement == element || this.elementContains(element, this.editor.selectedElement))) {
            this.editor.selectedPathAnchor = undefined;
            this.editor.selectedPathLine = undefined;
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

interface LayerContext {
    elements: AnyElement[];
    index: number;
    parent?: Group;
}
