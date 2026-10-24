import { TestBed } from "@angular/core/testing";
import { FaIconLibrary } from "@fortawesome/angular-fontawesome";
import { faAngleRight } from "@fortawesome/free-solid-svg-icons";
import { DocumentMutationService } from "../../_services/document-mutation.service";
import { contextMenuSections, EditorContextMenuItem, EditorService } from "../../_services/editor.service";
import { EditorContextMenuComponent } from "./editor-context-menu.component";

describe("EditorContextMenuComponent", () => {
    afterEach(() => TestBed.resetTestingModule());

    it("joins non-empty sections with dividers", () => {
        const item = (label: string): EditorContextMenuItem => ({ label });
        expect(contextMenuSections([item("a")], [], [item("b"), item("c")], [item("d")]))
            .toEqual([item("a"), { label: "b", separatorBefore: true }, item("c"), { label: "d", separatorBefore: true }]);
    });

    it("supports keyboard navigation, submenus, disabled items, and focus return", async () => {
        const ran: string[] = [];
        const editor = {
            contextMenu: undefined as { x: number; y: number; items: EditorContextMenuItem[] } | undefined,
            closeContextMenu: () => { editor.contextMenu = undefined; },
            runContextMenuItem: (item: EditorContextMenuItem) => { item.action?.(); editor.closeContextMenu(); },
        };
        await TestBed.configureTestingModule({
            imports: [EditorContextMenuComponent],
            providers: [
                { provide: EditorService, useValue: editor },
                { provide: DocumentMutationService, useValue: { revision: 0, captureState: () => "", commit: () => true } },
            ],
        }).compileComponents();
        TestBed.inject(FaIconLibrary).addIcons(faAngleRight);
        const fixture = TestBed.createComponent(EditorContextMenuComponent);
        document.body.appendChild(fixture.nativeElement);
        const opener = document.createElement("button");
        document.body.appendChild(opener); opener.focus();

        editor.contextMenu = { x: 10, y: 10, items: contextMenuSections(
            [{ label: "Copy", action: () => ran.push("copy") }, { label: "Disabled", disabled: true }],
            [{ label: "Attach", children: [{ label: "Path A", action: () => ran.push("a") }, { label: "Path B", action: () => ran.push("b") }] }],
            [{ label: "Delete", danger: true, action: () => ran.push("delete") }],
        ) };
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const focused = () => document.activeElement?.textContent?.trim();
        const press = (key: string) => {
            (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
            fixture.detectChanges();
        };

        expect(root.querySelector(".context-menu")?.getAttribute("role")).toBe("menu");
        expect(document.activeElement).toBe(root.querySelector(".context-menu"));
        press("ArrowDown");
        expect(focused()).toBe("Copy");
        expect(root.querySelectorAll(".context-menu-row.separated").length).toBe(2);
        expect(root.querySelector(".context-menu-item.danger")?.textContent?.trim()).toBe("Delete");
        press("ArrowDown");
        expect(focused()).toBe("Attach");
        press("ArrowRight");
        expect(focused()).toBe("Path A");
        expect(root.querySelector("[aria-expanded=true]")?.textContent?.trim()).toBe("Attach");
        press("End");
        expect(focused()).toBe("Path B");
        press("ArrowLeft");
        expect(focused()).toBe("Attach");
        press("ArrowUp"); press("ArrowUp");
        expect(focused()).toBe("Delete");
        press("Escape");
        expect(editor.contextMenu).toBeUndefined();
        expect(document.activeElement).toBe(opener);
        expect(ran).toEqual([]);

        editor.contextMenu = { x: 10, y: 10, items: [{ label: "Copy", action: () => ran.push("copy") }] };
        fixture.detectChanges();
        press("ArrowDown");
        (document.activeElement as HTMLButtonElement).click();
        expect(ran).toEqual(["copy"]);
        expect(document.activeElement).toBe(opener);
        opener.remove(); fixture.nativeElement.remove();
    });
});
