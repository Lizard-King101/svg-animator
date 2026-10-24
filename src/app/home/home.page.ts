import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from "@angular/core";
import { NgFor, NgIf } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { ProjectRecord, ProjectService } from "../_services/project.service";
import { ProjectExportService } from "../_services/project-export.service";
import { ProjectFileImportService } from "../_services/project-file-import.service";
import { ElementFactory } from "../_services/element-factory.service";
import { EditorService } from "../_services/editor.service";
import { formatEditedTime, formatFullTime } from "./relative-time";
import { HomeBannerComponent } from "./home-banner.component";

export type ProjectSort = "edited" | "name" | "created";
const SORT_STORAGE_KEY = "svg-animator.home-sort";
const SORTS: readonly ProjectSort[] = ["edited", "name", "created"];

@Component({
    standalone: true,
    imports: [NgFor, NgIf, FormsModule, FaIconComponent, RouterLink, HomeBannerComponent],
    templateUrl: 'home.page.html',
    styleUrls: ['home.page.scss'],
    providers: [EditorService, ElementFactory, ProjectFileImportService],
})
export class HomePage implements OnInit, OnDestroy {
    projects: ProjectRecord[] = [];
    importing = false;
    loading = true;
    importMessage?: string;
    importError?: string;
    openProjectMenuId?: string;
    renamingId?: string;
    query = "";
    sort: ProjectSort = readSort();
    /** Whether files are being dragged over the page. */
    dropActive = false;
    /** Clock for relative "edited" labels, refreshed each minute. */
    now = Date.now();
    private projectMenuTrigger?: HTMLElement;
    private dragDepth = 0;
    private readonly clock = setInterval(() => this.now = Date.now(), 60_000);
    @ViewChild('undoDeleteButton') private undoDeleteButton?: ElementRef<HTMLButtonElement>;
    @ViewChildren('projectAction') private projectActions?: QueryList<ElementRef<HTMLButtonElement>>;

    constructor(
        public projectService: ProjectService,
        private projectExporter: ProjectExportService,
        private fileImporter: ProjectFileImportService,
        private router: Router,
        private changes: ChangeDetectorRef,
    ) {}

    async ngOnInit() {
        try {
            this.projects = await this.projectService.listAsync();
        } catch(error) {
            this.importError = error instanceof Error ? error.message : 'Unable to load projects.';
        } finally {
            this.loading = false;
        }
    }

    ngOnDestroy(): void { clearInterval(this.clock); }

    /** Projects matching the search, in the chosen order. */
    get visibleProjects(): ProjectRecord[] {
        const query = this.query.trim().toLowerCase();
        const matches = query ? this.projects.filter((project) => project.name.toLowerCase().includes(query)) : [...this.projects];
        const byName = (a: ProjectRecord, b: ProjectRecord) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        return matches.sort(this.sort === "name" ? byName
            : this.sort === "created" ? (a, b) => b.createdAt - a.createdAt || byName(a, b)
            : (a, b) => b.updatedAt - a.updatedAt || byName(a, b));
    }

    setSort(sort: ProjectSort): void {
        this.sort = sort;
        try { localStorage.setItem(SORT_STORAGE_KEY, sort); } catch {}
    }

    trackProject(_index: number, project: ProjectRecord): string { return project.id; }

    edited(project: ProjectRecord): string { return formatEditedTime(project.updatedAt, this.now); }

    fullTime(project: ProjectRecord): string {
        return `Edited ${formatFullTime(project.updatedAt)} · Created ${formatFullTime(project.createdAt)}`;
    }

    newProject() {
        this.router.navigate(['/editor']);
    }

    async importFile(event: Event) {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = '';
        await this.importFiles(files);
    }

    /** Imports files one at a time; a single file reports its own result, several report a count. */
    async importFiles(files: File[]): Promise<void> {
        if(!files.length || this.importing) return;
        this.importError = undefined;
        this.importMessage = undefined;
        this.importing = true;
        let imported = 0;
        let lastMessage = '';
        try {
            for(const file of files) {
                try {
                    lastMessage = await this.fileImporter.import(file);
                    imported++;
                } catch(error) {
                    const reason = error instanceof Error ? error.message : 'Unable to import this file.';
                    this.importError ??= files.length > 1 ? `${file.name}: ${reason}` : reason;
                }
            }
            if(imported) {
                this.importMessage = files.length === 1 ? lastMessage : `Imported ${imported} of ${files.length} files.`;
                this.projects = this.projectService.list();
            }
        } finally {
            this.importing = false;
        }
    }

    @HostListener('dragenter', ['$event']) handleDragEnter(event: DragEvent): void {
        if(!carriesFiles(event)) return;
        event.preventDefault();
        this.dragDepth++;
        this.dropActive = true;
    }

    @HostListener('dragover', ['$event']) handleDragOver(event: DragEvent): void {
        if(!carriesFiles(event)) return;
        event.preventDefault();
        if(event.dataTransfer) event.dataTransfer.dropEffect = this.importing ? 'none' : 'copy';
    }

