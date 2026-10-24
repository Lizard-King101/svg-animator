import { NgFor, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { SelectionArrangementService } from '../../_services/selection-arrangement.service';
import { Alignment } from '../../editor/selection-arrangement';

interface AlignmentButton { action: Alignment; label: string; guide: string; shapes: string; }
interface DistributionButton { axis: 'x' | 'y'; label: string; shapes: string; }

/** Header align/distribute controls for the current selection. */
@Component({
    selector: 'app-selection-actions',
    standalone: true,
    imports: [NgFor, NgIf, FormsModule, FaIconComponent],
    templateUrl: './selection-actions.component.html',
    styleUrl: './selection-actions.component.scss',
})
export class SelectionActionsComponent {
    readonly unavailableHint = 'Show and unlock layers, and detach motion paths, to arrange this selection.';
    readonly alignments: AlignmentButton[] = [
        { action: 'left', label: 'Align left edges', guide: 'M2 1h1.5v14H2z', shapes: 'M4.5 3h9v3.5h-9zM4.5 9.5H10V13H4.5z' },
        { action: 'centerX', label: 'Align horizontal centers', guide: 'M7.25 1h1.5v14h-1.5z', shapes: 'M2.5 3h11v3.5h-11zM4.5 9.5h7V13h-7z' },
        { action: 'right', label: 'Align right edges', guide: 'M12.5 1H14v14h-1.5z', shapes: 'M2.5 3h9v3.5h-9zM6 9.5h5.5V13H6z' },
        { action: 'top', label: 'Align top edges', guide: 'M1 2h14v1.5H1z', shapes: 'M3 4.5h3.5v9H3zM9.5 4.5H13V10H9.5z' },
        { action: 'centerY', label: 'Align vertical centers', guide: 'M1 7.25h14v1.5H1z', shapes: 'M3 2.5h3.5v11H3zM9.5 4.5H13v7H9.5z' },
        { action: 'bottom', label: 'Align bottom edges', guide: 'M1 12.5h14V14H1z', shapes: 'M3 2.5h3.5v9H3zM9.5 6H13v5.5H9.5z' },
    ];
    readonly distributions: DistributionButton[] = [
        { axis: 'x', label: 'Equal horizontal gaps', shapes: 'M1.5 4h3v8h-3zM6.5 5.5h3v5h-3zM11.5 3h3v10h-3z' },
        { axis: 'y', label: 'Equal vertical gaps', shapes: 'M4 1.5h8v3H4zM5.5 6.5h5v3h-5zM3 11.5h10v3H3z' },
    ];

    constructor(public arrangement: SelectionArrangementService) {}
}
