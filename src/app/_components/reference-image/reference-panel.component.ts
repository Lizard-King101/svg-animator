import { Component, DoCheck, ElementRef, HostListener, ViewChild } from '@angular/core';
import { NgIf, NgStyle } from '@angular/common';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { ReferenceImageService } from '../../_services/reference-image.service';
import { formatNumberField } from '../attributes/number/number-field.directive';
import { floatingPopoverStyle, positionFloatingPopover } from '../floating-popover';

const POPOVER_WIDTH = 280;
const POPOVER_HEIGHT = 440;

/**
 * Header button and popover for the tracing reference. The popover stays open while the reference
 * is adjusted on the canvas; it closes from its button, its close control, or Escape.
 */
@Component({
    selector: 'app-reference-panel', standalone: true, imports: [NgIf, NgStyle, FaIconComponent],
    template: `
      <button #toggle type="button" class="btn-icon" [class.has-reference]="!!reference.image"
              aria-haspopup="dialog" [attr.aria-expanded]="reference.panelOpen"
              [attr.aria-label]="reference.image ? 'Tracing reference (' + reference.image.name + ')' : 'Tracing reference'"
              [title]="reference.image ? 'Tracing reference · ' + reference.image.name : 'Tracing reference'"
              (click)="toggleOpen()">
        <fa-icon icon="image"></fa-icon>
      </button>
      <div #popover *ngIf="reference.panelOpen" class="popover" role="dialog" tabindex="-1" aria-label="Tracing reference"
           [ngStyle]="popoverStyle" (keydown)="key($event)">
        <div class="title">
          <strong>Tracing reference</strong>
          <button type="button" class="close" aria-label="Close tracing reference" title="Close" (click)="close()"><fa-icon icon="times"></fa-icon></button>
        </div>
        <p>Saved with your project. Hidden in exports.</p>
        <input #file type="file" accept="image/png,image/jpeg,image/webp" hidden (change)="choose(file)">
        <div class="actions">
          <button class="btn btn-sm btn-secondary" [disabled]="reference.busy" (click)="file.click()">{{ reference.busy ? 'Opening…' : reference.image ? 'Replace image…' : 'Add image…' }}</button>
          <button class="btn btn-sm btn-secondary" [disabled]="reference.busy" (click)="reference.pasteFromClipboard()">Paste image</button>
        </div>
        <p>Or copy an image and press Ctrl/Cmd+V over the canvas.</p>
        <p *ngIf="reference.error" role="alert">{{ reference.error }}</p>
        <ng-container *ngIf="reference.image as image">
          <p class="filename" [title]="image.name">{{ image.name }}</p>
          <div class="actions">
            <button class="btn btn-sm btn-secondary" [attr.aria-pressed]="image.visible" (click)="reference.update({visible: !image.visible})">{{ image.visible ? 'Hide' : 'Show' }}</button>
            <button class="btn btn-sm btn-secondary" [attr.aria-pressed]="image.locked" (click)="reference.update({locked: !image.locked})">{{ image.locked ? 'Unlock' : 'Lock' }}</button>
            <button class="btn btn-sm btn-secondary" (click)="reference.remove()">Remove</button>
          </div>
          <label>Opacity % <input aria-label="Reference opacity" type="number" min="0" max="100" [value]="format(image.opacity * 100)" (change)="reference.number('opacity', $any($event.target).value)"></label>
          <fieldset [disabled]="image.locked">
            <div class="fields">
              <label>X <input aria-label="Reference X" type="number" [value]="format(image.x)" (change)="reference.number('x', $any($event.target).value)"></label>
              <label>Y <input aria-label="Reference Y" type="number" [value]="format(image.y)" (change)="reference.number('y', $any($event.target).value)"></label>
              <label>Width <input aria-label="Reference width" type="number" min="1" [value]="format(image.width)" (change)="reference.number('width', $any($event.target).value)"></label>
              <label>Height <input aria-label="Reference height" type="number" min="1" [value]="format(image.height)" (change)="reference.number('height', $any($event.target).value)"></label>
            </div>
            <button class="btn btn-sm btn-secondary" (click)="reference.fit()">Fit to canvas</button>
          </fieldset>
          <p>{{ image.locked ? 'Locked for tracing. Unlock to reposition.' : 'Drag the frame to move; drag its corner to scale. Lock when ready to trace.' }}</p>
        </ng-container>
      </div>`,
    styles: `:host { display:inline-flex; flex:0 0 auto; }
      .btn-icon { position:relative; display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; padding:0;
        background:transparent; border:1px solid transparent; border-radius:var(--radius-sm); color:var(--text-secondary); font-size:12px; cursor:pointer;
        transition:background .15s, color .15s, border-color .15s; }
      .btn-icon:hover { background:var(--bg-elevated); color:var(--text-primary); border-color:var(--border-bright); }
      .btn-icon[aria-expanded="true"] { color:var(--accent); background:var(--accent-dim); }
      .btn-icon.has-reference::after { content:""; position:absolute; top:3px; right:3px; width:5px; height:5px; border-radius:50%; background:var(--accent); }
      button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
      .popover { position:fixed; z-index:150; width:280px; padding:10px 12px 12px; overflow-y:auto; background:var(--bg-elevated);
        border:1px solid var(--border-bright); border-radius:var(--radius-md); box-shadow:0 12px 32px rgba(0, 0, 0, .45); outline:none; font-size:12px; }
      .title { display:flex; align-items:center; justify-content:space-between; }
      .close { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; padding:0; border:0; border-radius:var(--radius-sm);
        background:transparent; color:var(--text-secondary); font-size:11px; cursor:pointer; }
      .close:hover { background:var(--bg-surface); color:var(--text-primary); }
      p { font-size:11px; color:var(--text-secondary); margin:8px 0; }
      .filename { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .actions { display:flex; gap:4px; margin-bottom:8px; } .fields { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
      label { display:flex; align-items:center; gap:6px; white-space:nowrap; font-size:11px; margin-bottom:6px; }
      input { width:100%; min-width:0; color:var(--text-primary); background:var(--bg-input); border:1px solid var(--border); border-radius:4px; padding:4px; }
      fieldset { min-width:0; }`,
})
export class ReferencePanelComponent implements DoCheck {
    popoverStyle: Record<string, string> = {};
    @ViewChild('toggle', { static: true }) private toggleButton!: ElementRef<HTMLButtonElement>;
    private focusOnOpen = false;
    private wasOpen = false;

