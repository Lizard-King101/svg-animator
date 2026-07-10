import { SVGImporterService } from "./svg-importer.service";
import { EditorService } from "../../_services/editor.service";
import { ElementSave, SVG } from "../objects/svg.object";
import { buildSVGMarkup } from "../svg-markup";
import { GradientPaintSave } from "../objects/paint.object";

const SAMPLES: SampleExpectation[] = [
    { file: "alphachannel.svg", minNative: 3 },
    { file: "bzr.svg", minNative: 4 },
    { file: "clippath.svg", minNative: 15, maxPreserved: 2 },
    { file: "samples-svgrepo-com.svg", minNative: 14 },
    { file: "snake.svg", minNative: 15, minRemoved: 2 },
    { file: "photos.svg", minNative: 1, minRemoved: 2 },
    { file: "Steps.svg", minNative: 32, maxPreserved: 1, minRemoved: 8 },
    { file: "car_stress_test.svg", minNative: 240, maxPreserved: 150 },
];

describe("real-world SVG import corpus", () => {
    const importer = new SVGImporterService();

    for(const sample of SAMPLES) {
        it(`imports ${sample.file} without active content`, async () => {
            const response = await fetch(`/svg-samples/${encodeURIComponent(sample.file)}`);
            expect(response.ok).withContext(`fixture ${sample.file} should be available`).toBeTrue();
            const result = importer.import(await response.text(), { name: sample.file });

            expect(result.document.width).withContext(sample.file).toBeGreaterThan(0);
            expect(result.document.height).withContext(sample.file).toBeGreaterThan(0);
            expect(result.sanitizedMarkup).withContext(sample.file).not.toMatch(/<script\b|\son[a-z]+\s*=/i);
            expect(result.nativeElementCount).withContext(sample.file).toBeGreaterThanOrEqual(sample.minNative);
            if(sample.maxPreserved != null) {
                expect(result.preservedNodeCount).withContext(sample.file).toBeLessThanOrEqual(sample.maxPreserved);
            }
            expect(result.removedUnsafeCount).withContext(sample.file).toBeGreaterThanOrEqual(sample.minRemoved ?? 0);

            const restored = SVG.fromSave(result.document, editorDouble());
            expect(restored.importedSourceNodes).withContext(sample.file).toEqual(result.document.importedSourceNodes ?? []);
            const exported = buildSVGMarkup(restored);
            expect(exported).withContext(sample.file).not.toMatch(/<script\b|\son[a-z]+\s*=/i);
            if(result.preservedNodeCount > 0) {
                expect(exported).withContext(sample.file).toContain(result.document.importedSourceNodes![0].tagName);
            }

            if(sample.file === "clippath.svg") {
                expect(result.document.importedSourceNodes?.map((node) => node.tagName)).toEqual(["defs", "rect"]);
                expect(countClippingGroups(result.document.elements)).toBeGreaterThanOrEqual(3);
            }
            if(sample.file === "car_stress_test.svg") {
                expect(countGradientPaints(result.document.elements)).toBeGreaterThanOrEqual(100);
                expect(exported).toContain("<linearGradient");
            }
        });
    }
});

interface SampleExpectation {
    file: string;
    minNative: number;
    minRemoved?: number;
    maxPreserved?: number;
}

function countGradientPaints(elements: ElementSave[]): number {
    return elements.reduce((count, element) => {
        const settings = element.type === "path" || element.type === "shape" ? element.settings : undefined;
        const paints = settings ? [settings.fill, settings.stroke].filter((paint) => {
            const type = typeof paint === "object" && paint ? (paint as Partial<GradientPaintSave>).type : undefined;
            return type === "linear-gradient" || type === "radial-gradient";
        }).length : 0;
        return count + paints + (element.type === "group" ? countGradientPaints(element.elements) : 0);
    }, 0);
}

function countClippingGroups(elements: ElementSave[]): number {
    return elements.reduce((count, element) => count
        + (element.type === "group" && element.clipElementId ? 1 : 0)
        + (element.type === "group" ? countClippingGroups(element.elements) : 0), 0);
}

function editorDouble(): EditorService {
    let id = 0;
    return {
        get ID() { return `test-${++id}`; },
        removeElement: () => undefined,
    } as unknown as EditorService;
}
