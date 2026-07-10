import { Component, OnInit } from "@angular/core";
import { NgFor, NgIf, DatePipe } from "@angular/common";
import { Router } from "@angular/router";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { ProjectRecord, ProjectService } from "../_services/project.service";
import { SVGImporterService } from "../editor/import/svg-importer.service";

@Component({
    standalone: true,
    imports: [NgFor, NgIf, DatePipe, FaIconComponent],
    templateUrl: 'home.page.html',
    styleUrls: ['home.page.scss']
})
export class HomePage implements OnInit {
    projects: ProjectRecord[] = [];
    importing = false;
    importMessage?: string;
    importError?: string;

    constructor(
        private projectService: ProjectService,
        private svgImporter: SVGImporterService,
        private router: Router,
    ) {}

    ngOnInit() {
        this.projects = this.projectService.list();
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
        if(file.size > 10 * 1024 * 1024) {
            this.importError = 'SVG files must be smaller than 10 MB.';
            return;
        }

        this.importing = true;
        try {
            const result = this.svgImporter.import(await file.text(), { name: file.name });
            this.projectService.upsert(result.document, result.sanitizedMarkup);
            this.projects = this.projectService.list();
            const details = [
                `${result.nativeElementCount} editable element${result.nativeElementCount === 1 ? '' : 's'}`,
                `${result.preservedNodeCount} preserved source node${result.preservedNodeCount === 1 ? '' : 's'}`,
                `${result.removedUnsafeCount} unsafe item${result.removedUnsafeCount === 1 ? '' : 's'} removed`,
            ];
            this.importMessage = `Imported “${result.document.name}”: ${details.join(', ')}.`;
        } catch(error) {
            this.importError = error instanceof Error ? error.message : 'Unable to import this SVG.';
        } finally {
            this.importing = false;
        }
    }

    openProject(project: ProjectRecord) {
        this.router.navigate(['/editor'], { queryParams: { id: project.id } });
    }

    deleteProject(event: MouseEvent, project: ProjectRecord) {
        event.stopPropagation();
        this.projectService.remove(project.id);
        this.projects = this.projectService.list();
    }

    thumbnailUrl(project: ProjectRecord): string {
        return `data:image/svg+xml,${encodeURIComponent(project.thumbnail)}`;
    }
}
