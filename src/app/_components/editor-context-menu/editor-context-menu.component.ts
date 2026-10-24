import { NgClass, NgFor, NgIf, NgTemplateOutlet } from "@angular/common";
import { AfterViewChecked, ChangeDetectorRef, Component, ElementRef, ViewChild } from "@angular/core";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { DocumentMutationService } from "../../_services/document-mutation.service";
import { EditorContextMenuItem, EditorService } from "../../_services/editor.service";
import { positionPointMenu } from "../floating-popover";

@Component({
    selector: "app-editor-context-menu",
    standalone: true,
    imports: [NgClass, NgFor, NgIf, NgTemplateOutlet, FaIconComponent],
    template: `
      <ng-template #itemsTemplate let-items let-depth="depth">
        <div class="context-menu-row" role="none" *ngFor="let item of items" [class.separated]="item.separatorBefore">
          <button type="button" class="context-menu-item" role="menuitem" tabindex="-1"
                  [ngClass]="{'has-submenu': item.children?.length, 'danger': item.danger}"
                  [disabled]="item.disabled"
                  [attr.aria-haspopup]="item.children?.length ? 'menu' : null"
                  [attr.aria-expanded]="item.children?.length ? openSubmenu === item : null"
                  (mouseenter)="depth === 0 && hover(item)"
                  (click)="$event.stopPropagation(); activate(item, $event)">
            <span>{{ item.label }}</span>
            <span class="context-menu-shortcut" *ngIf="item.shortcut">{{ item.shortcut }}</span>
            <fa-icon class="context-menu-arrow" *ngIf="item.children?.length" icon="angle-right"></fa-icon>
          </button>
          <div class="context-submenu" role="menu" [attr.aria-label]="item.label" *ngIf="item.children?.length" [class.open]="openSubmenu === item">
            <ng-container *ngTemplateOutlet="itemsTemplate; context: { $implicit: item.children, depth: depth + 1 }"></ng-container>
          </div>
        </div>
      </ng-template>

      <div #menu class="context-menu" role="menu" aria-label="Context menu" tabindex="-1" *ngIf="editor.contextMenu"
           [class.open-left]="opensLeft()"
           (keydown)="key($event)"
           (mousedown)="$event.stopPropagation()" (click)="$event.stopPropagation()"
           (contextmenu)="$event.preventDefault(); $event.stopPropagation()">
        <ng-container *ngTemplateOutlet="itemsTemplate; context: { $implicit: editor.contextMenu.items, depth: 0 }"></ng-container>
        <div class="context-menu-info" *ngIf="editor.contextMenu.infoLines?.length">
          <div class="context-menu-info-title" *ngIf="editor.contextMenu.infoTitle">{{ editor.contextMenu.infoTitle }}</div>
          <div class="context-menu-info-line" *ngFor="let line of editor.contextMenu.infoLines">{{ line }}</div>
        </div>
      </div>
    `,
    styles: `
      .context-menu .context-menu-row.separated { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border); }
      .context-menu:focus, .context-menu .context-menu-item:focus { outline: none; }
      .context-menu .context-menu-item:focus-visible { background: var(--accent-dim); color: var(--accent); outline: 1px solid var(--accent); outline-offset: -1px; }
      .context-menu .context-menu-item.danger:hover:not(:disabled),
      .context-menu .context-menu-item.danger:focus-visible { background: rgba(244, 92, 122, 0.12); color: var(--danger); outline-color: var(--danger); }
      .context-menu .context-menu-item:disabled,
      .context-menu .context-menu-item:disabled:hover { background: transparent; color: var(--text-primary); opacity: 0.4; cursor: default; }
      .context-menu .context-submenu.open { display: flex; }
      .context-menu .context-menu-item[aria-expanded="true"] { background: var(--accent-dim); color: var(--accent); }
    `,
})
export class EditorContextMenuComponent implements AfterViewChecked {
    /** The root item whose submenu is open from the keyboard or pointer. */
    openSubmenu?: EditorContextMenuItem;
    @ViewChild("menu") private menu?: ElementRef<HTMLElement>;
    private placed?: EditorService["contextMenu"];
    private returnFocus?: HTMLElement;

