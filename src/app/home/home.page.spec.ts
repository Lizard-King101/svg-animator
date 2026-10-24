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
        projects = jasmine.createSpyObj<ProjectService>("ProjectService", ["list", "remove", "undoDelete", "rename", "duplicate"]);
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

    describe("gallery organisation and actions", () => {
        const make = (id: string, name: string, createdAt: number, updatedAt: number): ProjectRecord => ({
            id, name, thumbnail: "<svg/>", createdAt, updatedAt,
            svgData: { id, name, width: 10, height: 10, elements: [] },
        });
        const alpha = make("a", "Alpha 10", 1, 50);
        const beta = make("b", "beta", 3, 10);
        const gamma = make("c", "Alpha 9", 2, 30);

        beforeEach(() => {
            page.projects = [beta, alpha, gamma];
            try { localStorage.removeItem("svg-animator.home-sort"); } catch {}
        });
        afterEach(() => { try { localStorage.removeItem("svg-animator.home-sort"); } catch {} page.ngOnDestroy(); });

        it("filters by name and sorts by last edited, name (natural), or creation", () => {
            expect(page.visibleProjects.map((project) => project.id)).toEqual(["a", "c", "b"]);
            page.setSort("name");
            expect(page.visibleProjects.map((project) => project.id)).toEqual(["c", "a", "b"]);
            expect(localStorage.getItem("svg-animator.home-sort")).toBe("name");
            page.setSort("created");
            expect(page.visibleProjects.map((project) => project.id)).toEqual(["b", "c", "a"]);
            page.query = "  ALPHA ";
            expect(page.visibleProjects.map((project) => project.id)).toEqual(["c", "a"]);
            expect(page.projects.map((project) => project.id)).toEqual(["b", "a", "c"]);
        });

        it("renames on commit, ignores a second commit, and cancels without renaming", () => {
            const click = { stopPropagation: () => {} } as MouseEvent;
            page.startRename(click, alpha);
            expect(page.renamingId).toBe("a");
            page.commitRename(alpha, "Logo");
            page.commitRename(alpha, "Ignored");
            expect(projects.rename).toHaveBeenCalledOnceWith("a", "Logo");
            expect(page.renamingId).toBeUndefined();

            page.startRename(click, beta);
            page.cancelRename(new KeyboardEvent("keydown", { key: "Escape" }), beta);
            page.commitRename(beta, "Blurred after cancel");
            expect(projects.rename).toHaveBeenCalledTimes(1);
        });

        it("duplicates through ProjectService and refreshes the gallery", () => {
            projects.duplicate.and.returnValue(make("d", "Alpha 10 copy", 4, 60));
            projects.list.and.returnValue([alpha]);
            page.duplicateProject({ stopPropagation: () => {} } as MouseEvent, alpha);
            expect(projects.duplicate).toHaveBeenCalledOnceWith("a");
            expect(page.projects).toEqual([alpha]);
        });

        it("imports several files, counting successes and reporting the first failure", async () => {
            importer.import.and.callFake(async (file: File) => {
                if(file.name === "bad.svg") throw new Error("Not an SVG.");
                return `Imported ${file.name}.`;
            });
            projects.list.and.returnValue([alpha]);
            const files = ["one.svg", "bad.svg", "two.json"].map((name) => new File(["<svg/>"], name));
            await page.importFiles(files);
            expect(importer.import).toHaveBeenCalledTimes(3);
            expect(page.importMessage).toBe("Imported 2 of 3 files.");
            expect(page.importError).toBe("bad.svg: Not an SVG.");
            expect(page.projects).toEqual([alpha]);
        });

        it("shows the drop overlay only for file drags and imports dropped files", async () => {
            importer.import.and.resolveTo("Imported.");
            const transfer = new DataTransfer();
            transfer.items.add(new File(["<svg/>"], "drop.svg", { type: "image/svg+xml" }));
            const drag = (type: string) => new DragEvent(type, { dataTransfer: transfer, cancelable: true });

            page.handleDragEnter(new DragEvent("dragenter", { dataTransfer: new DataTransfer(), cancelable: true }));
            expect(page.dropActive).toBeFalse();
            const enter = drag("dragenter");
            page.handleDragEnter(enter);
            page.handleDragEnter(drag("dragenter"));
            page.handleDragLeave(drag("dragleave"));
            expect(page.dropActive).toBeTrue();
            expect(enter.defaultPrevented).toBeTrue();
            page.handleDragLeave(drag("dragleave"));
            expect(page.dropActive).toBeFalse();

            page.handleDragEnter(drag("dragenter"));
            const drop = drag("drop");
            await page.handleDrop(drop);
            expect(drop.defaultPrevented).toBeTrue();
            expect(page.dropActive).toBeFalse();
            expect(importer.import).toHaveBeenCalledTimes(1);
            expect(page.importMessage).toBe("Imported.");
        });
    });
});
