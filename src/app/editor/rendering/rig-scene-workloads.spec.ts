import { AnimatedRigLabScene } from '../../../../scripts/renderer-lab/rig-scene';
import { labWorkload, labWorkloads } from '../../../../scripts/renderer-lab/workloads';
import { CompiledPolygonScene } from './compiled-polygon-scene';

describe('renderer stress workloads', () => {
    for(const config of labWorkloads.filter(config => config.kind === 'scene' && config.id.startsWith('scene-'))) {
        it(`keeps ${config.id} within supported geometry throughout a loop`, () => {
            if(config.kind !== 'scene') throw new Error('Scene required');
            const scene = new AnimatedRigLabScene(config.options), stats = scene.workloadDetails;
            expect(stats.paintDraws).toBe(stats.rigs * (stats.pathsPerRig * 2 + 1) + stats.staticLayers);
            expect(stats.boundPoints).toBe(stats.rigs * (stats.pathsPerRig * stats.verticesPerPath + 4));
            const snapshot = scene.snapshot();
            expect(snapshot.channels.length).toBe(stats.movingRigs * 4);
            for(const time of [0, .75, 1.5, 2.25, 3, .12345, 0]) {
                scene.evaluate(time, 'webgpu');
                expect(scene.packedGeometry().length).toBe(stats.paintDraws);
            }
        });
    }
    it('matches editor-projected dense layered artwork on direct and backward seeks', () => {
        const scene = new AnimatedRigLabScene({ rigs: 1, pathsPerRig: 8, subdivisions: 4, staticLayers: 12 });
        for(const time of [0, .75, .12345, 0]) {
            scene.evaluate(time);
            const expected = new CompiledPolygonScene(scene.referenceTargets(), 1);
            scene.packedGeometry().forEach((draw, i) => {
                const actual = draw.polygons!.flatMap(p => p.flatMap(v => [v.x, v.y]));
                const reference = expected.draws[i].polygons!.flatMap(p => p.flatMap(v => [v.x, v.y]));
                expect(actual.length).toBe(reference.length);
                expect(actual.every((v, j) => Math.abs(v - reference[j]) < .00025)).toBeTrue();
            });
        }
    });
    it('keeps surrounding artwork and nine rigs unchanged when only one rig moves', () => {
        const scene = new AnimatedRigLabScene({ rigs: 10, moving: 1, staticLayers: 50 });
        scene.evaluate(0); const draws = scene.packedGeometry();
        const before = draws.map(draw => JSON.stringify(draw));
        scene.evaluate(.75); scene.packedGeometry();
        expect(draws.slice(0, 50).map(draw => JSON.stringify(draw))).toEqual(before.slice(0, 50));
        expect(draws.slice(55).map(draw => JSON.stringify(draw))).toEqual(before.slice(55));
        expect(draws.slice(50, 55).map(draw => JSON.stringify(draw))).not.toEqual(before.slice(50, 55));
    });
    it('rejects invalid sizes and unknown presets', () => {
        expect(() => new AnimatedRigLabScene({ subdivisions: 9 })).toThrowError(/workload/);
        expect(() => new AnimatedRigLabScene({ rigs: 1, moving: 2 })).toThrowError(/workload/);
        expect(() => new AnimatedRigLabScene({ staticLayers: 2001 })).toThrowError(/workload/);
        expect(() => labWorkload('invalid')).toThrowError(/workload/);
    });
});
