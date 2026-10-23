import { Injectable } from '@angular/core';
import { captureObjectClipboard, instantiateObjectClipboard } from '../editor/object-clipboard';
import { selectionRoots } from '../editor/selection';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { EditorService } from './editor.service';
import { LayerOperationsService } from './layer-operations.service';
import { ObjectClipboardService } from './object-clipboard.service';

@Injectable()
export class ObjectClipboardCommandService {
    message = '';
    constructor(private editor: EditorService, private animation: AnimationPlaybackService,
        private mutations: DocumentMutationService, private layers: LayerOperationsService, private clipboard: ObjectClipboardService) {}

    get canCopy(): boolean {
        return this.animation.mode === 'edit' && !!this.editor.selectedSVG
            && selectionRoots(this.editor.selectedSVG, this.editor.selectedElements).length > 0;
    }
    get canPaste(): boolean { return this.animation.mode === 'edit' && !!this.editor.selectedSVG && !!this.clipboard.fragment; }

    copy(data?: DataTransfer | null): boolean {
        if(!this.canCopy) return false;
        const fragment = this.animation.withBaseState(() => captureObjectClipboard(this.editor.selectedSVG!, this.editor.selectedElements));
        if(!fragment) return false;
        this.clipboard.set(fragment);
        // Replace a stale system image when the user explicitly copies artwork.
        // The editable fragment remains app-local; this marker carries no document data.
        if(data) data.setData('text/plain', 'SVG Animator objects');
        else if(typeof navigator !== 'undefined') void navigator.clipboard?.writeText('SVG Animator objects').catch(() => {});
        this.message = `Copied ${fragment.count} ${fragment.count === 1 ? 'object' : 'objects'}. Available across projects until reload.`;
        return true;
    }

    paste(inPlace = false): boolean {
        if(!this.canPaste) return false;
        const offset = inPlace ? 0 : 10 * (this.clipboard.pasteCount + 1);
        const fragment = instantiateObjectClipboard(this.clipboard.fragment!, `paste-${this.editor.ID}`, offset);
        this.animation.withBaseState(() => this.mutations.mutate(() => {
            this.editor.selectedElements = this.layers.insertFragment(fragment.document, fragment.rootIds);
        }));
        if(!inPlace) this.clipboard.pasteCount++;
        this.message = inPlace ? 'Pasted in place.' : `Pasted with a ${offset}-unit offset.`;
        return true;
    }

    handleKey(event: KeyboardEvent): boolean {
        if(this.animation.mode !== 'edit' || event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return false;
        // Plain copy/paste must reach native clipboard events so image data can
        // take priority over the app-local object clipboard.
        const key = event.key.toLowerCase();
        // Stop canvas letter commands without cancelling the browser's event.
        if(!event.shiftKey && (key === 'c' || key === 'v')) return true;
        if(key !== 'v' || !event.shiftKey) return false;
        const handled = this.paste(true);
        if(handled) event.preventDefault();
        return handled;
    }
}
