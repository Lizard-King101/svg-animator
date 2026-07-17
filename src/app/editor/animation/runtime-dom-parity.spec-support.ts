import { createPlayer } from "../../../../packages/runtime/src/player";
import { Color } from "../objects/color.object";
import { SVG, SVGSave } from "../objects/svg.object";
import { buildSVGMarkup } from "../svg-markup";
import { AnimationEvaluationPlan } from "./animation-evaluation-plan";
import { ImperativeSvgRenderer } from "./imperative-svg-renderer";
import { compileRuntimeAnimation } from "./runtime-animation-compiler";

export interface RuntimeDomParitySample {
    time: number;
    editorRoot: SVGSVGElement;
    runtimeRoot: SVGSVGElement;
}

/** Returns playable boundaries, in-range keys, and each key segment midpoint. */
export function runtimeParitySampleTimes(source: SVGSave): number[] {
    const duration = Math.max(0, source.animation?.duration ?? 0);
    const times = new Set<number>([0, duration]);
    source.animation?.tracks.filter((track) => track.enabled !== false).forEach((track) => {
        const keys = track.keyframes.map((key) => key.time).filter(Number.isFinite).sort((a, b) => a - b);
        keys.forEach((time) => { if(time >= 0 && time <= duration) times.add(time); });
        keys.slice(0, -1).forEach((start, index) => {
            const clippedStart = Math.max(0, start);
            const clippedEnd = Math.min(duration, keys[index + 1]);
            if(clippedEnd > clippedStart) times.add((clippedStart + clippedEnd) / 2);
        });
    });
    return [...times].sort((a, b) => a - b);
}

/** Runs the editor evaluator and portable player against identical markup and compares visually meaningful SVG state. */
export function expectRuntimeDomParity(
    source: SVGSave,
    samples: number[],
    inspectSample?: (sample: RuntimeDomParitySample) => void,
): void {
    samples.forEach((time) => {
        const editorSvg = SVG.fromSave(source, { ID: "editor-fixture" } as never);
        const runtimeSvg = SVG.fromSave(source, { ID: "runtime-fixture" } as never);
        const compile = compileRuntimeAnimation(runtimeSvg.save());
        expect(compile.diagnostics).withContext(`compiler diagnostics at ${time}s`).toEqual([]);
        const markup = buildSVGMarkup(runtimeSvg, { bakeRoundedCorners: true, runtime: { signature: compile.bundle.artwork.signature } });
        const editorRoot = parseFixtureSvg(markup);
        const runtimeRoot = parseFixtureSvg(markup);
        const renderer = new ImperativeSvgRenderer(editorSvg, editorRoot);
        new AnimationEvaluationPlan(editorSvg.animation, editorSvg.elements).evaluateEach(time, (track, value) => renderer.apply(track, value));
        renderer.flush();
        const player = createPlayer(runtimeRoot, compile.bundle).seek(time);
        try {
            expectSvgDomEquivalent(editorRoot, runtimeRoot, time);
            inspectSample?.({ time, editorRoot, runtimeRoot });
        } finally {
            player.destroy();
        }
    });
}

export function parseFixtureSvg(markup: string): SVGSVGElement {
    const root = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
    if(root.localName !== "svg") throw new Error("Fixture markup did not parse as SVG.");
    return root as unknown as SVGSVGElement;
}

