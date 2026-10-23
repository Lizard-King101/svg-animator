import { Directive, HostListener } from '@angular/core';
import { AnimationPlaybackService } from '../_services/animation-playback.service';
import { EditorService } from '../_services/editor.service';
import { EditorUiStateService } from '../_services/editor-ui-state.service';
import { ObjectClipboardCommandService } from '../_services/object-clipboard-command.service';
import { ReferenceImageService } from '../_services/reference-image.service';
import { isEditableEventTarget } from './editable-event-target';

/** Routes native clipboard events without stealing paste from text editors. */
@Directive({ selector: '[editorClipboard]', standalone: true })
export class EditorClipboardDirective {
    constructor(private editor: EditorService, private animation: AnimationPlaybackService,
        private ui: EditorUiStateService, private objects: ObjectClipboardCommandService,
        private reference: ReferenceImageService) {}

    private accepts(event: ClipboardEvent): boolean {
        return !event.defaultPrevented && !isEditableEventTarget(event.target)
            && !this.ui.activeDialog && this.animation.mode === 'edit' && !!this.editor.selectedSVG;
    }

    @HostListener('document:copy', ['$event']) copy(event: ClipboardEvent): void {
        if(this.accepts(event) && this.objects.copy(event.clipboardData)) event.preventDefault();
    }

    @HostListener('document:paste', ['$event']) paste(event: ClipboardEvent): void {
        if(!this.accepts(event)) return;
        if(this.reference.paste(event.clipboardData) || this.objects.paste()) event.preventDefault();
    }
}
