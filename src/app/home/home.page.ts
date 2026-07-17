import { Component, HostListener, OnInit } from "@angular/core";
import { NgFor, NgIf, DatePipe } from "@angular/common";
import { Router } from "@angular/router";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { ProjectRecord, ProjectService } from "../_services/project.service";
import { ProjectExportService } from "../_services/project-export.service";
import { MAX_SVG_IMPORT_BYTES, SVGImporterService } from "../editor/import/svg-importer.service";

@Component({
    standalone: true,
    imports: [NgFor, NgIf, DatePipe, FaIconComponent],
    templateUrl: 'home.page.html',
    styleUrls: ['home.page.scss']
})
export class HomePage implements OnInit {
    projects: ProjectRecord[] = [];
    importing = false;
    loading = true;
    importMessage?: string;
    importError?: string;
    openProjectMenuId?: string;
    private projectMenuTrigger?: HTMLElement;

    constructor(
        public projectService: ProjectService,
        private projectExporter: ProjectExportService,
        private svgImporter: SVGImporterService,
        private router: Router,
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

    async importSVG(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if(!file) return;

        this.importError = undefined;
        this.importMessage = undefined;
        if(file.size > MAX_SVG_IMPORT_BYTES) {
            this.importError = 'SVG files must be smaller than 10 MB.';
            return;
        }

        this.importing = true;
        try {
            const result = this.svgImporter.import(await file.text(), { name: file.name });
            this.projectService.upsert(result.document, result.sanitizedMarkup);
            this.projects = await this.projectService.listAsync();
            const details = [
                `${result.nativeElementCount} editable element${result.nativeElementCount === 1 ? '' : 's'}`,
                `${result.preservedNodeCount} non-editable preserved node${result.preservedNodeCount === 1 ? '' : 's'}`,
                `${result.removedUnsafeCount} unsafe item${result.removedUnsafeCount === 1 ? '' : 's'} removed`,
            ];
            const quality = result.editability === "native" ? "Fully editable import" : "Partial import";
            this.importMessage = `${quality} “${result.document.name}”: ${details.join(', ')}.`;
        } catch(error) {
            this.importError = error instanceof Error ? error.message : 'Unable to import this SVG.';
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
