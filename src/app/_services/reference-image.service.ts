import { Subscription } from 'rxjs';
import { Injectable, OnDestroy } from '@angular/core';
import { EditorService } from './editor.service';
import { DocumentMutationService } from './document-mutation.service';
import { fitReference, ReferenceImage, restoreReferenceImage } from '../editor/objects/reference-image';

@Injectable()
export class ReferenceImageService implements OnDestroy {
    private readonly restored: Subscription;
    private destroyed = false;
    panelOpen = false;
    busy = false;
    error = '';
    private draft?: ReferenceImage;
    private gestureDocument = this.editor.selectedSVG;
    get image(): ReferenceImage | undefined { return this.editor.selectedSVG?.referenceImage; }
    get display(): ReferenceImage | undefined { return this.gestureDocument === this.editor.selectedSVG ? this.draft ?? this.image : this.image; }

    constructor(private editor: EditorService, private mutations: DocumentMutationService) {
        this.restored = mutations.historyRestored.subscribe(() => this.cancel());
    }
    ngOnDestroy(): void { this.destroyed = true; this.cancel(); this.restored.unsubscribe(); }

    /** Paste events supply image bytes without requesting clipboard read permission. */
    paste(data: DataTransfer | null): boolean {
        if(!this.editor.selectedSVG || !data) return false;
        const files = Array.from(data.items ?? []).filter(item => item.kind === 'file')
            .map(item => item.getAsFile()).filter((file): file is File => !!file);
        if(!files.length) files.push(...Array.from(data.files ?? []));
        const image = files.find(file => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
            ?? files.find(file => file.type.startsWith('image/'));
        if(!image) return false;
        this.panelOpen = true;
        void this.import(image);
        return true;
    }

    async pasteFromClipboard(): Promise<void> {
        const svg = this.editor.selectedSVG;
        if(!svg || this.busy) return;
        this.panelOpen = true;
        this.error = '';
        this.busy = true;
        let file: File | undefined;
        try {
            const items = await navigator.clipboard.read();
            for(const item of items) {
                const type = item.types.find(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type));
                if(!type) continue;
                file = new File([await item.getType(type)], `Clipboard image.${type === 'image/jpeg' ? 'jpg' : type.split('/')[1]}`, { type });
                break;
            }
            if(!file) this.error = 'No image found. Copy an image or screenshot, then paste again.';
        } catch {
            this.error = 'Clipboard access is unavailable. Press Ctrl/Cmd+V over the canvas, or choose an image file.';
        } finally { this.busy = false; }
        if(file && !this.destroyed && this.editor.selectedSVG === svg) await this.import(file);
    }

    async import(file: File): Promise<void> {
        const svg = this.editor.selectedSVG;
        if(!svg || this.busy) return;
        this.error = '';
        if(!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
            this.error = 'Choose a PNG, JPEG, or WebP image up to 10 MB.';
            return;
        }
        this.busy = true;
        try {
            const source = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(new Error('Could not read this image.'));
                reader.readAsDataURL(file);
            });
            const decoded = new Image();
            decoded.src = source;
            await decoded.decode();
            if(this.destroyed || this.editor.selectedSVG !== svg) return;
            const image = restoreReferenceImage({ source, name: file.name, ...fitReference({ width: decoded.naturalWidth, height: decoded.naturalHeight }, svg.canvasBounds), opacity: 0.4, locked: true, visible: true });
            if(!image) throw new Error('Invalid image');
            this.cancel();
            this.mutations.mutate(() => svg.referenceImage = image, 'metadata');
        } catch {
            this.error = 'Could not open this image. Try another PNG, JPEG, or WebP file.';
        } finally { this.busy = false; }
    }

    update(patch: Partial<Omit<ReferenceImage, 'source'>>): void {
        const svg = this.editor.selectedSVG, image = this.image;
        if(!svg || !image) return;
        const next = restoreReferenceImage({ ...image, ...patch });
        if(!next) return;
        this.cancel();
        this.mutations.mutate(() => svg.referenceImage = next, 'metadata');
    }

    number(field: 'x' | 'y' | 'width' | 'height' | 'opacity', value: string): void {
        const image = this.image, number = Number(value);
        if(!image || value.trim() === '' || !Number.isFinite(number)) return;
        if(field !== 'opacity' && image.locked) return;
        if(field === 'width' || field === 'height') {
            if(number <= 0) return;
            const scale = number / image[field];
            this.update({ width: image.width * scale, height: image.height * scale });
        } else this.update({ [field]: field === 'opacity' ? number / 100 : number });
    }

    fit(): void {
        const svg = this.editor.selectedSVG, image = this.image;
        if(svg && image && !image.locked) this.update(fitReference(image, svg.canvasBounds));
    }

    remove(): void {
        const svg = this.editor.selectedSVG;
        if(!svg || !this.image) return;
        this.cancel();
        this.mutations.mutate(() => svg.referenceImage = undefined, 'metadata');
    }

    begin(): boolean {
        if(!this.image || this.image.locked || !this.image.visible) return false;
        this.gestureDocument = this.editor.selectedSVG;
        this.draft = { ...this.image };
        return true;
    }
    preview(bounds: Pick<ReferenceImage, 'x' | 'y' | 'width' | 'height'>): void {
        if(this.draft) this.draft = { ...this.draft, ...bounds };
    }
    finish(): void {
        const draft = this.draft;
        this.draft = undefined;
        if(draft && this.gestureDocument === this.editor.selectedSVG) this.update(draft);
    }
    cancel(): void { this.draft = undefined; }
}
