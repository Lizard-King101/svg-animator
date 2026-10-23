import { NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnimationPlaybackService } from '../../_services/animation-playback.service';
import { EditorService } from '../../_services/editor.service';
import { ObjectClipboardCommandService } from '../../_services/object-clipboard-command.service';
import { SelectionArrangementService } from '../../_services/selection-arrangement.service';

@Component({
    selector: 'app-selection-actions',
    standalone: true,
    imports: [NgIf, FormsModule],
    templateUrl: './selection-actions.component.html',
    styleUrl: './selection-actions.component.scss',
})
export class SelectionActionsComponent {
    constructor(public editor: EditorService, public animation: AnimationPlaybackService,
        public clipboard: ObjectClipboardCommandService, public arrangement: SelectionArrangementService) {}
}
