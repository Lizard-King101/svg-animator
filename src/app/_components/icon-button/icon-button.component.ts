import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { NgbTooltip } from '@ng-bootstrap/ng-bootstrap';

/** Compact command/toggle with the same name, focus treatment and tooltip for every input path. */
@Component({
    selector: 'app-icon-button', standalone: true, imports: [FaIconComponent, NgbTooltip],
    template: `<button type="button" [attr.aria-label]="label" [attr.aria-pressed]="pressed ?? null"
        [attr.aria-expanded]="expanded ?? null" [attr.aria-controls]="controls || null"
        [disabled]="disabled" [class.active]="pressed || expanded"
        [ngbTooltip]="tooltip || label" container="body" placement="top auto" triggers="hover focus" [openDelay]="250"
        (click)="activated.emit($event)"><fa-icon [icon]="icon" /></button>`,
    styles: [`:host { display:inline-flex; flex:0 0 auto; }
        button { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px;
          padding:0; border:1px solid transparent; border-radius:var(--radius-sm); background:transparent;
          color:var(--text-secondary); cursor:pointer; font-size:12px; }
        button:hover { background:var(--bg-elevated); color:var(--text-primary); }
        button.active { background:var(--accent-dim); color:var(--accent); }
        button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
        button:disabled { opacity:.4; cursor:default; }`],
})
export class IconButtonComponent {
    @Input({ required: true }) icon!: IconDefinition;
    @Input({ required: true }) label = '';
    @Input() tooltip = '';
    @Input() pressed?: boolean;
    @Input() expanded?: boolean;
    @Input() controls = '';
    @Input() disabled = false;
    @Output() activated = new EventEmitter<MouseEvent>();
}
