import { pathToFileURL } from 'node:url';
import { cpus } from 'node:os';
import { OutlineLabScene } from './renderer-lab/scene';
import { PolygonFanBuffer } from '../src/app/editor/rendering/polygon-scene';
import { fullOutlineSections, projectOutlineSections, visitOutlinePolygons, OutlineStyle } from '../packages/runtime/src/outline';
import type { RuntimeContourV1 } from '../packages/runtime/src/contracts';

// Optional pre-change bundled kernel for exact-output characterization. Nothing private is loaded.
const reference = process.argv[2] ? await import(pathToFileURL(process.argv[2]).href) : undefined;
let comparisons = 0;
if(reference) {
    let seed = 7731;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    for(let fixture = 0; fixture < 30; fixture++) {
        const contour: RuntimeContourV1 = { id: 'contour', closed: fixture % 2 === 0, lines: [] };
        for(let i = 0; i < 6; i++) {
            const a = { id: `a${i}`, x: i * 20, y: random() * 100 }, b = { id: `b${i}`, x: (i + 1) * 20, y: random() * 100 };
            contour.lines.push({ id: `line${i}`, type: i % 3 ? 'bezier' : 'line', points: [a, b],
                controlStart: { id: `c${i}`, x: a.x + 3, y: random() * 100 }, controlEnd: { id: `d${i}`, x: b.x - 4, y: random() * 100 } });
        }
        const sections = fullOutlineSections([contour]);
        if(fixture % 3 === 0) { sections[0].startTaper = { length: .31, tipWidth: .07 }; sections[0].endTaper = { length: .29, tipWidth: .2 }; }
        for(const lineCap of ['butt', 'round', 'square'] as const) for(const lineJoin of ['miter', 'bevel', 'round'] as const) {
            for(const progress of [0, .35, 1]) {
                const style: OutlineStyle = { width: 7.123, alignment: fixture % 4 === 0 ? 'inside' : 'center', lineCap, lineJoin, drawProgress: progress,
                    dasharray: fixture % 5 === 0 ? [0, 10] : fixture % 5 === 1 ? [13, 7] : [], dashoffset: -3.75 };
                const expected = reference.projectOutlineSections([contour], sections, style), actual = projectOutlineSections([contour], sections, style);
                if(JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Outline regression: fixture ${fixture}, ${lineCap}, ${lineJoin}, ${progress}`);
                const polygons: string[] = [];
                visitOutlinePolygons([contour], sections, style, points => polygons.push(`M ${points.map(p => `${p.x} ${p.y}`).join(' L ')} Z`));
                if(polygons.join(' ') !== expected.strokeData) throw new Error('Packed emission differs from reference.');
                comparisons++;
            }
        }
    }
}

const scene = new OutlineLabScene(10, 40), buffers = Array.from({ length: 10 }, () => new PolygonFanBuffer());
// Deterministic parity across forward, backward, fractional seeks and loop endpoints.
for(const time of [0, .127, 1.5, 2.9999, 3, .127, 0, 2.5]) {
    scene.evaluate(time);
    const numeric = scene.geometry(), packed = scene.packedGeometry();
    numeric.forEach((draw, i) => {
        buffers[i].write(draw.polygons!);
        const expected = buffers[i].data, actual = packed[i].vertices!;
        if(expected.length !== actual.length || !expected.every((value, index) => value === actual[index])) throw new Error(`Packed vertex mismatch at ${time}`);
    });
}
const baseline: number[] = [], packed: number[] = [];
for(let i = 0; i < 360; i++) {
    // Alternate measurement order so neither consistently inherits warm caches/GC timing.
    for(const mode of i % 2 ? ['packed', 'numeric'] : ['numeric', 'packed']) {
        scene.evaluate(i % 180 / 60);
        const started = performance.now();
        if(mode === 'packed') scene.packedGeometry(); else scene.geometry();
        if(i >= 120) (mode === 'packed' ? packed : baseline).push(performance.now() - started);
    }
}
const percentiles = (values: number[]) => { values.sort((a, b) => a - b); return { p50: values[120], p95: values[228], p99: values[237] }; };
console.log(JSON.stringify({ cpu: cpus()[0]?.model, node: process.version, samples: 240, referenceComparisons: comparisons,
    note: 'CPU geometry only: numeric output versus direct packed output, both using the optimized kernel. Excludes GPU/browser work and rig evaluation.',
    numeric: percentiles(baseline), packed: percentiles(packed) }, null, 2));
