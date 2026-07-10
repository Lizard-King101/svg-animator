import { Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ImportedSVGSourceDirective } from "./imported-svg-source.directive";

@Component({
    standalone: true,
    imports: [ImportedSVGSourceDirective],
    template: `<svg xmlns="http://www.w3.org/2000/svg"><g [importedSvgSource]="markup"></g></svg>`,
})
class ImportedSVGSourceHost {
    markup = "";
}

describe("ImportedSVGSourceDirective", () => {
    let fixture: ComponentFixture<ImportedSVGSourceHost>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [ImportedSVGSourceHost] }).compileComponents();
        fixture = TestBed.createComponent(ImportedSVGSourceHost);
    });

    it("mounts clip-path definitions and references as SVG elements", () => {
        fixture.componentInstance.markup = `
            <defs xmlns="http://www.w3.org/2000/svg">
                <rect id="clip-shape" width="40" height="40"/>
                <clipPath id="clip-union"><use href="#clip-shape"/></clipPath>
            </defs>
            <rect xmlns="http://www.w3.org/2000/svg" width="80" height="80" clip-path="url(#clip-union)"/>
        `;
        fixture.detectChanges();

        const root = fixture.nativeElement as HTMLElement;
        const clipPath = root.querySelector("clipPath#clip-union");
        const use = clipPath?.querySelector("use");
        const clippedRect = root.querySelector('rect[clip-path="url(#clip-union)"]');

        expect(clipPath?.namespaceURI).toBe("http://www.w3.org/2000/svg");
        expect(use?.getAttribute("href")).toBe("#clip-shape");
        expect(clippedRect).not.toBeNull();
    });

    it("sanitizes persisted source again before mounting it", () => {
        fixture.componentInstance.markup = `
            <script xmlns="http://www.w3.org/2000/svg">alert(1)</script>
            <rect xmlns="http://www.w3.org/2000/svg" width="10" height="10" onclick="alert(1)"/>
        `;
        fixture.detectChanges();

        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector("script")).toBeNull();
        expect(root.querySelector("rect")?.hasAttribute("onclick")).toBeFalse();
    });
});
