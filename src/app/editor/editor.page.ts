import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, ViewChild, ViewEncapsulation } from "@angular/core";
import { NgIf } from "@angular/common";
import { ActivatedRoute } from "@angular/router";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { EditorService } from "../_services/editor.service";
import { AnimationPlaybackService } from "../_services/animation-playback.service";
import { AnimationGestureService } from "../_services/animation-gesture.service";
import { HistoryService } from "../_services/history.service";
import { ProjectService } from "../_services/project.service";
import { DocumentMutationService } from "../_services/document-mutation.service";
import { ElementFactory } from "../_services/element-factory.service";
import { LayerOperationsService } from "../_services/layer-operations.service";
import { LayerCommandService } from "../_services/layer-command.service";
import { SVGDisplay } from "../_components/svg-display/svg-display.component";
import { AnimationTimelineComponent } from "../_components/animation-timeline/animation-timeline.component";
import { CanvasWorkspaceComponent } from "../_components/canvas-workspace/canvas-workspace.component";
import { LayersPanelComponent } from "../_components/layers-panel/layers-panel.component";
import { PropertiesPanelComponent } from "../_components/properties-panel/properties-panel.component";
import { EditorHeaderComponent } from "../_components/editor-header/editor-header.component";
import { ToolPaletteComponent } from "../_components/tool-palette/tool-palette.component";
import { EditorContextMenuComponent } from "../_components/editor-context-menu/editor-context-menu.component";
import { NewProjectDialogComponent } from "../_components/new-project-dialog/new-project-dialog.component";
import { ExportDialogComponent } from "../_components/export-dialog/export-dialog.component";
import { CanvasGuidesComponent } from "../_components/canvas-guides/canvas-guides.component";
import { SVGEditorOverlayComponent } from "../_components/svg-editor-overlay/svg-editor-overlay.component";
import { EditorUiStateService } from "../_services/editor-ui-state.service";
import { PaintEditingService } from "../_services/paint-editing.service";
import { isEditableEventTarget } from "./editable-event-target";

@Component({
    standalone: true,
    imports: [
        NgIf,
        FaIconComponent,
        SVGDisplay,
        AnimationTimelineComponent,
        CanvasWorkspaceComponent,
        LayersPanelComponent,
        PropertiesPanelComponent,
        EditorHeaderComponent,
        ToolPaletteComponent,
        EditorContextMenuComponent,
        NewProjectDialogComponent,
        ExportDialogComponent,
        CanvasGuidesComponent,
        SVGEditorOverlayComponent,
    ],
    providers: [
        EditorService,
        HistoryService,
        AnimationPlaybackService,
        AnimationGestureService,
        DocumentMutationService,
        ElementFactory,
        LayerOperationsService,
        LayerCommandService,
        EditorUiStateService,
        PaintEditingService,
    ],
    templateUrl: 'editor.page.html',
    styleUrls: ['editor.page.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class EditorPage implements AfterViewInit {
    @ViewChild("canvas", { read: ElementRef }) canvas?: ElementRef<SVGElement>;

    @HostListener('document:keydown', ['$event']) handleKeyDown(event: KeyboardEvent) {
        if(this.ui.activeDialog) {
            if(event.key == 'Escape') this.ui.closeDialog();
            return;
        }

        if(event.key == 'Escape' && this.editor.contextMenu) {
            this.editor.closeContextMenu();
            return;
        }

        if(event.key == 'Escape' && this.layers.renamingLayer) {
            this.layers.renamingLayer = undefined;
            return;
        }

        if(isEditableEventTarget(event.target)) {
            return;
        }

        if((event.ctrlKey || event.metaKey) && !this.layers.renamingLayer) {
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
            if(event.key.toLowerCase() == 'g' && this.layers.canGroupSelectedLayers()) {
                event.preventDefault();
                this.layers.groupSelectedLayers();
                return;
            }
        }

        if(this.animation.mode == 'edit' && this.layers.selectedLayers.length > 1 && !this.layers.renamingLayer) {
            if(event.key == 'Delete' || event.key == 'Backspace') {
                event.preventDefault();
                this.layers.deleteSelectedLayers();
                return;
            }
        }

        if(this.editor.selectedElement && !this.layers.renamingLayer) {
            if(event.key == 'Enter') {
                event.preventDefault();
                this.layers.renamingLayer = this.editor.selectedElement;
                return;
            }

            if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() == 'd') {
                event.preventDefault();
                this.layers.duplicateLayer(this.editor.selectedElement);
                return;
            }

            if(event.key == '[') {
                event.preventDefault();
                this.layers.moveLayerBackward(this.editor.selectedElement);
                return;
            }

            if(event.key == ']') {
                event.preventDefault();
                this.layers.moveLayerForward(this.editor.selectedElement);
                return;
            }

            if(this.animation.mode == 'edit' && (event.key == 'Delete' || event.key == 'Backspace') && !this.editor.selectedPathAnchor) {
                event.preventDefault();
                this.layers.deleteLayer(this.editor.selectedElement);
                return;
            }
        }

        const beforeState = this.currentElementsState();
        this.editor.keyPressed(event.key);
        this.snapshotAndSaveIfChanged(beforeState);
    }
    @HostListener('document:keyup', ['$event']) handleKeyUp(event: KeyboardEvent) {
        if(isEditableEventTarget(event.target)) return;
        this.editor.keyReleased(event.key);
    }

    constructor(
        public editor: EditorService,
        public animation: AnimationPlaybackService,
        public mutations: DocumentMutationService,
        public projectService: ProjectService,
        public layers: LayerCommandService,
        public ui: EditorUiStateService,
        private route: ActivatedRoute,
        private cdr: ChangeDetectorRef
    ) {}

    async ngAfterViewInit() {
        // Load project from query params, or auto-open new-project dialog
        const params = this.route.snapshot.queryParamMap;
        const projectId = params.get('id');
        if (projectId) {
            const record = await this.projectService.getAsync(projectId);
            if (record) {
                this.editor.loadSVG(record.svgData);
                if(this.animation.mode === "animate") this.animation.seek(this.animation.currentTime);
                this.mutations.resetBaseline();
            }
            this.cdr.detectChanges();
        } else {
            this.ui.openDialog("new-project");
        }
    }

    // ── Auto-save ────────────────────────────────────────────────────

    private currentElementsState(): string | undefined {
        return this.mutations.captureState();
    }

    private snapshotAndSaveIfChanged(beforeState?: string, beforeRevision = this.mutations.revision) {
        if(this.mutations.revision !== beforeRevision) {
            return;
        }

        const afterState = this.currentElementsState();
        if(beforeState !== afterState) {
            this.mutations.commit();
        }
    }

    handleTimelineChange() {
        this.animation.invalidate();
        this.animation.previewAt(this.animation.currentTime);
        this.mutations.commit('animation');
    }


}
