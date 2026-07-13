import { NgClass, NgFor, NgIf, NgTemplateOutlet } from "@angular/common";
import { Component } from "@angular/core";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { DocumentMutationService } from "../../_services/document-mutation.service";
import { EditorContextMenuItem, EditorService } from "../../_services/editor.service";

@Component({
    selector: "app-editor-context-menu",
    standalone: true,
    imports: [NgClass, NgFor, NgIf, NgTemplateOutlet, FaIconComponent],
    template: `
      <ng-template #itemsTemplate let-items>
        <div class="context-menu-row" *ngFor="let item of items">
          <button class="context-menu-item" [ngClass]="{'has-submenu': item.children?.length}"
                  (click)="$event.stopPropagation(); run(item)">
            <span>{{ item.label }}</span>
            <span class="context-menu-shortcut" *ngIf="item.shortcut">{{ item.shortcut }}</span>
            <fa-icon class="context-menu-arrow" *ngIf="item.children?.length" icon="angle-right"></fa-icon>
          </button>
          <div class="context-submenu" *ngIf="item.children?.length">
            <ng-container *ngTemplateOutlet="itemsTemplate; context: { $implicit: item.children }"></ng-container>
          </div>
        </div>
      </ng-template>

      <div class="context-menu" *ngIf="editor.contextMenu"
           [class.open-left]="opensLeft()"
           (mousedown)="$event.stopPropagation()" (click)="$event.stopPropagation()"
           (contextmenu)="$event.preventDefault(); $event.stopPropagation()"
           [style.left.px]="editor.contextMenu.x" [style.top.px]="editor.contextMenu.y">
        <ng-container *ngTemplateOutlet="itemsTemplate; context: { $implicit: editor.contextMenu.items }"></ng-container>
        <div class="context-menu-info" *ngIf="editor.contextMenu.infoLines?.length">
          <div class="context-menu-info-title" *ngIf="editor.contextMenu.infoTitle">{{ editor.contextMenu.infoTitle }}</div>
          <div class="context-menu-info-line" *ngFor="let line of editor.contextMenu.infoLines">{{ line }}</div>
        </div>
      </div>
    `,
})
export class EditorContextMenuComponent {
    constructor(public editor: EditorService, private mutations: DocumentMutationService) {}

    run(item: EditorContextMenuItem): void {
        const revision = this.mutations.revision;
        const before = this.mutations.captureState();
        this.editor.runContextMenuItem(item);
        if(revision === this.mutations.revision && before !== this.mutations.captureState()) this.mutations.commit();
    }

    opensLeft(): boolean {
        return !!this.editor.contextMenu && typeof window !== "undefined" && this.editor.contextMenu.x > window.innerWidth / 2;
    }
}
