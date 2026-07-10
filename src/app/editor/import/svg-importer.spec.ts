import nativeFixture from "./fixtures/native-elements.json";
import unsafeFixture from "./fixtures/unsafe-and-opaque.json";
import malformedFixture from "./fixtures/malformed.json";
import { GroupSave } from "../objects/elements/group.object";
import { PathSave } from "../objects/elements/path.object";
import { SVGImporterService, SVGImportError } from "./svg-importer.service";
import { parseSVGPathData, SVGPathParseError } from "./svg-path-parser";
import { sanitizeSVGText, SVGParseError } from "./svg-sanitizer";

describe("SVG path ingestion", () => {
    let id = 0;
    const createId = (prefix: string) => `${prefix}-${++id}`;

    beforeEach(() => { id = 0; });

    it("normalizes relative, shorthand, quadratic, arc, close, and multiple subpaths", () => {
        const contours = parseSVGPathData(
            "M0 0 l10 0 h10 v10 C25 15 30 15 35 10 s10 -5 15 0 Q55 20 60 10 t10 0 A10 6 15 0 1 90 10 z M100 0 L110 10",
            createId,
        );

        expect(contours.length).toBe(2);
        expect(contours[0].closed).toBeTrue();
        expect(contours[1].closed).toBeFalse();
        expect(contours[0].lines.some((line) => line.type === "bezier")).toBeTrue();
        expect(contours[0].lines[0].points[1]).toBe(contours[0].lines[1].points[0]);
        expect(contours[0].lines.filter((line) => line.type === "bezier").length).toBeGreaterThan(5);
    });

    it("rejects invalid path syntax with a useful error", () => {
        expect(() => parseSVGPathData("M 0 0 L", createId)).toThrowError(SVGPathParseError, /missing parameters/);
        expect(() => parseSVGPathData("M0 0 A 10 10 0 2 0 20 20", createId)).toThrowError(SVGPathParseError, /flags/);
    });
});

describe("SVG sanitizer", () => {
    it("removes active content, event attributes, stylesheets, and external resources", () => {
        const result = sanitizeSVGText(unsafeFixture.source);

        expect(result.removedCount).toBeGreaterThan(5);
        expect(result.markup).not.toContain("<script");
        expect(result.markup).not.toContain("foreignObject");
        expect(result.markup).not.toContain("onclick");
        expect(result.markup).not.toContain("onload");
        expect(result.markup).not.toContain("evil.example");
        expect(result.markup).toContain("linearGradient");
    });

    it("rejects malformed XML and non-SVG roots", () => {
        expect(() => sanitizeSVGText("<svg xmlns=\"http://www.w3.org/2000/svg\"><path></svg"))
            .toThrowError(SVGParseError);
        expect(() => sanitizeSVGText("<html xmlns=\"http://www.w3.org/1999/xhtml\"></html>"))
            .toThrowError(SVGParseError, /root element/);
    });
});

describe("SVGImporterService", () => {
    const importer = new SVGImporterService();

    it("imports native artwork families and preserves document geometry", () => {
        const result = importer.import(nativeFixture.source, { name: nativeFixture.name });
        const group = result.document.elements[0] as GroupSave;
        const commandPath = group.elements.find((element) => element.id === "commands") as PathSave;

        expect(result.document.name).toBe("native-elements");
        expect(result.document.width).toBe(240);
        expect(result.document.height).toBe(160);
        expect(result.nativeElementCount).toBe(9);
        expect(result.preservedNodeCount).toBe(0);
        expect(group.type).toBe("group");
        expect(group.transform?.translateX).toBeCloseTo(10, 5);
        expect(group.elements.map((element) => element.type)).toEqual([
            "shape", "shape", "shape", "path", "path", "path", "text", "path",
        ]);
        expect(commandPath.contours?.length).toBe(2);
        expect(commandPath.contours?.[0].closed).toBeTrue();
    });

    it("preserves safe unsupported source while discarding unsafe behavior", () => {
        const result = importer.import(unsafeFixture.source, { name: unsafeFixture.name });

        expect(result.nativeElementCount).toBe(1);
        expect(result.preservedNodeCount).toBe(3);
        expect(result.removedUnsafeCount).toBeGreaterThan(5);
        expect(result.document.importedSourceNodes?.map((node) => node.tagName)).toEqual(["defs", "image", "path"]);
        const preserved = result.document.importedSourceNodes?.map((node) => node.markup).join(" ") ?? "";
        expect(preserved).toContain("linearGradient");
        expect(preserved).not.toContain("onclick");
        expect(preserved).not.toContain("evil.example");
    });

    it("preserves a supported element as opaque when its geometry cannot be ingested", () => {
        const result = importer.import(malformedFixture.source, { name: malformedFixture.name });

        expect(result.nativeElementCount).toBe(0);
        expect(result.preservedNodeCount).toBe(1);
        expect(result.warnings.join(" ")).toContain("missing parameters");
    });

    it("throws a user-facing import error for invalid SVG XML", () => {
        expect(() => importer.import("not svg"))
            .toThrowError(SVGImportError);
    });
});