    @ViewChild('popover') set popover(ref: ElementRef<HTMLElement> | undefined) {
        if(ref && this.focusOnOpen) ref.nativeElement.focus({ preventScroll: true });
        this.focusOnOpen = false;
    }

    constructor(public reference: ReferenceImageService) {}

    format(value: number): string { return formatNumberField(value); }

    toggleOpen(): void {
        if(this.reference.panelOpen) { this.close(); return; }
        this.focusOnOpen = true;
        this.reference.panelOpen = true;
    }

    close(returnFocus = true): void {
        this.reference.panelOpen = false;
        if(returnFocus) this.toggleButton.nativeElement.focus({ preventScroll: true });
    }

    key(event: KeyboardEvent): void {
        if(event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation(); this.close();
    }

    choose(input: HTMLInputElement): void {
        const file = input.files?.[0];
        input.value = '';
        if(file) void this.reference.import(file);
    }

    /** Positions on every open, including opens requested by the service when an image is pasted. */
    ngDoCheck(): void {
        if(this.reference.panelOpen && !this.wasOpen) this.position();
        this.wasOpen = this.reference.panelOpen;
    }

    @HostListener('window:resize') position(): void {
        this.popoverStyle = floatingPopoverStyle(positionFloatingPopover(this.toggleButton.nativeElement.getBoundingClientRect(),
            { width: POPOVER_WIDTH, preferredHeight: POPOVER_HEIGHT }));
    }
}
