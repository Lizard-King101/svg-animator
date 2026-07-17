import {
    createEmbeddedPlayer,
    createPlayer,
    loadPlayer,
    RuntimePlayerError,
    validateRuntimeBundle,
} from "../../../../packages/runtime/src/index";
import { compileRuntimeAnimation } from "./runtime-animation-compiler";
import { SVGSave } from "../objects/svg.object";

describe("RuntimePlayer v1", () => {
    const source = (): SVGSave => ({
        id: "artwork", name: "Runtime", width: 100, height: 80, viewBoxX: 10, viewBoxY: -5,
        elements: [{
            type: "shape", id: "shape", name: "Box", visible: true, locked: false, opacity: 1,
            shapeType: "rectangle", position: { id: "point", x: 5, y: 6 },
            settings: {
                width: 20, height: 10, stroke_width: 2, stroke: "#000000", fill: "#ff0000",
                line_cap: null, line_join: null, stroke_alignment: "center", stroke_dasharray: [], stroke_dashoffset: 0, stroke_miterlimit: 4,
            },
        }],
        animation: {
            version: 2, duration: 2, loop: false, variables: [], markers: [{ id: "middle", time: 1, name: "Middle" }],
            tracks: [
                { id: "move", targetId: "shape", property: "transform.translateX", valueType: "number", keyframes: [{ id: "a", time: 0, value: 0 }, { id: "b", time: 2, value: 20 }] },
                { id: "opacity", targetId: "shape", property: "opacity", valueType: "number", keyframes: [{ id: "a", time: 0, value: 1 }, { id: "b", time: 2, value: 0 }] },
            ],
        },
    });

    function mounted(ownerDocument: Document = document) {
        const bundle = compileRuntimeAnimation(source()).bundle;
        const root = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
        root.setAttribute("data-svg-animator-signature", bundle.artwork.signature);
        const rectangle = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
        rectangle.id = "shape";
        rectangle.setAttribute("x", "5"); rectangle.setAttribute("y", "6"); rectangle.setAttribute("width", "20"); rectangle.setAttribute("height", "10");
        rectangle.setAttribute("fill", "#ff0000"); rectangle.setAttribute("stroke", "#000000");
        root.append(rectangle);
        return { bundle, root, rectangle };
    }

    it("mounts paused and seeks deterministic attributes", () => {
        const { bundle, root, rectangle } = mounted();
        const player = createPlayer(root, bundle);
        expect(player.state).toBe("paused");
        player.seek(1);
        expect(player.time).toBe(1);
        expect(rectangle.getAttribute("transform")).toBe("matrix(1 0 0 1 10 0)");
        expect(Number(rectangle.getAttribute("opacity"))).toBeCloseTo(0.5, 4);
    });

    it("mounts an SVG's embedded bundle paused without a second request", () => {
        const { bundle, root, rectangle } = mounted();
        const payload = document.createElementNS("http://www.w3.org/2000/svg", "script");
        payload.setAttribute("type", "application/json");
        payload.setAttribute("data-svg-animator-bundle", "");
        payload.textContent = JSON.stringify(bundle);
        root.append(payload);

        const player = createEmbeddedPlayer(root);
        expect(player.state).toBe("paused");
        player.seek(1);
        expect(rectangle.getAttribute("transform")).toBe("matrix(1 0 0 1 10 0)");
        player.destroy();
    });

    it("reports missing and malformed embedded bundles with typed errors", () => {
        const missing = mounted();
        expect(() => createEmbeddedPlayer(missing.root)).toThrowError(RuntimePlayerError, /no embedded runtime bundle/);

        const malformed = mounted();
        const payload = document.createElementNS("http://www.w3.org/2000/svg", "script");
        payload.setAttribute("type", "application/json");
        payload.setAttribute("data-svg-animator-bundle", "");
        payload.textContent = "{bad";
        malformed.root.append(payload);
        expect(() => createEmbeddedPlayer(malformed.root)).toThrowError(RuntimePlayerError, /not valid JSON/);
    });

    it("mounts SVG roots obtained from same-origin object or iframe documents", () => {
        const frame = document.createElement("iframe");
        document.body.append(frame);
        try {
            const foreignDocument = frame.contentDocument!;
            const { bundle, root, rectangle } = mounted(foreignDocument);
            expect(root instanceof SVGSVGElement).toBeFalse();
            const player = createPlayer(root, bundle);
            player.seek(1);
            expect(rectangle.getAttribute("transform")).toBe("matrix(1 0 0 1 10 0)");
            player.destroy();
        } finally {
            frame.remove();
        }
    });

    it("emits marker crossings in both directions", () => {
        const { bundle, root } = mounted();
        const player = createPlayer(root, bundle);
        const directions: string[] = [];
        player.on("marker", (event) => directions.push(event.direction));
        player.seek(1.5).seek(0.5);
        expect(directions).toEqual(["forward", "reverse"]);
    });

    it("continues past the zero-delta first frame during forward playback", () => {
        const frames: FrameRequestCallback[] = [];
        spyOn(window, "requestAnimationFrame").and.callFake((callback) => {
            frames.push(callback);
            return frames.length;
        });
        spyOn(window, "cancelAnimationFrame");
        const { bundle, root, rectangle } = mounted();
        const player = createPlayer(root, bundle);

        player.play();
        frames.shift()!(100);
        expect(player.state).toBe("playing");
        expect(player.time).toBe(0);
        frames.shift()!(1100);
        expect(player.state).toBe("playing");
        expect(player.time).toBe(1);
        expect(rectangle.getAttribute("transform")).toBe("matrix(1 0 0 1 10 0)");
        player.destroy();
    });

    it("restores initial DOM attributes on destroy and isolates instances", () => {
        const first = mounted();
        const second = mounted();
        const a = createPlayer(first.root, first.bundle);
        const b = createPlayer(second.root, second.bundle);
        a.seek(2);
        expect(first.rectangle.getAttribute("transform")).not.toBeNull();
        expect(second.rectangle.getAttribute("transform")).toBeNull();
        a.destroy();
        expect(first.rectangle.getAttribute("transform")).toBeNull();
        expect(first.rectangle.getAttribute("opacity")).toBeNull();
        b.destroy();
    });

    it("rejects wrong artwork, capabilities, and future formats with typed errors", () => {
        const { bundle, root } = mounted();
        root.setAttribute("data-svg-animator-signature", "wrong");
        expect(() => createPlayer(root, bundle)).toThrowError(RuntimePlayerError, /signature/);
        expect(() => validateRuntimeBundle({ ...bundle, requiredCapabilities: ["future"] })).toThrowError(RuntimePlayerError, /capability/);
        expect(() => validateRuntimeBundle({ ...bundle, formatVersion: 2 })).toThrowError(RuntimePlayerError, /format/);
    });

    it("suppresses generated autoplay for reduced motion but honors explicit playback", async () => {
        spyOn(window, "matchMedia").and.returnValue({ matches: true } as MediaQueryList);
        const { bundle, root } = mounted();
        const player = createPlayer(root, bundle, { autoPlay: true });
        await Promise.resolve();
        expect(player.state).toBe("paused");
        player.play();
        expect(player.state).toBe("playing");
        player.pause();
        player.destroy();
    });

    it("reports malformed JSON and fetch failures from loadPlayer", async () => {
        const malformed = spyOn(window, "fetch").and.resolveTo(new Response("{bad", { status: 200 }));
        await expectAsync(loadPlayer(mounted().root, "/bad.json")).toBeRejectedWithError(RuntimePlayerError, /valid JSON/);
        malformed.and.resolveTo(new Response("missing", { status: 404 }));
        await expectAsync(loadPlayer(mounted().root, "/missing.json")).toBeRejectedWithError(RuntimePlayerError, /HTTP 404/);
    });
});
