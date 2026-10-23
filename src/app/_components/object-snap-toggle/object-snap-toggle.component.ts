import { Component } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';

@Component({
    selector: 'app-object-snap-toggle',
    standalone: true,
    imports: [FaIconComponent],
    template: `<button type="button" class="btn-icon" [attr.aria-pressed]="preferences.objectSnapping"
        aria-label="Snap objects and path points" title="Snap objects and path points · Hold Alt to bypass (after starting an anchor move)"
        (click)="preferences.setObjectSnapping(!preferences.objectSnapping)">
        <fa-icon icon="magnet"></fa-icon>
    </button>`,
    styles: `
        :host { display: inline-flex; flex: 0 0 auto; }
        .btn-icon[aria-pressed="true"] { color: var(--accent); background: var(--accent-dim); }
        button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    `,
})
export class ObjectSnapToggleComponent {
    constructor(public preferences: EditorPreferencesService) {}
}
