import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { FaIconLibrary } from "@fortawesome/angular-fontawesome";
import { faDownload, faFileImport, faHouse, faMagnet, faPlus, faRotateLeft, faRotateRight, faTimes, faRightLeft, faImage } from "@fortawesome/free-solid-svg-icons";
import { AnimationPlaybackService } from "../../_services/animation-playback.service";
import { CurrentDocumentSVGImportService } from "../../_services/current-document-svg-import.service";
import { DocumentMutationService } from "../../_services/document-mutation.service";
import { EditorPreferencesService } from "../../_services/editor-preferences.service";
import { EditorService } from "../../_services/editor.service";
import { EditorUiStateService } from "../../_services/editor-ui-state.service";
import { ReferenceImageService } from "../../_services/reference-image.service";
import { SelectionArrangementService } from "../../_services/selection-arrangement.service";
import { EditorHeaderComponent } from "./editor-header.component";

describe("EditorHeaderComponent SVG import", () => {
    it("imports the selected SVG into the active project and reports the result", async () => {
        const importSVG = jasmine.createSpy("import").and.returnValue({
            layer: { name: "Icon" },
            nativeElementCount: 3,
            preservedNodeCount: 1,
            removedUnsafeCount: 2,
        });
        const header = component(importSVG);

        await header.importSVG(fileEvent("icon.svg", 128, "<svg/>"));

        expect(importSVG).toHaveBeenCalledOnceWith("<svg/>", "icon.svg");
        expect(header.importMessage).toContain("Imported “Icon” as a layer group");
        expect(header.importMessage).toContain("3 editable elements");
        expect(header.importError).toBeUndefined();
        expect(header.importing).toBeFalse();
    });

    it("rejects an oversized file before reading or importing it", async () => {
        const importSVG = jasmine.createSpy("import");
        const header = component(importSVG);
        const event = fileEvent("huge.svg", 10 * 1024 * 1024 + 1, "");
        const file = (event.target as HTMLInputElement).files![0] as File & { text: jasmine.Spy };

        await header.importSVG(event);

        expect(file.text).not.toHaveBeenCalled();
        expect(importSVG).not.toHaveBeenCalled();
        expect(header.importError).toContain("smaller than 10 MB");
    });
});

function component(importSVG: jasmine.Spy): EditorHeaderComponent {
    return new EditorHeaderComponent(
        { selectedSVG: {} } as any,
        {} as any,
        {} as any,
        {} as any,
        { import: importSVG } as any,
    );
}

function fileEvent(name: string, size: number, contents: string): Event {
    const file = { name, size, text: jasmine.createSpy("text").and.resolveTo(contents) } as unknown as File;
    const input = { files: [file], value: name } as unknown as HTMLInputElement;
    return { target: input } as unknown as Event;
}

