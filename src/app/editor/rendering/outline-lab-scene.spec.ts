import { OutlineLabScene } from '../../../../scripts/renderer-lab/scene';
import { PolygonFanBuffer } from './polygon-scene';

describe('retained outline scene projection', () => {
    it('matches numeric geometry after forward, backward and fractional seeks', () => {
        const scene = new OutlineLabScene(1, 4), reference = new PolygonFanBuffer();
        const snapshots = new Map<number, number[]>();
        for(const time of [0, .12345, 2.9999, 3, 1.5, .12345, 0]) {
            scene.evaluate(time);
            reference.write(scene.geometry()[0].polygons!);
            const vertices = scene.packedGeometry()[0].vertices!;
            expect([...vertices]).toEqual([...reference.data]);
            if(snapshots.has(time)) expect([...vertices]).toEqual(snapshots.get(time)!);
            snapshots.set(time, [...vertices]);
        }
    });
    it('reuses storage and draw identity but isolates replacement scenes', () => {
        const scene = new OutlineLabScene(1, 4);
        scene.evaluate(0); const draws = scene.packedGeometry(), first = draws[0], array = first.vertices!.buffer, revision = first.revision;
        expect(scene.packedGeometry()).toBe(draws);
        scene.evaluate(0); scene.packedGeometry();
        expect(draws[0]).toBe(first); expect(first.vertices!.buffer).toBe(array); expect(first.revision).toBeGreaterThan(revision);
        const replacement = new OutlineLabScene(1, 40); replacement.evaluate(0);
        expect(replacement.packedGeometry()[0].id).not.toBe(first.id);
    });
});
