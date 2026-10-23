import { Component, EventEmitter, Input, Optional, Output } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { ProjectColorsService } from '../../_services/project-colors.service';
import { Color } from '../../editor/objects/color.object';
import { ProjectColor } from '../../editor/objects/project-colors';

@Component({
    selector: 'app-project-colors', standalone: true, imports: [NgIf, NgFor],
    template: `
      <section *ngIf="palette?.available" aria-label="Project colors">
        <div class="heading">Project colors <span *ngIf="!palette!.colors.length">No colors yet</span></div>
        <div class="swatches">
          <button *ngFor="let item of palette!.colors; trackBy: trackColor" type="button" class="swatch"
            [class.selected]="item.color === value" [attr.aria-pressed]="item.color === value"
            [attr.aria-label]="'Use ' + description(item)" [title]="description(item)"
            (click)="colorSelected.emit(item.color)"><span [style.background]="item.color"></span></button>
        </div>
        <details *ngIf="manage && palette!.colors.length">
          <summary>Manage colors</summary>
          <div class="entry" *ngFor="let item of palette!.colors; trackBy: trackColor">
            <span class="swatch preview"><span [style.background]="item.color"></span></span>
            <input type="text" maxlength="80" [value]="item.name ?? ''" [placeholder]="item.color"
              [attr.aria-label]="'Name ' + item.color" (blur)="commitName($event, item)"
              (keydown.escape)="cancelName($event, item)" (keydown.enter)="$any($event.target).blur()">
            <button type="button" class="btn btn-sm btn-secondary" [attr.aria-label]="(item.pinned ? 'Unpin ' : 'Pin ') + (item.name || item.color)"
              [attr.aria-pressed]="!!item.pinned" (click)="palette!.pin(item.color, !item.pinned)">{{ item.pinned ? '★' : '☆' }}</button>
          </div>
        </details>
      </section>`,
    styles: `:host { display:block; } section { margin-top:10px; }
      .heading { font-size:11px; font-weight:600; color:var(--text-secondary); } .heading span { font-weight:normal; margin-left:6px; }
      .swatches { display:flex; flex-wrap:wrap; gap:5px; max-height:150px; overflow:auto; padding:4px; margin:4px -4px; }
      .swatch { position:relative; display:block; flex:0 0 26px; width:26px; height:26px; padding:0; border:1px solid var(--border); border-radius:4px; overflow:hidden;
        background:repeating-conic-gradient(#888 0% 25%, #fff 0% 50%) 0 / 10px 10px; }
      .swatch span { display:block; width:100%; height:100%; } button.swatch { cursor:pointer; }
      .swatch.selected, button.swatch:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
      summary { font-size:11px; color:var(--text-secondary); cursor:pointer; }
      .entry { display:flex; gap:5px; align-items:center; margin-top:5px; } details { max-height:180px; overflow:auto; }
      input { min-width:0; width:100%; color:var(--text-primary); background:var(--bg-input); border:1px solid var(--border); border-radius:4px; padding:4px; font-size:11px; }`,
})
export class ProjectColorsComponent {
    @Input() value: string | null = null;
    @Input() manage = false;
    @Output() colorSelected = new EventEmitter<string>();
    constructor(@Optional() public palette: ProjectColorsService | null) {}
    trackColor(_index: number, item: ProjectColor): string { return item.color; }
    description(item: ProjectColor): string {
        const opacity = Math.round(new Color(item.color).alpha * 100);
        return `${item.name ? item.name + ' · ' : ''}${item.color}${opacity < 100 ? ' · ' + opacity + '% opacity' : ''}${item.pinned ? ' · pinned' : ''}`;
    }
    cancelName(event: Event, item: ProjectColor): void {
        event.stopPropagation(); (event.target as HTMLInputElement).value = item.name ?? ''; (event.target as HTMLInputElement).blur();
    }
    commitName(event: Event, item: ProjectColor): void {
        const value = (event.target as HTMLInputElement).value.trim();
        if(value !== (item.name ?? '')) this.palette?.rename(item.color, value);
    }
}