describe("EditorHeaderComponent tabs", () => {
    afterEach(() => TestBed.resetTestingModule());

    async function setup() {
        const svgs = ["a", "b", "c"].map((id) => ({ id, name: `Project ${id.toUpperCase()}` }));
        const editor = {
            svgs,
            selectedSVG: svgs[0],
            activeTool: undefined as { usesDrawingPaint: boolean } | undefined,
            selectedElements: [] as unknown[],
            selectSVG: jasmine.createSpy("selectSVG").and.callFake((id: string) => editor.selectedSVG = svgs.find((svg) => svg.id === id)!),
            closeSVG: jasmine.createSpy("closeSVG"),
        };
        const animation = { mode: "edit" as "edit" | "animate", pause: () => {}, restorePreview: () => {}, seek: () => {}, setMode: () => {} };
        await TestBed.configureTestingModule({
            imports: [EditorHeaderComponent],
            providers: [
                provideRouter([]),
                { provide: EditorService, useValue: editor },
                { provide: AnimationPlaybackService, useValue: animation },
                { provide: DocumentMutationService, useValue: { resetBaseline: () => {}, undo: () => {}, redo: () => {} } },
                { provide: EditorUiStateService, useValue: { openDialog: () => {} } },
                { provide: CurrentDocumentSVGImportService, useValue: {} },
                { provide: ReferenceImageService, useValue: { panelOpen: false } },
                { provide: SelectionArrangementService, useValue: { count: 2, available: true, effectiveReference: "selection" } },
                { provide: EditorPreferencesService, useValue: {
                    objectSnapping: true, setObjectSnapping: () => {},
                    drawingPaint: { fill: "#2dd4bf", stroke: "#2dd4bf", strokeWidth: 2 }, setDrawingPaint: () => {},
                } },
            ],
        }).compileComponents();
        TestBed.inject(FaIconLibrary).addIcons(faHouse, faPlus, faFileImport, faRotateLeft, faRotateRight, faMagnet, faDownload, faTimes, faRightLeft, faImage);
        const fixture = TestBed.createComponent(EditorHeaderComponent);
        fixture.autoDetectChanges();
        document.body.appendChild(fixture.nativeElement);
        const tabs = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll("[role=tab]"));
        return { fixture, editor, animation, tabs };
    }

    function press(target: HTMLElement, key: string): KeyboardEvent {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event;
    }

    it("exposes a roving tablist with labelled close buttons", async () => {
        const { tabs, fixture } = await setup();
        expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
        expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
        expect(tabs()[1].querySelector("button")?.getAttribute("aria-label")).toBe("Close Project B");
        expect(fixture.nativeElement.querySelector(".mode-toggle .active")?.getAttribute("aria-pressed")).toBe("true");
        fixture.nativeElement.remove();
    });

    it("moves selection and focus with arrow, Home, and End keys and consumes them", async () => {
        const { tabs, editor, fixture } = await setup();
        tabs()[0].focus();

        expect(press(tabs()[0], "ArrowRight").defaultPrevented).toBeTrue();
        expect(editor.selectedSVG.id).toBe("b");
        expect(document.activeElement).toBe(tabs()[1]);

        press(tabs()[1], "End");
        expect(editor.selectedSVG.id).toBe("c");
        press(tabs()[2], "ArrowRight");
        expect(editor.selectedSVG.id).toBe("a");
        press(tabs()[0], "ArrowLeft");
        expect(editor.selectedSVG.id).toBe("c");
        press(tabs()[2], "Home");
        expect(editor.selectedSVG.id).toBe("a");
        expect(document.activeElement).toBe(tabs()[0]);

        expect(press(tabs()[0], "Delete").defaultPrevented).toBeFalse();
        expect(editor.closeSVG).not.toHaveBeenCalled();
        fixture.nativeElement.remove();
    });

    it("shows new-artwork defaults only while a drawing tool is active", async () => {
        const { fixture, editor } = await setup();
        const defaults = () => fixture.nativeElement.querySelector("app-drawing-colors");
        expect(defaults()).toBeNull();
        editor.activeTool = { usesDrawingPaint: false }; fixture.detectChanges();
        expect(defaults()).toBeNull();
        editor.activeTool = { usesDrawingPaint: true }; fixture.detectChanges();
        expect(defaults()?.querySelector('[aria-label="New artwork stroke width"]')).toBeTruthy();
        fixture.nativeElement.remove();
    });

    it("switches the contextual group between drawing defaults and arrangement", async () => {
        const { fixture, editor, animation } = await setup();
        const present = (selector: string) => !!fixture.nativeElement.querySelector(selector);
        expect(present("app-reference-panel")).toBeTrue();
        expect(present("app-selection-actions")).toBeFalse();
        editor.selectedElements = [{}]; fixture.detectChanges();
        expect(present("app-selection-actions")).toBeTrue();
        expect(present("app-drawing-colors")).toBeFalse();
        editor.activeTool = { usesDrawingPaint: true }; fixture.detectChanges();
        expect(present("app-drawing-colors")).toBeTrue();
        expect(present("app-selection-actions")).toBeFalse();
        editor.activeTool = undefined; animation.mode = "animate"; fixture.detectChanges();
        expect(present("app-selection-actions")).toBeFalse();
        expect(present("app-reference-panel")).toBeFalse();
        fixture.nativeElement.remove();
    });
});
