import { unionFilledPathRegions } from '../editor/objects/path-boolean.object';
import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { ConstructionNetwork, ConstructionRegion, TrimSpan } from '../editor/objects/construction-network';
import { constructionSources } from '../editor/objects/construction-sources';
import { Path } from '../editor/objects/elements/path.object';
import { Shape } from '../editor/objects/elements/shape.object';
import { applyDrawingPaint } from '../editor/objects/drawing-paint';
import { SVG } from '../editor/objects/svg.object';
import { combinedMatrixFor, pinAncestorTransformOrigins, pinTransformOrigin } from '../editor/objects/element-bounds';
import { invertMatrix } from '../editor/objects/transform.object';
import { createScope, nativeContoursFromPaperItem } from '../editor/objects/paper-geometry';
import { clonePaint } from '../editor/objects/paint.object';
import { EditorService } from './editor.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { LayerOperationsService } from './layer-operations.service';
import { ElementFactory } from './element-factory.service';
import { pathTopologyProblem } from '../editor/path-topology';

export type ShapeBuildingMode = 'regions' | 'trim';
@Injectable()
export class ShapeBuildingService implements OnDestroy {
    mode: ShapeBuildingMode = 'regions';
    selectionOnly = false;
    error = '';
    hoveredRegion?: ConstructionRegion;
    hoveredSpan?: TrimSpan;
    chosen = new Set<ConstructionRegion>();
    private network?: ConstructionNetwork;
    private document?: SVG;
    private revision = -1;
    private selectedIds = new Set<string>();
    private createdIds = new Set<string>();
    private restored: Subscription;
    get selectionAvailable(): boolean { return this.selectedIds.size > 0; }
    get preview(): string { return this.hoveredSpan?.data ?? this.hoveredRegion?.data ?? ''; }
    get selectedPreview(): string { return [...this.chosen].map(region => region.data).join(' '); }
    get hint(): string {
        if(this.animation.mode !== 'edit') return 'Switch to Edit to build shapes or use destructive Trim.';
        if(this.error) return this.error;
        return this.mode === 'trim' ? 'Trim removes geometry between intersections. Use Edit outline under Stroke for visual gaps that preserve the fill and rig. Escape clears preview.'
            : 'Create shape: click enclosed regions to select them, then Create shape or Enter. Original outlines are kept. Escape cancels.';
    }
    constructor(private editor: EditorService, private animation: AnimationPlaybackService,
        private mutations: DocumentMutationService, private layers: LayerOperationsService, private factory: ElementFactory) {
        this.restored = mutations.historyRestored.subscribe(() => this.invalidate());
    }
    activate(mode: ShapeBuildingMode): void {
        this.invalidate(); this.mode = mode; this.selectionOnly = false;
        this.selectedIds = new Set(this.editor.selectedElements.map(element => element.id));
        this.createdIds.clear();
    }
    setSelectionOnly(value: boolean): void { this.selectionOnly = value; this.invalidate(); }
    validate(): void {
        if(this.document !== this.editor.selectedSVG || this.revision !== this.mutations.revision || this.animation.mode !== 'edit') this.invalidate();
    }
    move(event: MouseEvent): void {
        if(!this.prepare()) return;
        const point = this.editor.toCanvasPoint(event.clientX, event.clientY);
        this.hoveredRegion = this.mode === 'regions' ? this.network!.regionAt(point) : undefined;
        this.hoveredSpan = this.mode === 'trim' ? this.network!.spanAt(point, 8 / Math.max(.01, this.editor.selectedSVG!.zoom)) : undefined;
    }
    click(event: MouseEvent): void {
        if(event.button !== 0) return;
        this.move(event);
        if(this.mode === 'trim') this.trim();
        else if(this.hoveredRegion) {
            if(this.chosen.has(this.hoveredRegion)) this.chosen.delete(this.hoveredRegion); else this.chosen.add(this.hoveredRegion);
        }
    }
    key(key: string): void {
        if(key === 'Escape') this.cancel();
        if(key === 'Enter') { if(this.mode === 'trim') this.trim(); else this.create(); }
    }
    leave(): void { this.hoveredRegion = undefined; this.hoveredSpan = undefined; }
    cancel(): void { this.leave(); this.chosen.clear(); }
    invalidate(): void { this.cancel(); this.network?.dispose(); this.network = undefined; this.error = ''; }
    ngOnDestroy(): void { this.restored.unsubscribe(); this.invalidate(); }
    create(): void {
        if(!this.prepare() || !this.chosen.size) return;
        const scope = createScope();
        try {
            const regions = [...this.chosen].map(region => nativeContoursFromPaperItem(scope, scope.PathItem.create(region.data), this.editor));
            const contours = unionFilledPathRegions(regions, this.editor);
            if(!contours) { this.error = 'These regions could not be merged. Try a smaller selection.'; return; }
            const path = this.factory.createPath(); path.name = 'Built shape'; path.contours = contours;
            if(!path.contours.length) return;
            path.fillRule = 'evenodd'; applyDrawingPaint(path.settings, this.editor.drawingPaint);
            this.mutations.mutate(() => { this.layers.insertElement(path); this.editor.selectedElement = path; });
            this.createdIds.add(path.id); this.invalidate();
        } catch { this.error = 'These regions could not be merged. Try a smaller selection.'; } finally { scope.remove(); }
    }
    private trim(): void {
        if(!this.prepare() || !this.hoveredSpan) return;
        const span = this.hoveredSpan, svg = this.editor.selectedSVG!;
        const source = this.editor.findElement(span.source);
        if(!(source instanceof Path || source instanceof Shape)) return;
        const problem = pathTopologyProblem(svg, source, 'trim');
        if(problem) { this.error = problem; return; }
        const data = this.network!.trimmedData(span), scope = createScope();
        try {
            const path = this.factory.createPath();
            if(data) {
                const item = scope.PathItem.create(data), inverse = invertMatrix(combinedMatrixFor(svg.elements, source));
                item.transform(new scope.Matrix(inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f));
                path.contours = nativeContoursFromPaperItem(scope, item, this.editor);
            }
            this.mutations.mutate(() => {
                pinAncestorTransformOrigins(svg.elements, source); pinTransformOrigin(source);
                if(!data || !path.contours.length) { this.layers.delete(source); this.editor.selectedElement = undefined; return; }
                path.id = source.id; path.name = source.name; path.opacity = source.opacity; path.transform = { ...source.transform };
                path.settings = { ...path.settings, ...source.settings, fill_enabled: false, fill: null, stroke: clonePaint(source.settings.stroke ?? source.settings.fill), stroke_width: source.settings.stroke ? source.settings.stroke_width : Math.max(1, source.settings.stroke_width), stroke_alignment: 'center' };
                this.layers.replaceElement(source, path); this.editor.selectedElement = path;
            });
            this.invalidate();
        } finally { scope.remove(); }
    }
    private prepare(): boolean {
        this.validate();
        const svg = this.editor.selectedSVG;
        if(!svg || this.animation.mode !== 'edit') return false;
        if(this.network) return true;
        this.document = svg; this.revision = this.mutations.revision;
        try {
            const sources = constructionSources(svg, this.selectionOnly ? this.selectedIds : undefined, this.createdIds);
            this.network = new ConstructionNetwork(sources);
            if(!sources.length) this.error = 'No editable static outlines in this scope. Choose visible, unlocked paths or shapes.';
            else if(this.mode === 'regions' && !this.network.regions.length) this.error = 'No enclosed regions yet. Connect or overlap outlines to enclose an area.';
            return true;
        } catch(error) { this.error = error instanceof Error ? error.message : 'Unable to build these outlines.'; return false; }
    }
}
