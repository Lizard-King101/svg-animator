import { Component } from '@angular/core';
import { NgIf } from '@angular/common';
import { ReferenceImageService } from '../../_services/reference-image.service';

@Component({
    selector: 'app-reference-panel', standalone: true, imports: [NgIf],
    template: `
      <details #panel [open]="reference.panelOpen" (toggle)="reference.panelOpen = panel.open">
        <summary>Tracing reference</summary>
        <p>Saved with your project. Hidden in exports.</p>
        <input #file type="file" accept="image/png,image/jpeg,image/webp" hidden (change)="choose(file)">
        <button class="btn btn-sm btn-secondary" [disabled]="reference.busy" (click)="file.click()">{{ reference.busy ? 'Opening…' : reference.image ? 'Replace image…' : 'Add image…' }}</button>
        <button class="btn btn-sm btn-secondary paste" [disabled]="reference.busy" (click)="reference.pasteFromClipboard()">Paste image</button>
        <p>Or copy an image and press Ctrl/Cmd+V over the canvas.</p>
        <p *ngIf="reference.error" role="alert">{{ reference.error }}</p>
        <ng-container *ngIf="reference.image as image">
          <p class="filename" [title]="image.name">{{ image.name }}</p>
          <div class="actions">
            <button class="btn btn-sm btn-secondary" [attr.aria-pressed]="image.visible" (click)="reference.update({visible: !image.visible})">{{ image.visible ? 'Hide' : 'Show' }}</button>
            <button class="btn btn-sm btn-secondary" [attr.aria-pressed]="image.locked" (click)="reference.update({locked: !image.locked})">{{ image.locked ? 'Unlock' : 'Lock' }}</button>
            <button class="btn btn-sm btn-secondary" (click)="reference.remove()">Remove</button>
          </div>
          <label>Opacity % <input aria-label="Reference opacity" type="number" min="0" max="100" [value]="image.opacity * 100" (change)="reference.number('opacity', $any($event.target).value)"></label>
          <fieldset [disabled]="image.locked">
            <div class="fields">
              <label>X <input aria-label="Reference X" type="number" [value]="image.x" (change)="reference.number('x', $any($event.target).value)"></label>
              <label>Y <input aria-label="Reference Y" type="number" [value]="image.y" (change)="reference.number('y', $any($event.target).value)"></label>
              <label>Width <input aria-label="Reference width" type="number" min="1" [value]="image.width" (change)="reference.number('width', $any($event.target).value)"></label>
              <label>Height <input aria-label="Reference height" type="number" min="1" [value]="image.height" (change)="reference.number('height', $any($event.target).value)"></label>
            </div>
            <button class="btn btn-sm btn-secondary" (click)="reference.fit()">Fit to canvas</button>
          </fieldset>
          <p>{{ image.locked ? 'Locked for tracing. Unlock to reposition.' : 'Drag the frame to move; drag its corner to scale. Lock when ready to trace.' }}</p>
        </ng-container>
      </details>`,
    styles: `:host { display:block; flex:0 0 auto; padding:10px 12px; border-bottom:1px solid var(--border); }
      .paste { margin-left:4px; }
      summary { font-weight:600; cursor:pointer; } p { font-size:11px; color:var(--text-secondary); margin:8px 0; }
      .filename { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .actions { display:flex; gap:4px; margin-bottom:8px; } .fields { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
      label { display:flex; align-items:center; gap:6px; white-space:nowrap; font-size:11px; margin-bottom:6px; }
      input { width:100%; min-width:0; color:var(--text-primary); background:var(--bg-input); border:1px solid var(--border); border-radius:4px; padding:4px; }
      fieldset { min-width:0; }`,
})
export class ReferencePanelComponent {
    constructor(public reference: ReferenceImageService) {}
    choose(input: HTMLInputElement): void {
        const file = input.files?.[0];
        input.value = '';
        if(file) void this.reference.import(file);
    }
}