    @HostListener('dragleave', ['$event']) handleDragLeave(event: DragEvent): void {
        if(!carriesFiles(event)) return;
        this.dragDepth = Math.max(0, this.dragDepth - 1);
        if(!this.dragDepth) this.dropActive = false;
    }

    @HostListener('drop', ['$event']) async handleDrop(event: DragEvent): Promise<void> {
        if(!carriesFiles(event)) return;
        event.preventDefault();
        this.dragDepth = 0;
        this.dropActive = false;
        await this.importFiles(Array.from(event.dataTransfer?.files ?? []));
    }

    toggleProjectMenu(event: MouseEvent, project: ProjectRecord): void {
        event.stopPropagation();
        const trigger = event.currentTarget as HTMLElement;
        if(this.openProjectMenuId === project.id) {
            this.closeProjectMenu();
            return;
        }
        this.openProjectMenuId = project.id;
        this.projectMenuTrigger = trigger;
        // Keyboard activation (detail 0) moves into the menu, as menu buttons do; pointer opens leave focus alone.
        if(event.detail === 0) {
            this.changes.detectChanges();
            this.menuItems()[0]?.focus();
        }
    }

    /** Arrow keys, Home, and End move between menu items; Tab leaves and closes the menu. */
    handleMenuKey(event: KeyboardEvent): void {
        if(event.key === "Tab") {
            this.closeProjectMenu();
            return;
        }
        const items = this.menuItems();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? index + 1
            : event.key === "ArrowUp" ? (index < 0 ? -1 : index - 1)
            : event.key === "Home" ? 0
            : event.key === "End" ? -1
            : undefined;
        if(next === undefined || !items.length) return;
        event.preventDefault();
        items[(next + items.length) % items.length].focus();
    }

    startRename(event: MouseEvent, project: ProjectRecord): void {
        event.stopPropagation();
        this.closeProjectMenu();
        this.renamingId = project.id;
        this.changes.detectChanges();
        const input = document.getElementById(`project-rename-${project.id}`) as HTMLInputElement | null;
        input?.focus();
        input?.select();
    }

    /** Enter and blur commit; blank or unchanged names keep the current name. */
    commitRename(project: ProjectRecord, name: string): void {
        if(this.renamingId !== project.id) return;
        this.renamingId = undefined;
        this.projectService.rename(project.id, name);
        this.projects = this.projectService.list();
        this.focusCard(project.id);
    }

    cancelRename(event: Event, project: ProjectRecord): void {
        event.preventDefault();
        event.stopPropagation();
        if(this.renamingId !== project.id) return;
        this.renamingId = undefined;
        this.focusCard(project.id);
    }

    duplicateProject(event: MouseEvent, project: ProjectRecord): void {
        event.stopPropagation();
        this.closeProjectMenu();
        const copy = this.projectService.duplicate(project.id);
        this.projects = this.projectService.list();
        if(copy) this.focusCard(copy.id);
    }

    exportProject(event: MouseEvent, project: ProjectRecord): void {
        event.stopPropagation();
        this.projectExporter.download(project);
        this.closeProjectMenu();
    }

    deleteProject(event: MouseEvent, project: ProjectRecord) {
        event.stopPropagation();
        this.closeProjectMenu();
        this.projectService.remove(project.id);
        this.projects = this.projectService.list();
        this.changes.detectChanges();
        this.undoDeleteButton?.nativeElement.focus();
    }

    undoDelete(): void {
        const restored = this.projectService.undoDelete();
        this.projects = this.projectService.list();
        this.changes.detectChanges();
        this.projectActions?.find((action) => action.nativeElement.id === `project-actions-${restored?.id}`)?.nativeElement.focus();
    }

    @HostListener("document:click")
    closeProjectMenu(): void {
        this.openProjectMenuId = undefined;
        this.projectMenuTrigger = undefined;
    }

    @HostListener("document:keydown.escape", ["$event"])
    closeProjectMenuFromKeyboard(event: Event): void {
        if(!this.openProjectMenuId) return;
        const trigger = this.projectMenuTrigger;
        this.closeProjectMenu();
        trigger?.focus();
        event.preventDefault();
    }

    thumbnailUrl(project: ProjectRecord): string {
        return `data:image/svg+xml,${encodeURIComponent(project.thumbnail)}`;
    }

    private focusCard(id: string): void {
        this.changes.detectChanges();
        document.getElementById(`project-open-${id}`)?.focus();
    }

    private menuItems(): HTMLButtonElement[] {
        const menu = this.openProjectMenuId ? document.getElementById(`project-menu-${this.openProjectMenuId}`) : null;
        return Array.from(menu?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    }
}

function carriesFiles(event: DragEvent): boolean {
    return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files");
}

function readSort(): ProjectSort {
    try {
        const stored = localStorage.getItem(SORT_STORAGE_KEY);
        return SORTS.includes(stored as ProjectSort) ? stored as ProjectSort : "edited";
    } catch {
        return "edited";
    }
}
