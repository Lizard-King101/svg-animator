import { Directive, ElementRef, Input, OnDestroy } from "@angular/core";
import { sanitizeSVGFragment } from "src/app/editor/import/svg-sanitizer";

/** Mounts already-preserved SVG source without passing it through HTML parsing. */
@Directive({
    standalone: true,
    selector: "[importedSvgSource]",
})
export class ImportedSVGSourceDirective implements OnDestroy {
    constructor(private host: ElementRef<SVGGElement>) {}

    @Input()
    set importedSvgSource(markup: string | null | undefined) {
        this.mount(markup ?? "");
    }

    ngOnDestroy(): void {
        this.host.nativeElement.replaceChildren();
    }

    private mount(markup: string): void {
        const host = this.host.nativeElement;
        host.replaceChildren();
        if(!markup.trim()) return;

        try {
            // DOMParser keeps SVG namespaces intact. Re-sanitizing here makes this
            // boundary safe even if a stored project predates import sanitization.
            const sanitized = sanitizeSVGFragment(markup);
            const fragment = host.ownerDocument.createDocumentFragment();
            Array.from(sanitized.root.childNodes).forEach((node) => {
                fragment.appendChild(host.ownerDocument.importNode(node, true));
            });
            host.appendChild(fragment);
        } catch {
            // Invalid preserved markup must not prevent the editable document from rendering.
        }
    }
}
