import { Router } from "@angular/router";
import { ProjectExportService } from "../_services/project-export.service";
import { ProjectRecord, ProjectService } from "../_services/project.service";
import { ProjectFileImportService } from "../_services/project-file-import.service";
import { ChangeDetectorRef } from "@angular/core";
import { HomePage } from "./home.page";

describe("HomePage project actions", () => {
    const project: ProjectRecord = {
        id: "project", name: "Project", thumbnail: "<svg/>", createdAt: 1, updatedAt: 2,
        svgData: { id: "project", name: "Project", width: 100, height: 100, elements: [] },
    };
    let projects: jasmine.SpyObj<ProjectService>;
    let exporter: jasmine.SpyObj<ProjectExportService>;
    let page: HomePage;
    let importer: jasmine.SpyObj<ProjectFileImportService>;

    beforeEach(() => {
        projects = jasmine.createSpyObj<ProjectService>("ProjectService", ["list", "remove", "undoDelete"]);
        projects.list.and.returnValue([]);
        exporter = jasmine.createSpyObj<ProjectExportService>("ProjectExportService", ["download"]);
        importer = jasmine.createSpyObj<ProjectFileImportService>("ProjectFileImportService", ["import"]);
        page = new HomePage(
            projects,
            exporter,
            importer,
            jasmine.createSpyObj<Router>("Router", ["navigate"]),
            jasmine.createSpyObj<ChangeDetectorRef>("ChangeDetectorRef", ["detectChanges"]),
        );
        page.projects = [project];
    });

    it("handles a canceled picker without changing the gallery", async () => {
        await page.importFile({ target: { files: [], value: '' } } as unknown as Event);
        expect(importer.import).not.toHaveBeenCalled();
        expect(page.projects).toEqual([project]);
    });

    it("reports import errors and resets the picker for a retry", async () => {
        importer.import.and.rejectWith(new Error('Unsupported project version.'));
        const input = { files: [new File(['{}'], 'test.json')], value: 'test.json' };
        await page.importFile({ target: input } as unknown as Event);
        expect(page.importError).toBe('Unsupported project version.');
        expect(page.importing).toBeFalse();
        expect(input.value).toBe('');
        expect(page.projects).toEqual([project]);
    });

    it("restores a deleted project through its lifecycle owner", () => {
        projects.undoDelete.and.returnValue(project);
        projects.list.and.returnValue([project]);
        page.undoDelete();
        expect(projects.undoDelete).toHaveBeenCalledTimes(1);
        expect(page.projects).toEqual([project]);
    });

    it("opens a card menu without opening the project and exports its editable source", () => {
        const trigger = document.createElement("button");
        const event = { stopPropagation: jasmine.createSpy("stopPropagation"), currentTarget: trigger } as unknown as MouseEvent;

        page.toggleProjectMenu(event, project);
        expect(page.openProjectMenuId).toBe(project.id);
        expect(event.stopPropagation).toHaveBeenCalled();

        page.exportProject(event, project);
        expect(exporter.download).toHaveBeenCalledOnceWith(project);
        expect(page.openProjectMenuId).toBeUndefined();
    });

    it("returns focus to the menu trigger when Escape closes the menu", () => {
        const trigger = document.createElement("button");
        const focus = spyOn(trigger, "focus");
        const pointer = { stopPropagation: jasmine.createSpy("stopPropagation"), currentTarget: trigger } as unknown as MouseEvent;
        const keyboard = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });

        page.toggleProjectMenu(pointer, project);
        page.closeProjectMenuFromKeyboard(keyboard);

        expect(page.openProjectMenuId).toBeUndefined();
        expect(focus).toHaveBeenCalled();
        expect(keyboard.defaultPrevented).toBeTrue();
    });

    it("deletes through ProjectService and refreshes the visible cards", () => {
        const event = { stopPropagation: jasmine.createSpy("stopPropagation") } as unknown as MouseEvent;
        page.deleteProject(event, project);
        expect(projects.remove).toHaveBeenCalledOnceWith(project.id);
        expect(page.projects).toEqual([]);
    });

    it("moves into the menu on keyboard activation and cycles items with arrows, Home, and End", () => {
        const menu = document.createElement("div");
        menu.id = `project-menu-${project.id}`;
        menu.innerHTML = '<button role="menuitem">Export</button><button role="menuitem">Delete</button>';
        document.body.appendChild(menu);
        const [exportItem, deleteItem] = Array.from(menu.querySelectorAll("button"));
        const key = (name: string) => {
            const event = new KeyboardEvent("keydown", { key: name, cancelable: true });
            page.handleMenuKey(event);
            return event;
        };
        try {
            const keyboardOpen = new MouseEvent("click", { detail: 0 });
            Object.defineProperty(keyboardOpen, "currentTarget", { value: document.createElement("button") });
            page.toggleProjectMenu(keyboardOpen, project);
            expect(document.activeElement).toBe(exportItem);

            expect(key("ArrowDown").defaultPrevented).toBeTrue();
            expect(document.activeElement).toBe(deleteItem);
            key("ArrowDown");
            expect(document.activeElement).toBe(exportItem);
            key("End");
            expect(document.activeElement).toBe(deleteItem);
            key("Home");
            expect(document.activeElement).toBe(exportItem);
            key("ArrowUp");
            expect(document.activeElement).toBe(deleteItem);

            key("Tab");
            expect(page.openProjectMenuId).toBeUndefined();
        } finally {
            menu.remove();
        }
    });

    it("leaves focus alone when the menu is opened with a pointer", () => {
        const before = document.activeElement;
        const pointerOpen = new MouseEvent("click", { detail: 1 });
        Object.defineProperty(pointerOpen, "currentTarget", { value: document.createElement("button") });
        page.toggleProjectMenu(pointerOpen, project);
        expect(page.openProjectMenuId).toBe(project.id);
        expect(document.activeElement).toBe(before);
    });
});
