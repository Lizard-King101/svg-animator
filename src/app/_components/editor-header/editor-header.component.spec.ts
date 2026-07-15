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
