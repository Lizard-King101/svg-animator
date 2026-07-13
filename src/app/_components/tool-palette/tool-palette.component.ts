import { NgClass, NgFor, NgIf } from "@angular/common";
import { Component } from "@angular/core";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { EditorService } from "../../_services/editor.service";

@Component({
    selector: "app-tool-palette",
    standalone: true,
    imports: [NgClass, NgFor, NgIf, FaIconComponent],
    styles: [":host { display: contents; }"],
    template: `
      <div class="tool-bar">
        <div class="tool" *ngFor="let tool of editor.tools" (click)="tool.select($event)" (contextmenu)="tool.select($event)"
             [ngClass]="{'selected': tool.selected, 'has-children': tool.children.length}">
          <fa-icon *ngIf="tool.icon" [icon]="tool.getIcon"></fa-icon>
          <div class="child-tools" *ngIf="tool.showChildren">
            <div class="tool" *ngFor="let child of tool.children" (click)="child.select($event)" (contextmenu)="child.select($event)" [ngClass]="{'selected': child.selected}">
              <fa-icon *ngIf="child.icon" [icon]="child.icon"></fa-icon>
            </div>
          </div>
        </div>
      </div>
    `,
})
export class ToolPaletteComponent {
    constructor(public editor: EditorService) {}
}