function expectSvgDomEquivalent(editorRoot: SVGSVGElement, runtimeRoot: SVGSVGElement, time: number): void {
    const editorNodes = [editorRoot, ...editorRoot.querySelectorAll<SVGElement>("*")];
    const runtimeNodes = [runtimeRoot, ...runtimeRoot.querySelectorAll<SVGElement>("*")];
    expect(runtimeNodes.length).withContext(`node count at ${time}s`).toBe(editorNodes.length);
    const differences: string[] = [];
    editorNodes.forEach((editorNode, index) => {
        const runtimeNode = runtimeNodes[index];
        if(!runtimeNode || runtimeNode.localName !== editorNode.localName) {
            differences.push(`node ${index}: expected <${editorNode.localName}>, received <${runtimeNode?.localName ?? "missing"}>`);
            return;
        }
        const editor = visualAttributes(editorNode);
        const runtime = visualAttributes(runtimeNode);
        new Set([...editor.keys(), ...runtime.keys()]).forEach((name) => {
            const expected = editor.get(name);
            const actual = runtime.get(name);
            if(expected == null || actual == null || !equivalentAttribute(expected, actual)) {
                differences.push(`${nodeLabel(editorNode, index)} ${name}: editor=${String(expected)}, runtime=${String(actual)}`);
            }
        });
    });
    expect(differences).withContext(`visual SVG state at ${time}s`).toEqual([]);
}

function visualAttributes(node: SVGElement): Map<string, string> {
    const names = new Set([
        "cx", "cy", "d", "display", "fill", "fill-opacity", "gradientTransform", "height", "offset", "opacity",
        "pathLength", "rx", "ry", "stop-color", "stop-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset",
        "stroke-opacity", "stroke-width", "style", "transform", "width", "x", "x1", "x2", "y", "y1", "y2",
    ]);
    const attributes = new Map([...node.attributes]
        .filter((attribute) => names.has(attribute.name))
        .map((attribute) => [attribute.name, attribute.value]));
    if(isIdentityMatrix(attributes.get("gradientTransform"))) attributes.delete("gradientTransform");
    ["fill-opacity", "opacity", "stop-opacity", "stroke-opacity"].forEach((name) => {
        if(numericEquals(attributes.get(name), 1)) attributes.delete(name);
    });
    if(numericEquals(attributes.get("stroke-dashoffset"), 0)) attributes.delete("stroke-dashoffset");
    if(node.localName === "tspan" && node.parentElement?.localName === "text" && attributes.get("x") === node.parentElement.getAttribute("x")) attributes.delete("x");
    if(node.closest("clipPath")) ["fill", "fill-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "stroke-width"].forEach((name) => attributes.delete(name));
    return attributes;
}

function equivalentAttribute(expected: string, actual: string): boolean {
    if(expected === actual) return true;
    if(/^#[\da-f]{3,8}$/i.test(expected) && /^#[\da-f]{3,8}$/i.test(actual)) {
        const left = new Color(expected);
        const right = new Color(actual);
        return Math.max(
            Math.abs(left.rgb.r - right.rgb.r),
            Math.abs(left.rgb.g - right.rgb.g),
            Math.abs(left.rgb.b - right.rgb.b),
        ) <= 2 && Math.abs(left.alpha - right.alpha) <= 0.005;
    }
    const numberPattern = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;
    const expectedNumbers = expected.match(numberPattern)?.map(Number) ?? [];
    const actualNumbers = actual.match(numberPattern)?.map(Number) ?? [];
    if(expected.replace(numberPattern, "#") !== actual.replace(numberPattern, "#") || expectedNumbers.length !== actualNumbers.length) return false;
    return expectedNumbers.every((value, index) => Math.abs(value - actualNumbers[index]) <= 0.02);
}

function isIdentityMatrix(value: string | undefined): boolean {
    if(!value) return false;
    const match = /^matrix\(([^)]+)\)$/.exec(value);
    if(!match) return false;
    const values = match[1].trim().split(/[ ,]+/).map(Number);
    return values.length === 6 && values.every((item, index) => Math.abs(item - [1, 0, 0, 1, 0, 0][index]) <= 1e-6);
}

function numericEquals(value: string | undefined, expected: number): boolean {
    return value != null && Number.isFinite(Number(value)) && Math.abs(Number(value) - expected) <= 1e-6;
}

function nodeLabel(node: SVGElement, index: number): string {
    const identifier = node.id ? `#${node.id}` : node.getAttribute("data-render-role") ? `[${node.getAttribute("data-render-role")}]` : "";
    return `node ${index} <${node.localName}${identifier}>`;
}
