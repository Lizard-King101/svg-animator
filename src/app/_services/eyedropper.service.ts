import { Injectable, signal } from '@angular/core';
import { EditorService } from './editor.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { Color } from '../editor/objects/color.object';
import { artworkSamplingRaster, ColorSample, decodeSamplingImage, fittedImageBounds, sampleRaster, SamplingRaster } from '../editor/objects/color-sampling';
import { SVG } from '../editor/objects/svg.object';

export type SamplingSource = 'artwork' | 'reference';
interface SamplingSession {
    owner: object; trigger: HTMLElement; apply: (color: Color) => void;
    document: SVG; tool: unknown; mode: string; time: number; selection: string; revision: number;
}

/** One cancellable sampling session; callers keep ownership of their normal color commit. */
@Injectable()
export class EyedropperService {
    readonly active = signal(false);
    readonly busy = signal(false);
    readonly error = signal('');
    readonly sample = signal<ColorSample | undefined>(undefined);
    source: SamplingSource = 'artwork';
    pointer?: { x: number; y: number };
    private surface?: SVGSVGElement;
    private session?: SamplingSession;
    private raster?: SamplingRaster;
    private generation = 0;

    constructor(private editor: EditorService, private animation: AnimationPlaybackService, private mutations: DocumentMutationService) {}
    get available(): boolean { return !!this.surface && !!this.editor.selectedSVG; }
    get referenceAvailable(): boolean { return !!this.session?.document.referenceImage?.visible; }
    register(surface: SVGSVGElement): void { this.surface = surface; }
    unregister(surface: SVGSVGElement): void { if(this.surface === surface) { this.cancel(); this.surface = undefined; } }

    async begin(owner: object, trigger: HTMLElement, apply: (color: Color) => void): Promise<void> {
        if(!this.available) return;
        this.cancel(false);
        // Finish any pending coalesced edit before freezing the sampling context.
        this.mutations.commit();
        this.animation.pause();
        const svg = this.editor.selectedSVG!;
        this.session = { owner, trigger, apply, document: svg, tool: this.tool, mode: this.animation.mode,
            time: this.animation.currentTime, selection: this.selection, revision: this.mutations.revision };
        this.source = 'artwork'; this.pointer = undefined; this.active.set(true);
        await this.prepare();
    }
    cancelOwner(owner: object): void { if(this.session?.owner === owner) this.cancel(false); }
    cancel(focus = true): void {
        const trigger = this.session?.trigger;
        this.generation++; this.session = undefined; this.raster = undefined; this.pointer = undefined;
        this.active.set(false); this.busy.set(false); this.error.set(''); this.sample.set(undefined);
        if(focus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
    validate(): boolean {
        const s = this.session;
        if(s && (s.document !== this.editor.selectedSVG || s.tool !== this.tool || s.mode !== this.animation.mode
            || s.time !== this.animation.currentTime || s.revision !== this.mutations.revision || s.selection !== this.selection)) this.cancel();
        return !!this.session;
    }
    async setSource(source: SamplingSource): Promise<void> {
        if(!this.validate() || (source === 'reference' && !this.referenceAvailable)) return;
        this.source = source; await this.prepare();
    }
    move(x: number, y: number): void {
        if(!this.validate()) return;
        this.pointer = { x, y }; this.sample.set(undefined);
        const surface = this.surface, raster = this.raster;
        if(!surface || !raster || this.busy()) return;
        const workspace = surface.parentElement?.getBoundingClientRect();
        if(!workspace || x < workspace.left || x >= workspace.right || y < workspace.top || y >= workspace.bottom) return;
        try {
            const matrix = surface.getScreenCTM(); if(!matrix) return;
            const point = new DOMPoint(x, y).matrixTransform(matrix.inverse());
            const canvas = this.session!.document.canvasBounds;
            if(point.x < canvas.x || point.y < canvas.y || point.x >= canvas.x + canvas.width || point.y >= canvas.y + canvas.height) return;
            this.sample.set(sampleRaster(raster, point));
        } catch { this.error.set('This image could not be sampled. Try an embedded PNG, JPEG, or WebP reference.'); }
    }
    choose(): void {
        if(!this.validate() || this.busy()) return;
        const sample = this.sample(), apply = this.session?.apply;
        if(!sample || !apply) return;
        this.cancel(); apply(sample.color);
        // A pick is a discrete edit, even when its color control normally coalesces input.
        this.mutations.commit();
    }
    nudge(dx: number, dy: number): void {
        const bounds = this.surface?.getBoundingClientRect(); if(!bounds) return;
        const workspace = this.surface?.parentElement?.getBoundingClientRect(); if(!workspace) return;
        const point = this.pointer ?? { x: (Math.max(0, bounds.left, workspace.left) + Math.min(innerWidth, bounds.right, workspace.right)) / 2,
            y: (Math.max(0, bounds.top, workspace.top) + Math.min(innerHeight, bounds.bottom, workspace.bottom)) / 2 };
        this.move(point.x + dx, point.y + dy);
    }
    private async prepare(): Promise<void> {
        const s = this.session, surface = this.surface;
        if(!s || !surface) return;
        const generation = ++this.generation;
        this.busy.set(true); this.error.set(''); this.sample.set(undefined); this.raster = undefined;
        try {
            let raster: SamplingRaster;
            const reference = s.document.referenceImage;
            if(this.source === 'reference' && reference?.visible) {
                const image = await decodeSamplingImage(reference.source);
                raster = { image, bounds: fittedImageBounds(reference, image.naturalWidth, image.naturalHeight) };
            } else raster = await artworkSamplingRaster(surface, s.document.canvasBounds, s.document.tempElements.map(item => item.id));
            if(generation !== this.generation || !this.validate()) return;
            this.raster = raster; this.busy.set(false);
            if(this.pointer) this.move(this.pointer.x, this.pointer.y);
        } catch {
            if(generation === this.generation) { this.busy.set(false); this.error.set('Could not prepare the color sample. Try Reference mode or cancel and retry.'); }
        }
    }
    private get tool() { return this.editor.selectedTool?.selectedChild ?? this.editor.selectedTool; }
    private get selection(): string { return this.editor.selectedElements.map(item => item.id).join(','); }
}