    constructor(public editor: EditorService, private mutations: DocumentMutationService, private changes: ChangeDetectorRef) {}

    /**
     * Measures each newly opened menu once, keeps it inside the viewport, and focuses the menu so the
     * first arrow key selects an item without highlighting one for pointer users.
     */
    ngAfterViewChecked(): void {
        const menu = this.editor.contextMenu;
        if(menu === this.placed) return;
        this.placed = menu;
        this.openSubmenu = undefined;
        const element = this.menu?.nativeElement;
        if(!menu || !element) return;
        const active = document.activeElement;
        if(active instanceof HTMLElement && active !== document.body && !element.contains(active)) this.returnFocus = active;
        const { width, height } = element.getBoundingClientRect();
        const position = positionPointMenu({ x: menu.x, y: menu.y }, { width, height }, this.opensLeft());
        element.style.left = `${position.left}px`;
        element.style.top = `${position.top}px`;
        element.focus({ preventScroll: true });
    }

    hover(item: EditorContextMenuItem): void {
        this.openSubmenu = item.children?.length ? item : undefined;
    }

    activate(item: EditorContextMenuItem, event: Event): void {
        if(item.disabled) return;
        if(item.children?.length) {
            this.openChildren(item, event.currentTarget as HTMLElement);
            return;
        }
        this.run(item);
        this.restoreFocus();
    }

    run(item: EditorContextMenuItem): void {
        const revision = this.mutations.revision;
        const before = this.mutations.captureState();
        this.editor.runContextMenuItem(item);
        if(revision === this.mutations.revision && before !== this.mutations.captureState()) this.mutations.commit();
    }

    /** Menu keyboard model: arrows/Home/End move, Right/Enter open a submenu, Left/Escape back out, Tab closes. */
    key(event: KeyboardEvent): void {
        const current = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".context-menu-item") : null;
        const level = current?.closest<HTMLElement>("[role=menu]") ?? this.menu?.nativeElement;
        if(!level) return;
        const items = this.items(level);
        const index = current ? items.indexOf(current) : -1;
        const inSubmenu = level !== this.menu?.nativeElement;
        const focusAt = (next: number) => items[(next + items.length) % items.length]?.focus();
        switch(event.key) {
            case "ArrowDown": focusAt(index + 1); break;
            case "ArrowUp": focusAt(index < 0 ? -1 : index - 1); break;
            case "Home": focusAt(0); break;
            case "End": focusAt(-1); break;
            case "ArrowRight":
                if(current?.getAttribute("aria-haspopup")) current.click();
                break;
            case "ArrowLeft":
                if(!inSubmenu) return;
                this.closeSubmenu(level);
                break;
            case "Escape":
                if(inSubmenu) this.closeSubmenu(level);
                else this.close();
                break;
            case "Tab":
                this.close();
                return;
            default: return;
        }
        event.preventDefault();
        event.stopPropagation();
    }

    opensLeft(): boolean {
        return !!this.editor.contextMenu && typeof window !== "undefined" && this.editor.contextMenu.x > window.innerWidth / 2;
    }

    private openChildren(item: EditorContextMenuItem, trigger: HTMLElement): void {
        this.openSubmenu = item;
        // Render the submenu as open before focusing into it.
        this.changes.detectChanges();
        const submenu = trigger.parentElement?.querySelector<HTMLElement>(":scope > .context-submenu");
        if(submenu) this.items(submenu)[0]?.focus();
    }

    private closeSubmenu(submenu: HTMLElement): void {
        this.openSubmenu = undefined;
        submenu.parentElement?.querySelector<HTMLElement>(":scope > .context-menu-item")?.focus();
    }

    private close(): void {
        this.editor.closeContextMenu();
        this.restoreFocus();
    }

    private restoreFocus(): void {
        const target = this.returnFocus;
        this.returnFocus = undefined;
        if(target?.isConnected) target.focus({ preventScroll: true });
    }

    private items(level: HTMLElement): HTMLElement[] {
        return Array.from(level.querySelectorAll<HTMLElement>(":scope > .context-menu-row > .context-menu-item:not(:disabled)"));
    }
}
