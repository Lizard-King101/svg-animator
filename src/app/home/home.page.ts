import { ChangeDetectorRef, Component, ElementRef, HostListener, OnInit, QueryList, ViewChild, ViewChildren } from "@angular/core";
import { NgFor, NgIf, DatePipe } from "@angular/common";
import { Router } from "@angular/router";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { ProjectRecord, ProjectService } from "../_services/project.service";
import { ProjectExportService } from "../_services/project-export.service";
import { ProjectFileImportService } from "../_services/project-file-import.service";
import { ElementFactory } from "../_services/element-factory.service";
import { EditorService } from "../_services/editor.service";

@Component({
    standalone: true,
    imports: [NgFor, NgIf, DatePipe, FaIconComponent],
    templateUrl: 'home.page.html',
    styleUrls: ['home.page.scss'],
    providers: [EditorService, ElementFactory, ProjectFileImportService],
})
export class HomePage implements OnInit {
    projects: ProjectRecord[] = [];
    importing = false;
    loading = true;
    importMessage?: string;
    importError?: string;
    openProjectMenuId?: string;
    private projectMenuTrigger?: HTMLElement;
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

    newProject() {
        this.router.navigate(['/editor']);
    }

    async importFile(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if(!file || this.importing) return;
        this.importError = undefined;
        this.importMessage = undefined;
        this.importing = true;
        try {
            this.importMessage = await this.fileImporter.import(file);
            this.projects = this.projectService.list();
        } catch(error) {
            this.importError = error instanceof Error ? error.message : 'Unable to import this file.';
        } finally {
            this.importing = false;
        }
    }

    openProject(project: ProjectRecord) {
        this.router.navigate(['/editor'], { queryParams: { id: project.id } });
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
}
