import { Injectable } from '@angular/core';
import { EditorService } from './editor.service';
import { AnimationGestureService } from './animation-gesture.service';
import { DocumentMutationService } from './document-mutation.service';
import { SelectionTransformInteraction } from './tools/selection-transform.interaction';
import { Point } from '../editor/objects/point.object';
import { AnimationPlaybackService } from './animation-playback.service';
import { ObjectClipboardCommandService } from './object-clipboard-command.service';

/** Keyboard commands for the same selection and transform behavior used by the canvas. */
@Injectable()
export class CanvasSelectionCommandService {
    constructor(private editor: EditorService, private gestures: AnimationGestureService, private mutations: DocumentMutationService,
        private animation: AnimationPlaybackService, private clipboard: ObjectClipboardCommandService) {}

    handleKey(event: KeyboardEvent): boolean {
        if(event.defaultPrevented) return false;
        if(this.clipboard.handleKey(event)) return true;
        if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            this.editor.selectedElements = this.editor.selectedSVG?.elements.filter((element) => element.visible && !element.locked) ?? [];
        } else if(event.key === 'Escape') {
            this.editor.selectedElements = [];
        } else {
            const direction: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
            const delta = direction[event.key];
            // Animate mode already reserves arrows for keyframe retiming.
            if(this.animation.mode !== 'edit' || !delta || event.ctrlKey || event.metaKey || event.altKey || this.editor.selectedPathAnchor || !this.editor.selectedElements.length) return false;
            const step = event.shiftKey ? 10 : 1;
            this.gestures.begin();
            new SelectionTransformInteraction(this.editor).nudge(new Point(delta[0] * step, delta[1] * step));
            this.gestures.end();
            this.mutations.commit();
        }
        event.preventDefault();
        return true;
    }
}
