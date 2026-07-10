import { SVGImporterService } from "./svg-importer.service";
import { EditorService } from "../../_services/editor.service";
import { SVG } from "../objects/svg.object";
import { buildSVGMarkup } from "../svg-markup";

const SAMPLES: SampleExpectation[] = [
    { file: "alphachannel.svg", minNative: 3 },
    { file: "bzr.svg", minNative: 4 },
    { file: "clippath.svg", minNative: 2, minPreserved: 4 },
    { file: "samples-svgrepo-com.svg", minNative: 14 },
    { file: "snake.svg", minNative: 15, minRemoved: 2 },
    { file: "photos.svg", minNative: 1, minRemoved: 2 },
    { file: "Steps.svg", minNative: 32, minPreserved: 1, minRemoved: 8 },
    { file: "car_stress_test.svg", minNative: 100, minPreserved: 250 },
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
            expect(result.preservedNodeCount).withContext(sample.file).toBeGreaterThanOrEqual(sample.minPreserved ?? 0);
            expect(result.removedUnsafeCount).withContext(sample.file).toBeGreaterThanOrEqual(sample.minRemoved ?? 0);

            const restored = SVG.fromSave(result.document, editorDouble());
            expect(restored.importedSourceNodes).withContext(sample.file).toEqual(result.document.importedSourceNodes ?? []);
            const exported = buildSVGMarkup(restored);
            expect(exported).withContext(sample.file).not.toMatch(/<script\b|\son[a-z]+\s*=/i);
            if(result.preservedNodeCount > 0) {
                expect(exported).withContext(sample.file).toContain(result.document.importedSourceNodes![0].tagName);
            }
        });
    }
});

interface SampleExpectation {
    file: string;
    minNative: number;
    minRemoved?: number;
    minPreserved?: number;
}

function editorDouble(): EditorService {
    let id = 0;
    return {
        get ID() { return `test-${++id}`; },
        removeElement: () => undefined,
    } as unknown as EditorService;
}
