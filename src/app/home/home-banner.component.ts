import { Component, ElementRef, EventEmitter, OnDestroy, OnInit, Output, ViewChild } from "@angular/core";
import { Router } from "@angular/router";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { createPlayer, RuntimePlayer } from "../../../packages/runtime/src";
import { ElementFactory } from "../_services/element-factory.service";
import { WELCOME_BANNER_PROJECT } from "../_services/preloaded-projects";
import { ProjectService } from "../_services/project.service";
import { compileRuntimeAnimation } from "../editor/animation/runtime-animation-compiler";
import { buildSVGMarkup } from "../editor/svg-markup";

/** A composed frame shown instead of playback when reduced motion is preferred. */
const STILL_TIME = 3.2;

/**
 * Home hero. Plays the bundled Welcome Banner project with the same runtime that exported
 * animations use, and opens that project in the editor on request.
 */
@Component({
    selector: "app-home-banner",
    standalone: true,
    imports: [FaIconComponent],
    templateUrl: "home-banner.component.html",
    styleUrl: "home-banner.component.scss",
})
export class HomeBannerComponent implements OnInit, OnDestroy {
    @Output() readonly newProject = new EventEmitter<void>();
    playing = false;
    @ViewChild("stage", { static: true }) private stage!: ElementRef<HTMLElement>;
    private player?: RuntimePlayer;
    private visibility?: IntersectionObserver;
    private pausedByUser = false;

    constructor(private elements: ElementFactory, private projects: ProjectService, private router: Router) {}

    /** Mounts before the first check so the initial play/pause label is stable. */
    ngOnInit(): void {
        try {
            const svg = this.elements.restoreDocument(structuredClone(WELCOME_BANNER_PROJECT.svgData));
            const compiled = compileRuntimeAnimation(svg.save());
            // Generated from bundled project data by the same builder as exports; not user input.
            this.stage.nativeElement.innerHTML = buildSVGMarkup(svg, { runtime: { signature: compiled.bundle.artwork.signature } });
            const root = this.stage.nativeElement.querySelector("svg");
            if(!root) return;
            root.setAttribute("aria-hidden", "true");
            Object.assign(root.style, { display: "block", width: "100%", height: "auto" });
            this.player = createPlayer(root, compiled.bundle).setLoop(true);
        } catch {
            this.stage.nativeElement.replaceChildren();
            return;
        }
        if(prefersReducedMotion()) {
            this.player.seek(STILL_TIME);
            this.pausedByUser = true;
        } else {
            this.play();
        }
        // Pause while scrolled out of view so the loop never costs frames off-screen.
        if(typeof IntersectionObserver !== "undefined") {
            this.visibility = new IntersectionObserver(([entry]) => {
                if(this.pausedByUser) return;
                if(entry.isIntersecting) this.play(); else this.pause();
            });
            this.visibility.observe(this.stage.nativeElement);
        }
    }

    ngOnDestroy(): void {
        this.visibility?.disconnect();
        this.player?.destroy();
    }

    togglePlayback(): void {
        if(this.playing) {
            this.pausedByUser = true;
            this.pause();
        } else {
            this.pausedByUser = false;
            this.play();
        }
    }

    /** Opens the gallery copy of the banner, restoring it first if the gallery lacks it. */
    async openBanner(): Promise<void> {
        await this.projects.ready;
        const project = this.projects.ensurePreloaded(WELCOME_BANNER_PROJECT);
        await this.router.navigate(["/editor"], { queryParams: { id: project.id } });
    }

    private play(): void {
        if(!this.player) return;
        this.player.play();
        this.playing = true;
    }

    private pause(): void {
        if(!this.player) return;
        this.player.pause();
        this.playing = false;
    }
}

function prefersReducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
