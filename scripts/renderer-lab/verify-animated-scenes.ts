import { AnimatedRigLabScene } from './rig-scene';
import { WebGpuPolygonRenderer } from '../../src/app/editor/rendering/webgpu-polygon-renderer';
import { compare, svgPixels } from './verify';
import { labWorkloads } from './workloads';
import { referenceEdges } from './reference-edges';
import { CompiledPolygonScene } from '../../src/app/editor/rendering/compiled-polygon-scene';

export async function verifyAnimatedScenes() {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 410;
    const errors: string[] = [], initialized = await WebGpuPolygonRenderer.create(canvas, reason => errors.push(reason));
    if(!('renderer' in initialized)) return { skipped: true, reason: initialized.reason };
    const reports = [];
    try {
        for(const [rigs, width, height] of [[1, 512, 410], [3, 512, 410], [10, 512, 410], [10, 1380, 1104], [1, 256, 205]]) {
            canvas.width = width; canvas.height = height;
            const scene = new AnimatedRigLabScene(rigs);
            for(const time of [0, .12345, 1.5, 2.9999, 3, .12345, 0]) {
                scene.evaluate(time);
                const expected = await svgPixels(scene.svgData(), canvas.width, canvas.height);
                const actual = await initialized.renderer.capture(scene.packedGeometry(), { width: 1000, height: 800 }, scene.clips);
                const memory = initialized.renderer.clipMemory;
                if(memory.textures !== 2 || memory.bytes !== width * height * 32) errors.push(`Unexpected mask allocation: ${JSON.stringify(memory)}`);
                reports.push({ rigs, time, width, height, clipMemory: memory, ...compare(expected, actual, canvas.width, canvas.height),
                    paintedPixels: expected.reduce((sum, value, index) => sum + (index % 4 === 3 && value > 0 ? 1 : 0), 0) });
            }
        }
        canvas.width = 512; canvas.height = 410;
        for(const workload of labWorkloads) {
            if(workload.kind !== 'scene' || !workload.id.startsWith('scene-')) continue;
            const scene = new AnimatedRigLabScene(workload.options);
            for(const time of [.75, .12345, 0]) {
                scene.evaluate(time);
                const expected = await svgPixels(scene.svgData(), canvas.width, canvas.height);
                const actual = await initialized.renderer.capture(scene.packedGeometry(), { width: 1000, height: 800 }, scene.clips);
                const reference = new CompiledPolygonScene(scene.referenceTargets(), 1);
                const edges = referenceEdges([...reference.draws, ...reference.clips], { width: 1000, height: 800 }, canvas.width, canvas.height);
                reports.push({ workload: workload.id, time, ...compare(expected, actual, canvas.width, canvas.height, edges),
                    paintedPixels: expected.reduce((sum, value, index) => sum + (index % 4 === 3 && value > 0 ? 1 : 0), 0) });
            }
        }
        // A genuinely excessive live allocation still fails, then a smaller frame recovers.
        const scene = new AnimatedRigLabScene(1); scene.evaluate(0);
        canvas.width = canvas.height = 4096;
        let rejected = false;
        try { initialized.renderer.render(scene.packedGeometry(), { width: 1000, height: 800 }, scene.clips); }
        catch(error) { rejected = String(error).includes('256 MiB'); }
        if(!rejected) errors.push('Live mask budget did not reject an excessive surface.');
        canvas.width = 256; canvas.height = 205;
        await initialized.renderer.capture(scene.packedGeometry(), { width: 1000, height: 800 }, scene.clips);
        const cleared = await initialized.renderer.capture([], { width: 1000, height: 800 }, scene.clips);
        if(cleared.some(value => value !== 0) || initialized.renderer.clipMemory.textures !== 0) errors.push('Empty scene did not clear output and release unused masks.');
        return { skipped: false, passed: !errors.length && reports.every(report => report.mismatches === 0 && report.paintedPixels > 100
                && report.paintedInterior > ('workload' in report ? 100 : 0)), reports, errors,
            note: 'Editor SVG versus supported rig fixtures. Interior parity only. Stress cases additionally exclude pixels within one pixel of independently projected SVG polygon edges; boundary differences are reported separately, not treated as raster parity.' };
    } finally { initialized.renderer.destroy(); }
}
