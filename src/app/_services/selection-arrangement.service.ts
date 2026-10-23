import { Injectable } from '@angular/core';
import { Alignment, AlignmentReference, alignmentTranslations, distributionTranslations, translateSelection } from '../editor/selection-arrangement';
import { selectionFrame } from '../editor/selection';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { EditorService } from './editor.service';

@Injectable()
export class SelectionArrangementService {
    reference: AlignmentReference = 'selection';
    constructor(private editor: EditorService, private animation: AnimationPlaybackService, private mutations: DocumentMutationService) {}

    get count(): number { return this.frame?.elements.length ?? 0; }
    get effectiveReference(): AlignmentReference { return this.count === 1 ? 'canvas' : this.reference; }
    get available(): boolean { return this.animation.mode === 'edit' && !!this.frame?.canTransform; }
    private get frame() { return this.editor.selectedSVG && selectionFrame(this.editor.selectedSVG, this.editor.selectedElements); }

    align(action: Alignment): void {
        const svg = this.editor.selectedSVG;
        if(!svg || !this.available) return;
        this.mutations.mutate(() => translateSelection(svg,
            alignmentTranslations(svg, this.editor.selectedElements, action, this.effectiveReference)));
    }

    distribute(axis: 'x' | 'y'): void {
        const svg = this.editor.selectedSVG;
        if(!svg || !this.available || this.count < 3) return;
        this.mutations.mutate(() => translateSelection(svg, distributionTranslations(svg, this.editor.selectedElements, axis)));
    }
}
