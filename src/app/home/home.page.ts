import { Component, OnInit } from "@angular/core";
import { NgFor, NgIf, DatePipe } from "@angular/common";
import { Router } from "@angular/router";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { ProjectRecord, ProjectService } from "../_services/project.service";

@Component({
    standalone: true,
    imports: [NgFor, NgIf, DatePipe, FaIconComponent],
    templateUrl: 'home.page.html',
    styleUrls: ['home.page.scss']
})
export class HomePage implements OnInit {
    projects: ProjectRecord[] = [];

    constructor(
        private projectService: ProjectService,
        private router: Router,
    ) {}

    ngOnInit() {
        this.projects = this.projectService.list();
    }

    newProject() {
        this.router.navigate(['/editor']);
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
