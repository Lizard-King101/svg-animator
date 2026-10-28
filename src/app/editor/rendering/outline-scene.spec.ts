import { OutlineLabScene } from '../../../../scripts/renderer-lab/scene';
import { OutlineScene } from './outline-scene';

describe('framework-free outline scene', () => {
    for(const rigs of [1, 3, 10]) it(`matches the editor for ${rigs} rigs across backward seeks and loop seams`, () => {
        const reference = new OutlineLabScene(rigs, 4), snapshot = reference.snapshot(), original = JSON.stringify(snapshot);
        const scene = new OutlineScene(snapshot);
        for(const time of [0, .12345, 2.9999, 3, 1.5, .12345, 0]) {
            reference.evaluate(time); scene.evaluate(time);
            const expected = reference.packedGeometry(), actual = scene.packedGeometry();
            expect(actual.length).toBe(expected.length);
            actual.forEach((draw, i) => {
                expect(draw.vertices!.length).toBe(expected[i].vertices!.length);
                let error = 0;
                draw.vertices!.forEach((value, j) => { error = Math.max(error, Math.abs(value - expected[i].vertices![j])); });
                // Export's numeric channel normalization can cross a 1e-4 output rounding boundary.
                expect(error).toBeLessThan(.00025);
            });
        }
        expect(JSON.stringify(snapshot)).toBe(original);
    });
    it('owns setup and ignores subsequent mutations to its source snapshot', () => {
        const snapshot = new OutlineLabScene(1, 4).snapshot(), scene = new OutlineScene(snapshot);
        scene.evaluate(.4); const values = [...scene.packedGeometry()[0].vertices!];
        snapshot.rigs[0].bones[0].x += 100; snapshot.paths[0].style.width = 80;
        scene.evaluate(.4); expect([...scene.packedGeometry()[0].vertices!]).toEqual(values);
    });
    it('evaluates action boundaries through the shared runtime evaluator without accumulating pose', () => {
        const snapshot = new OutlineLabScene(1, 4).snapshot(), channel = snapshot.channels[0];
        const track = channel.track;
        if(track.kind !== 'number') throw new Error('Expected numeric fixture.');
        channel.track = { ...track, actionWindows: [{ start: 1, end: 2, track: { ...track, times: [0, 1], values: [8, 20] } }] };
        const sequence = new OutlineScene(snapshot);
        for(const time of [.5, 1, 1.5, 2, 3, 1, 0]) {
            const direct = new OutlineScene(snapshot); sequence.evaluate(time); direct.evaluate(time);
            expect([...sequence.packedGeometry()[0].vertices!]).toEqual([...direct.packedGeometry()[0].vertices!]);
        }
    });
    it('rejects unsupported paint alignment, duplicate ownership and missing points', () => {
        let snapshot = new OutlineLabScene(1, 4).snapshot(); snapshot.paths[0].style.alignment = 'inside';
        expect(() => new OutlineScene(snapshot)).toThrowError(/centered/);
        snapshot = new OutlineLabScene(1, 4).snapshot(); snapshot.rigs.push({ ...snapshot.rigs[0], id: 'other' });
        expect(() => new OutlineScene(snapshot)).toThrowError(/Multiple rigs/);
        snapshot = new OutlineLabScene(1, 4).snapshot(); snapshot.paths[0].contours[0].lines[0].points[0].id = 'missing';
        expect(() => new OutlineScene(snapshot)).toThrowError(/topology/);
    });
    it('keeps published geometry after an invalid timestamp', () => {
        const scene = new OutlineScene(new OutlineLabScene(1, 4).snapshot()); scene.evaluate(.4);
        const draws = scene.packedGeometry(), vertices = [...draws[0].vertices!], revision = draws[0].revision;
        expect(() => scene.evaluate(NaN)).toThrowError(/time/);
        expect(scene.packedGeometry()[0].revision).toBe(revision);
        expect([...draws[0].vertices!]).toEqual(vertices);
    });
});
