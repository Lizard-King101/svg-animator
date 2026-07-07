import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, ViewChild } from "@angular/core";
import { NgClass, NgFor, NgIf } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { EditorService } from "../_services/editor.service";
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
import { AnyElement } from "./objects/svg.object";
import { buildSVGMarkup } from "./svg-markup";

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
    draggingLayer?: AnyElement;
    dragTargetLayer?: AnyElement;
    dragTargetPosition?: 'before' | 'after';
    renamingLayer?: AnyElement;

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

        this.editor.keyPressed(event.key);
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

    // ── Auto-save ────────────────────────────────────────────────────

    autoSave() {
        const svg = this.editor.selectedSVG;
        if(!svg) return;
        const thumbnail = buildSVGMarkup(svg);
        this.projectService.upsert(svg.save(), thumbnail);
    }

    private snapshotAndSave() {
        this.history.snapshot(this.editor);
        this.autoSave();
    }

    // ── Export ───────────────────────────────────────────────────────

    exportSVG() {
        const svg = this.editor.selectedSVG;
        if(!svg) return;
        const markup = buildSVGMarkup(svg);
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

    /** Bridge for template dynamic-key access on the now-typed settings object. */
    settingsOf(element: AnyElement | undefined): Record<string, any> {
        return (element?.settings ?? {}) as Record<string, any>;
    }

    selectLayer(element: AnyElement) {
        this.renamingLayer = undefined;
        this.editor.selectedElement = element;
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

    private setElementOrder(elements: AnyElement[]) {
        if(this.editor.selectedSVG) {
            this.editor.selectedSVG.elements = elements;
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

        let duplicate: AnyElement | undefined;
        if(element instanceof Path) {
            duplicate = this.clonePath(element);
        } else if(element instanceof Shape) {
            duplicate = this.cloneShape(element);
        } else if(element instanceof TextElement) {
            duplicate = this.cloneText(element);
        }

        if(!duplicate) {
            return;
        }

        const elements = [...this.editor.selectedSVG.elements];
        const index = elements.indexOf(element);
        elements.splice(index + 1, 0, duplicate);
        this.setElementOrder(elements);
        this.selectLayer(duplicate);
        this.snapshotAndSave();
    }

    deleteLayer(element: AnyElement) {
        if(!this.editor.selectedSVG) return;
        const elements = this.editor.selectedSVG.elements;
        const index = elements.indexOf(element);
        if(index < 0) return;
        elements.splice(index, 1);
        if(this.editor.selectedElement === element) {
            this.editor.selectedElement = undefined;
            this.editor.selectedPathAnchor = undefined;
            this.editor.selectedPathLine = undefined;
        }
        this.snapshotAndSave();
    }

    moveLayerBackward(element: AnyElement) {
        if(!this.editor.selectedSVG) {
            return;
        }

        const elements = [...this.editor.selectedSVG.elements];
        const index = elements.indexOf(element);
        if(index <= 0) {
            return;
        }

        elements.splice(index, 1);
        elements.splice(index - 1, 0, element);
        this.setElementOrder(elements);
    }

    moveLayerForward(element: AnyElement) {
        if(!this.editor.selectedSVG) {
            return;
        }

        const elements = [...this.editor.selectedSVG.elements];
        const index = elements.indexOf(element);
        if(index < 0 || index >= elements.length - 1) {
            return;
        }

        elements.splice(index, 1);
        elements.splice(index + 1, 0, element);
        this.setElementOrder(elements);
    }

    openLayerContextMenu(event: MouseEvent, element: AnyElement) {
        event.preventDefault();
        event.stopPropagation();
        this.selectLayer(element);

        const menuPosition = this.editor.toViewportPoint(event.clientX, event.clientY);
        this.editor.openContextMenu(menuPosition.x, menuPosition.y, [
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
        ]);
        this.editor.contextMenu!.infoTitle = 'Layer Shortcuts';
        this.editor.contextMenu!.infoLines = [
            'Enter: rename selected layer',
            'Ctrl+D: duplicate selected layer',
            ']: move selected layer forward',
            '[: move selected layer backward',
            'Del: delete selected layer',
        ];
    }

    toggleLayerVisibility(event: MouseEvent, element: AnyElement) {
        event.stopPropagation();
        element.visible = !element.visible;
        if(!element.visible && this.editor.selectedElement == element) {
            this.editor.selectedPathAnchor = undefined;
            this.editor.selectedPathLine = undefined;
        }
    }

    toggleLayerLock(event: MouseEvent, element: AnyElement) {
        event.stopPropagation();
        element.locked = !element.locked;
        if(element.locked && this.editor.selectedElement == element) {
            this.editor.selectedPathAnchor = undefined;
            this.editor.selectedPathLine = undefined;
        }
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

        return 'shapes';
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
        if(!this.draggingLayer || this.draggingLayer == element) {
            this.dragTargetLayer = undefined;
            this.dragTargetPosition = undefined;
            return;
        }

        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
        this.dragTargetLayer = element;
        this.dragTargetPosition = (event.clientY - bounds.top) < (bounds.height / 2) ? 'before' : 'after';
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

        const displayLayers = this.layers;
        const draggedIndex = displayLayers.indexOf(this.draggingLayer);
        const targetIndex = displayLayers.indexOf(element);
        if(draggedIndex < 0 || targetIndex < 0) {
            this.endLayerDrag();
            return;
        }

        const reorderedLayers = [...displayLayers];
        reorderedLayers.splice(draggedIndex, 1);
        const insertionIndex = targetIndex + (this.dragTargetPosition == 'after' ? 1 : 0);
        reorderedLayers.splice(insertionIndex > draggedIndex ? insertionIndex - 1 : insertionIndex, 0, this.draggingLayer);
        this.editor.selectedSVG.elements = reorderedLayers.reverse();
        this.snapshotAndSave();
        this.endLayerDrag();
    }
}
