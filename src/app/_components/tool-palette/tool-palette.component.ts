import { Tool } from '../../_services/tools/tool';
import { NgClass, NgFor, NgIf, TitleCasePipe } from "@angular/common";
import { Component } from "@angular/core";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { EditorService } from "../../_services/editor.service";

@Component({
    selector: "app-tool-palette",
    standalone: true,
    imports: [NgClass, NgFor, NgIf, TitleCasePipe, FaIconComponent],
    styles: [":host { display: contents; }"],
    template: `
      <div class="tool-bar">
        <div class="tool" *ngFor="let tool of editor.tools" (click)="tool.select($event)" (contextmenu)="tool.select($event)" [title]="tool.label ?? (tool.preferenceKey | titlecase)" role="button" tabindex="0" [attr.aria-label]="tool.label ?? (tool.preferenceKey | titlecase)"
             [attr.aria-expanded]="tool.children.length ? tool.showChildren : null" (keydown)="key($event, tool)"
             [ngClass]="{'selected': tool.selected, 'has-children': tool.children.length}">
          <fa-icon *ngIf="tool.icon" [icon]="tool.getIcon"></fa-icon>
          <div class="child-tools" *ngIf="tool.showChildren">
            <div class="tool" *ngFor="let child of tool.children" (click)="$event.stopPropagation(); child.select($event)" (contextmenu)="$event.stopPropagation(); child.select($event)" [ngClass]="{'selected': child.selected}" role="button" tabindex="0" [title]="child.label ?? (child.preferenceKey | titlecase)" [attr.aria-label]="child.label ?? (child.preferenceKey | titlecase)" (keydown)="key($event, child)">
              <fa-icon *ngIf="child.icon" [icon]="child.icon"></fa-icon>
            </div>
          </div>
        </div>
      </div>
    `,
})
export class ToolPaletteComponent {
    constructor(public editor: EditorService) {}
    key(event: KeyboardEvent, tool: Tool): void {
        if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.editor.tools.forEach(item => item.showChildren = false); return; }
        if(tool.children.length && event.key === 'ArrowRight') {
            event.preventDefault(); event.stopPropagation(); tool.showChildren = true; return;
        }
        if(event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); event.stopPropagation();
        tool.select(new MouseEvent('click'));
    }
}
