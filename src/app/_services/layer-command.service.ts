import { Injectable } from "@angular/core";
import { DocumentMutationService } from "./document-mutation.service";
import { EditorContextMenuItem, EditorService } from "./editor.service";
import { LayerContext, LayerOperationsService } from "./layer-operations.service";
import { Group } from "../editor/objects/elements/group.object";
import { Path } from "../editor/objects/elements/path.object";
import { Shape } from "../editor/objects/elements/shape.object";
import { TextElement } from "../editor/objects/elements/text.object";
import { Point } from "../editor/objects/point.object";
import { canConvertStrokeToPath, StrokeToPathProfile } from "../editor/objects/stroke-outline.object";
import { AnyElement } from "../editor/objects/svg.object";

/** Selection state and mutation-aware commands shared by the layer panel and editor shortcuts. */
@Injectable()
export class LayerCommandService {
    draggingLayer?: AnyElement;
    dragTargetLayer?: AnyElement;
    dragTargetPosition?: "before" | "after" | "inside";
    renamingLayer?: AnyElement;
    selectedLayers: AnyElement[] = [];
    private pendingLayerDrag?: { element: AnyElement; pointerId: number; startX: number; startY: number; row: HTMLElement };
    private suppressLayerClick = false;
    private lastSelectedLayer?: AnyElement;
    private collapsedGroupIds = new Set<string>();

    constructor(public editor: EditorService, private layerOperations: LayerOperationsService, private mutations: DocumentMutationService) {}

    private snapshotAndSave(): void { this.mutations.commit(); }

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

    clippingGroupFor(element: AnyElement): Group | undefined {
        const context = this.layerContext(element);
        return context?.parent?.clipElementId === element.id ? context.parent : undefined;
    }

    isClippingMask(element: AnyElement): boolean {
        return !!this.clippingGroupFor(element);
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

    endLayerDrag() {
        this.draggingLayer = undefined;
        this.dragTargetLayer = undefined;
        this.dragTargetPosition = undefined;
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

export interface LayerRow { element: AnyElement; depth: number; parent?: Group }
