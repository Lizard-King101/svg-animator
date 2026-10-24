import { TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { FaIconLibrary } from "@fortawesome/angular-fontawesome";
import { faPause, faPen, faPlay, faPlus } from "@fortawesome/free-solid-svg-icons";
import { EditorService } from "../_services/editor.service";
import { ElementFactory } from "../_services/element-factory.service";
import { WELCOME_BANNER_PROJECT } from "../_services/preloaded-projects";
import { ProjectService } from "../_services/project.service";
import { HomeBannerComponent } from "./home-banner.component";

describe("HomeBannerComponent", () => {
    afterEach(() => TestBed.resetTestingModule());

    async function create(reducedMotion = false) {
        spyOn(window, "matchMedia").and.callFake((query: string) => ({ matches: reducedMotion && query.includes("reduce") }) as MediaQueryList);
        const projects = { ready: Promise.resolve(), ensurePreloaded: jasmine.createSpy("ensurePreloaded").and.returnValue({ id: WELCOME_BANNER_PROJECT.id }) };
        const router = { navigate: jasmine.createSpy("navigate").and.resolveTo(true) };
        await TestBed.configureTestingModule({
            imports: [HomeBannerComponent],
            providers: [EditorService, ElementFactory, { provide: ProjectService, useValue: projects }, { provide: Router, useValue: router }],
        }).compileComponents();
        TestBed.inject(FaIconLibrary).addIcons(faPause, faPen, faPlay, faPlus);
        const fixture = TestBed.createComponent(HomeBannerComponent);
        fixture.detectChanges();
        return { fixture, projects, router, root: fixture.nativeElement as HTMLElement };
    }

    it("mounts the bundled banner with the runtime and plays it with a pause control", async () => {
        const { fixture, root } = await create();
        const svg = root.querySelector(".stage svg")!;
        expect(svg.getAttribute("data-svg-animator-signature")).toMatch(/^fnv1a32-/);
        expect(svg.getAttribute("aria-hidden")).toBe("true");
        const toggle = root.querySelector<HTMLButtonElement>(".playback")!;
        expect(toggle.getAttribute("aria-label")).toBe("Pause animation");
        toggle.click(); fixture.detectChanges();
        expect(toggle.getAttribute("aria-label")).toBe("Play animation");
        expect(fixture.componentInstance.playing).toBeFalse();
        fixture.destroy();
    });

    it("shows a still frame instead of playing when reduced motion is preferred", async () => {
        const { fixture, root } = await create(true);
        expect(fixture.componentInstance.playing).toBeFalse();
        expect(root.querySelector(".playback")?.getAttribute("aria-label")).toBe("Play animation");
        fixture.destroy();
    });

    it("opens the gallery copy of the banner, restoring it when needed", async () => {
        const { fixture, projects, router } = await create();
        await fixture.componentInstance.openBanner();
        expect(projects.ensurePreloaded).toHaveBeenCalledOnceWith(WELCOME_BANNER_PROJECT);
        expect(router.navigate).toHaveBeenCalledOnceWith(["/editor"], { queryParams: { id: WELCOME_BANNER_PROJECT.id } });
        fixture.destroy();
    });
});
