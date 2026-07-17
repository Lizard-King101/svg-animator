import { unzipSync, strFromU8 } from "fflate";
import { RuntimeExportService, sanitizeFilename } from "./runtime-export.service";
import { SVG, SVGSave } from "../editor/objects/svg.object";

describe("RuntimeExportService", () => {
    const save = (): SVGSave => ({
        id: "document", name: "Demo / unsafe", width: 120, height: 90,
        elements: [{
            type: "shape", id: "box", name: "Box", visible: true, locked: false, shapeType: "rectangle",
            position: { id: "position", x: 4, y: 8 },
            settings: { width: 20, height: 10, stroke_width: 1, stroke: "#000000", fill: "#abcdef", line_cap: null, line_join: null, stroke_alignment: "center", stroke_dasharray: [], stroke_dashoffset: 0, stroke_miterlimit: 4 },
        }],
        animation: { version: 2, duration: 1, loop: true, markers: [], variables: [], tracks: [{
            id: "move", targetId: "box", property: "transform.translateX", valueType: "number",
            keyframes: [{ id: "before", time: -1, value: -10 }, { id: "start", time: 0, value: 0 }, { id: "after", time: 2, value: 20 }],
        }] },
    });
    const restore = () => SVG.fromSave(save(), { ID: "generated" } as never);

    it("keeps Static SVG free of runtime hooks and scripts", async () => {
        const artifact = await new RuntimeExportService().build(restore(), { kind: "static-svg", bakeRoundedCorners: true });
        const markup = artifact.content as string;
        expect(markup).not.toContain("data-svg-animator");
        expect(markup).not.toContain("<script");
        expect(artifact.filename).toBe("Demo - unsafe.svg");
    });

    it("loads the editor webfont inside exported SVG documents", async () => {
        const input = save();
        input.elements.push({
            type: "text", id: "label", name: "Label", visible: true, locked: false,
            position: { id: "label-position", x: 10, y: 20 },
            settings: {
                content: "SVG Animator", text_align: "start", font_family: "'Plus Jakarta Sans'",
                font_size: 24, font_weight: "800", color: "#ffffff",
            },
        });
        const svg = SVG.fromSave(input, { ID: "generated" } as never);
        const artifact = await new RuntimeExportService().build(svg, { kind: "static-svg", bakeRoundedCorners: true });
        const markup = artifact.content as string;

        expect(markup).toContain('@import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap")');
        expect(markup.match(/fonts\.googleapis\.com/g)?.length).toBe(1);
        expect(new DOMParser().parseFromString(markup, "image/svg+xml").querySelector("parsererror")).toBeNull();
    });

    it("embeds inert JSON and the browser player in Animated SVG", async () => {
        spyOn(window, "fetch").and.resolveTo(new Response("var SVGAnimatorRuntime={bootstrapAnimatedSVG:function(){}}", { status: 200 }));
        const artifact = await new RuntimeExportService().build(restore(), { kind: "animated-svg", bakeRoundedCorners: true });
        const markup = artifact.content as string;
        expect(markup).toContain("data-svg-animator-signature");
        expect(markup).toContain('type="application/json"');
        expect(markup).toContain("bootstrapAnimatedSVG");
        const payload = /data-svg-animator-bundle="">([\s\S]*?)<\/script>/.exec(markup)![1];
        const bundle = JSON.parse(new DOMParser().parseFromString(`<x>${payload}</x>`, "application/xml").documentElement.textContent!);
        expect(bundle.animation.tracks[0].times).toEqual([-1, 0, 2]);
    });

    it("exports artwork and embedded animation data without duplicating the player", async () => {
        const artifact = await new RuntimeExportService().build(restore(), { kind: "embedded-animation-svg", bakeRoundedCorners: true });
        const markup = artifact.content as string;
        const document = new DOMParser().parseFromString(markup, "image/svg+xml");
        const scripts = document.querySelectorAll("script");

        expect(artifact.filename).toBe("Demo - unsafe-animation.svg");
        expect(document.querySelector("parsererror")).toBeNull();
        expect(document.documentElement.getAttribute("data-svg-animator-signature")).toBeTruthy();
        expect(scripts.length).toBe(1);
        expect(scripts[0].getAttribute("type")).toBe("application/json");
        expect(scripts[0].hasAttribute("data-svg-animator-bundle")).toBeTrue();
        expect(markup).not.toContain("SVGAnimatorRuntime");
        expect(markup).not.toContain("bootstrapAnimatedSVG");
        const bundle = JSON.parse(scripts[0].textContent!);
        expect(bundle.kind).toBe("svg-animator/runtime-bundle");
        expect(bundle.animation.tracks[0].times).toEqual([-1, 0, 2]);
    });

    it("creates deterministic runtime ZIPs with sorted fixed entries", async () => {
        const service = new RuntimeExportService();
        const first = await service.build(restore(), { kind: "runtime-assets-zip", bakeRoundedCorners: true });
        const second = await service.build(restore(), { kind: "runtime-assets-zip", bakeRoundedCorners: true });
        expect(first.content).toEqual(second.content);
        expect(first.manifest).toEqual(["animation.json", "artwork.svg"]);
        const files = unzipSync(first.content as Uint8Array);
        expect(strFromU8(files["animation.json"])).toContain('"formatVersion": 1');
        expect(strFromU8(files["artwork.svg"])).toContain("data-render-role");
    });

    it("includes every documented Web Bundle entry", async () => {
        spyOn(window, "fetch").and.callFake(async (input) => new Response(String(input).includes("esm") ? "export const runtime = true;" : "var SVGAnimatorRuntime={};", { status: 200 }));
        const artifact = await new RuntimeExportService().build(restore(), { kind: "web-bundle-zip", bakeRoundedCorners: true });
        expect(artifact.manifest).toEqual([
            "README.md", "animation.json", "artwork.svg", "index.html",
            "runtime/svg-animator-runtime.esm.js", "runtime/svg-animator-runtime.min.js",
        ]);
        const files = unzipSync(artifact.content as Uint8Array);
        artifact.manifest!.forEach((entry) => expect(files[entry]).withContext(entry).toBeDefined());
        const html = strFromU8(files["index.html"]);
        expect(html).toContain("SVGAnimatorRuntime.createPlayer");
        expect(html).toMatch(/svg-animator-runtime\.min\.js\?v=fnv1a32-[0-9a-f]{8}/);
    });

    it("blocks runtime export diagnostics with layer and correction context", async () => {
        const input = save();
        input.animation!.tracks[0].targetId = "missing";
        const svg = SVG.fromSave(input, { ID: "generated" } as never);
        const inspection = new RuntimeExportService().inspect(svg);
        expect(inspection.canExportAnimation).toBeFalse();
        expect(inspection.blockingDiagnostics[0].targetId).toBe("missing");
        expect(inspection.blockingDiagnostics[0].correction).toContain("existing layer");
    });

    it("sanitizes empty, reserved filename characters", () => {
        expect(sanitizeFilename('  a<b>:c/  ')).toBe("a-b--c-");
        expect(sanitizeFilename("... ")).toBe("drawing");
    });
});
