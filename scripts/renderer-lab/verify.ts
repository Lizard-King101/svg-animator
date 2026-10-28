import { compilePolygonScene } from '../../src/app/editor/rendering/compiled-polygon-scene';
import { sceneCases } from './scene-cases';
import { PolygonDraw, PolygonContours, PolygonFanBuffer } from '../../src/app/editor/rendering/polygon-scene';
import { WebGpuPolygonRenderer } from '../../src/app/editor/rendering/webgpu-polygon-renderer';
import { fullOutlineSections, projectOutlineGeometry } from '../../packages/runtime/src/outline';
import { RuntimeContourV1 } from '../../packages/runtime/src/contracts';

const box = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
function testCases(): { name: string; draws: PolygonDraw[] }[] {
    const outer = box(12, 12, 100, 100), inner = box(35, 35, 54, 54).reverse();
    const draw = (polygons: PolygonContours, color: PolygonDraw['color'] = [.2, .6, .9, 1], id = 'a'): PolygonDraw => ({ id, revision: 1, polygons, color });
    const concave = [{ x: 12, y: 12 }, { x: 112, y: 12 }, { x: 112, y: 42 }, { x: 42, y: 42 }, { x: 42, y: 112 }, { x: 12, y: 112 }];
    const bowtie = [{ x: 12, y: 12 }, { x: 112, y: 112 }, { x: 12, y: 112 }, { x: 112, y: 12 }];
    const curve: RuntimeContourV1 = { id: 'curve', closed: false, lines: [{ id: 'edge', type: 'bezier',
        points: [{ id: 'a', x: 12, y: 64 }, { id: 'b', x: 116, y: 64 }], controlStart: { id: 'c', x: 36, y: 0 }, controlEnd: { id: 'd', x: 92, y: 128 } }] };
    const sections = fullOutlineSections([curve]); sections[0].startTaper = { length: .25, tipWidth: .1 };
    const outline = projectOutlineGeometry([curve], sections, { width: 16, dasharray: [18, 7], lineCap: 'round', lineJoin: 'round', drawProgress: .91 });
    return [
        { name: 'concave', draws: [draw([concave])] },
        { name: 'hole', draws: [draw([outer, inner])] },
        { name: 'self-intersection', draws: [draw([bowtie])] },
        { name: 'compound-opacity', draws: [draw([box(10, 10, 70, 70), box(50, 50, 65, 65)], [.9, .3, .1, .5])] },
        { name: 'separate-opacity-and-stencil-reset', draws: [draw([outer, inner], [.8, .2, .3, .5]), draw([box(50, 4, 60, 120)], [.1, .4, .9, .5], 'b')] },
        { name: 'tapered-dashed-curve', draws: [draw(outline.polygons)] },
        { name: 'offscreen-clipping', draws: [draw([box(-30, -20, 100, 120)])] },
        { name: 'empty', draws: [] },
    ];
}
function svgText(draws: PolygonDraw[]): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${draws.map(draw => {
        const data = draw.polygons!.map(points => `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')} Z`).join(' ');
        return `<path d="${data}" fill="rgb(${draw.color.slice(0, 3).map(v => v * 100 + '%').join(' ')})" fill-opacity="${draw.color[3]}"/>`;
    }).join('')}</svg>`;
}
export async function svgPixels(draws: PolygonDraw[] | string, width = 128, height = 128): Promise<Uint8ClampedArray> {
    const url = URL.createObjectURL(new Blob([typeof draws === 'string' ? draws : svgText(draws)], { type: 'image/svg+xml' }));
    try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0, width, height);
        return context.getImageData(0, 0, width, height).data;
    } finally { URL.revokeObjectURL(url); }
}
export function compare(expected: Uint8ClampedArray, actual: Uint8ClampedArray, width = 128, height = 128, referenceEdges?: Uint8Array) {
    let interior = 0, mismatches = 0, boundary = 0, maximumInteriorError = 0;
    let geometricBoundary = 0, geometricBoundaryDifferences = 0, maximumGeometricBoundaryError = 0, paintedInterior = 0;
    const mismatchExamples: { x: number; y: number; expected: number[]; actual: number[]; neighborhood: number[][] }[] = [];
    const same = (a: number, b: number) => [0, 1, 2, 3].every(c => Math.abs(expected[a + c] - expected[b + c]) <= 1);
    for(let y = 1; y < height - 1; y++) for(let x = 1; x < width - 1; x++) {
        const offset = (y * width + x) * 4;
        if(![-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1].every(d => same(offset, offset + d * 4))) { boundary++; continue; }
        // Compare premultiplied channels so RGB in fully transparent pixels is irrelevant.
        const alpha = expected[offset + 3] / 255;
        const error = Math.max(Math.abs(expected[offset + 3] - actual[offset + 3]), ...[0, 1, 2].map(c => Math.abs(expected[offset + c] * alpha - actual[offset + c])));
        if(referenceEdges?.[y * width + x]) {
            geometricBoundary++;
            if(error > 3) geometricBoundaryDifferences++;
            maximumGeometricBoundaryError = Math.max(maximumGeometricBoundaryError, error);
            continue;
        }
        maximumInteriorError = Math.max(maximumInteriorError, error); interior++;
        if(alpha > 0) paintedInterior++;
        if(error > 3) {
            mismatches++;
            if(mismatchExamples.length < 8) mismatchExamples.push({ x, y, expected: Array.from(expected.slice(offset, offset + 4)),
                actual: Array.from(actual.slice(offset, offset + 4)), neighborhood: [-2 * width, -2, 2, 2 * width].map(d => Array.from(expected.slice(offset + d * 4, offset + d * 4 + 4))) });
        }
    }
    return { interior, paintedInterior, mismatches, excludedBoundaryPixels: boundary, maximumInteriorError,
        ...(referenceEdges ? { excludedGeometricBoundaryPixels: geometricBoundary, geometricBoundaryDifferences, maximumGeometricBoundaryError } : {}),
        ...(mismatchExamples.length ? { mismatchExamples } : {}) };
}

function sampleAtReferenceSize(pixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
    const resized = new Uint8ClampedArray(128 * 128 * 4);
    for(let y = 0; y < 128; y++) for(let x = 0; x < 128; x++) for(let c = 0; c < 4; c++) {
        resized[(y * 128 + x) * 4 + c] = pixels[(Math.floor((y + .5) * height / 128) * width + Math.floor((x + .5) * width / 128)) * 4 + c];
    }
    return resized;
}

export async function verifyPixels() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    // The diagnostic backend copies the texture in the same submission, before presentation.
    const errors: string[] = [];
    const result = await WebGpuPolygonRenderer.create(canvas, error => errors.push(error));
    if(!('renderer' in result)) return { skipped: true, reason: result.reason };
    const renderer = result.renderer, reports = [];
    try {
        for(const [index, test] of testCases().entries()) {
            test.draws.forEach(draw => draw.revision = index + 1);
            const expected = await svgPixels(test.draws);
            const comparison = compare(expected, await renderer.capture(test.draws, { width: 128, height: 128 }));
            reports.push({ name: test.name, ...comparison });
            const packed = test.draws.map(draw => {
                const buffer = new PolygonFanBuffer(); buffer.write(draw.polygons!);
                return { id: draw.id, revision: draw.revision + 100, color: draw.color, vertices: buffer.data };
            });
            reports.push({ name: `${test.name}-packed`, ...compare(expected, await renderer.capture(packed, { width: 128, height: 128 })) });
        }
        for(const [index, test] of sceneCases().entries()) {
            const compiled = compilePolygonScene(test.targets, index + 1000);
            if(compiled.eligible !== test.eligible) { errors.push(`${test.name}: incorrect eligibility ${JSON.stringify(compiled)}`); continue; }
            if(!compiled.eligible) continue;
            const { draws, clips } = compiled.scene;
            reports.push({ name: test.name, ...compare(await svgPixels(test.svg), await renderer.capture(draws, { width: 128, height: 128 }, clips)) });
            if(test.name === 'even-odd-clip-hole') {
                const mask = clips[0]; mask.polygons = [mask.polygons![0]]; mask.revision++;
                reports.push({ name: 'retained-clip-geometry-change', ...compare(await svgPixels(test.svg.replace(' M38 38H90V90H38Z', '')),
                    await renderer.capture(draws, { width: 128, height: 128 }, clips)) });
                mask.polygons = []; mask.revision++;
                reports.push({ name: 'empty-clip-clears-old-mask', ...compare(new Uint8ClampedArray(128 * 128 * 4),
                    await renderer.capture(draws, { width: 128, height: 128 }, clips)) });
            }
            if(test.name === 'nested-transformed-clips') {
                canvas.width = canvas.height = 256;
                const large = await renderer.capture(draws, { width: 128, height: 128 }, clips);
                reports.push({ name: 'nested-clip-texture-resize', ...compare(await svgPixels(test.svg), sampleAtReferenceSize(large, 256, 256)) });
                canvas.width = canvas.height = 128;
                const parent = test.targets[0], moved = { ...parent.transform, translateX: 16 };
                compiled.scene.updateTransform(parent.id, moved);
                reports.push({ name: 'retained-parent-transform-and-clip-update', ...compare(await svgPixels(test.svg.replace('translate(8 5)', 'translate(16 5)')),
                    await renderer.capture(draws, { width: 128, height: 128 }, clips)) });
            }
        }
        // Return to earlier masks after drawing unrelated siblings. Translucent overlap
        // exposes lost color samples between passes; an empty recycled mask must clear.
        const reuseClips: PolygonDraw[] = [
            { id: 'reuse-root', polygons: [box(10, 10, 108, 108)] },
            { id: 'reuse-left', clipId: 'reuse-root', polygons: [box(0, 0, 72, 128)] },
            { id: 'reuse-right', clipId: 'reuse-root', polygons: [box(56, 0, 72, 128)] },
            { id: 'reuse-band', polygons: [box(0, 48, 128, 40)] },
            { id: 'reuse-empty', polygons: [] },
        ].map(clip => ({ ...clip, revision: 1, color: [1, 1, 1, 1] }));
        const reuseDraws: PolygonDraw[] = ['left', 'band', 'right', 'left', 'root', 'empty'].map((clip, i) => ({
            id: `reuse-paint-${i}`, clipId: `reuse-${clip}`, polygons: [box(4 + i * 3, 4 + i * 5, 100, 100)],
            revision: 1, color: i % 2 ? [.8, .2, .1, .5] : [.1, .4, .9, .5],
        }));
        const definitions = `<defs><clipPath id="root"><rect x="10" y="10" width="108" height="108"/></clipPath>
            <clipPath id="left"><rect width="72" height="128"/></clipPath><clipPath id="right"><rect x="56" width="72" height="128"/></clipPath>
            <clipPath id="band"><rect y="48" width="128" height="40"/></clipPath><clipPath id="empty"><path d=""/></clipPath></defs>`;
        for(const reversed of [false, true]) {
            const draws = reversed ? [...reuseDraws].reverse() : reuseDraws;
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">${definitions}${draws.map(draw => {
                const i = Number(draw.id.split('-').at(-1)), clip = draw.clipId!.replace('reuse-', '');
                const rect = `<rect x="${4 + i * 3}" y="${4 + i * 5}" width="100" height="100" fill="${i % 2 ? 'rgb(80% 20% 10%)' : 'rgb(10% 40% 90%)'}" fill-opacity=".5"/>`;
                const clipped = `<g clip-path="url(#${clip})">${rect}</g>`;
                return clip === 'left' || clip === 'right' ? `<g clip-path="url(#root)">${clipped}</g>` : clipped;
            }).join('')}</svg>`;
            reports.push({ name: `shared-clip-lifetimes-${reversed ? 'reversed' : 'forward'}`, ...compare(await svgPixels(svg),
                await renderer.capture(draws, { width: 128, height: 128 }, reuseClips)) });
        }
        const retained = testCases()[1];
        await renderer.capture(retained.draws, { width: 128, height: 128 });
        retained.draws[0].color = [.9, .1, .2, .4];
        reports.push({ name: 'retained-geometry-paint-change', ...compare(await svgPixels(retained.draws), await renderer.capture(retained.draws, { width: 128, height: 128 })) });
        // Resize both attachments, then draw again using retained geometry revisions.
        for(const [width, height] of [[256, 256], [690, 552]]) {
            canvas.width = width; canvas.height = height;
            const test = testCases()[1], large = await renderer.capture(test.draws, { width: 128, height: 128 });
            const resized = sampleAtReferenceSize(large, width, height);
            reports.push({ name: `resize-${width}x${height}`, ...compare(await svgPixels(test.draws), resized) });
        }
        renderer.destroy();
        let rejectedAfterDestroy = false;
        try { renderer.render([], { width: 128, height: 128 }); } catch { rejectedAfterDestroy = true; }
        if(!rejectedAfterDestroy) errors.push('A destroyed renderer accepted a frame.');
        return { skipped: false, passed: errors.length === 0 && reports.every(report => report.mismatches === 0), reports, errors,
            note: 'Interior parity tolerance is 3/255 premultiplied color/alpha. One-pixel reference edge neighborhoods excluded; raster antialiasing parity is not established.' };
    } finally { renderer.destroy(); renderer.destroy(); }
}
