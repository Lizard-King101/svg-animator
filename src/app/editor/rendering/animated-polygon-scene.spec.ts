import { AnimatedRigLabScene } from '../../../../scripts/renderer-lab/rig-scene';
import { AnimatedPolygonScene } from './animated-polygon-scene';
import { CompiledPolygonScene } from './compiled-polygon-scene';
import { PolygonDraw } from './polygon-scene';

function geometry(draw: PolygonDraw): number[] { return draw.polygons!.flatMap(polygon => polygon.flatMap(point => [point.x, point.y])); }

describe('animated ordered rig scene', () => {
    for(const count of [1, 3, 10]) it(`matches editor geometry and attachment matrices for ${count} rigs`, () => {
        const fixture = new AnimatedRigLabScene(count), scene = new AnimatedPolygonScene(fixture.snapshot());
        for(const time of [0, .12345, 1.5, 2.9999, 3, .12345, 0]) {
            fixture.evaluate(time, 'svg'); scene.evaluate(time);
            const expected = new CompiledPolygonScene(fixture.referenceTargets(), 1), draws = scene.packedGeometry();
            expect(draws.length).toBe(count * 5); expect(scene.clips.length).toBe(count * 2);
            [...draws, ...scene.clips].forEach((draw, i) => {
                const reference = [...expected.draws, ...expected.clips][i], a = geometry(draw), b = geometry(reference);
                expect(a.length).toBe(b.length);
                expect(Math.max(...a.map((value, j) => Math.abs(value - b[j])))).toBeLessThan(.00025);
                // Editor serialization rounds authored transforms to 1e-4.
                for(const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) expect(draw.transform![key]).toBeCloseTo(reference.transform![key], 4);
            });
        }
    });
    it('keeps static geometry and same-time revisions while updating weighted fills, strokes and clips', () => {
        const scene = new AnimatedPolygonScene(new AnimatedRigLabScene(1).snapshot()); scene.evaluate(0);
        const draws = scene.packedGeometry(), attachment = draws.at(-1)!, originalAttachment = geometry(attachment), oldMatrix = { ...attachment.transform! };
        const fill = draws[0], stroke = draws[1], fillRevision = fill.revision, strokeRevision = stroke.revision;
        const outer = scene.clips[0], moving = scene.clips[1], outerRevision = outer.revision, movingRevision = moving.revision;
        scene.evaluate(.75); expect(scene.packedGeometry()).toBe(draws);
        expect(fill.revision).toBeGreaterThan(fillRevision); expect(stroke.revision).toBeGreaterThan(strokeRevision);
        expect(moving.revision).toBeGreaterThan(movingRevision); expect(outer.revision).toBe(outerRevision);
        expect(geometry(attachment)).toEqual(originalAttachment); expect(attachment.transform).not.toEqual(oldMatrix);
        const revisions = [...draws, ...scene.clips].map(draw => draw.revision);
        scene.evaluate(.75); scene.packedGeometry(); expect([...draws, ...scene.clips].map(draw => draw.revision)).toEqual(revisions);
    });
    it('publishes no partial pose when geometry exceeds eligibility limits, then recovers on a valid seek', () => {
        const snapshot = new AnimatedRigLabScene(1).snapshot();
        const channel = snapshot.channels.find(channel => channel.property === 'bones.root.poseX')!;
        if(channel.track.kind !== 'number') throw new Error('Numeric track required.');
        channel.track.values[1] = 2e6;
        const scene = new AnimatedPolygonScene(snapshot); scene.evaluate(0); scene.packedGeometry();
        const before = JSON.stringify([scene.scene.draws, scene.clips]);
        scene.evaluate(.75); expect(() => scene.packedGeometry()).toThrowError(/coordinate range/);
        expect(JSON.stringify([scene.scene.draws, scene.clips])).toBe(before);
        scene.evaluate(0); scene.packedGeometry(); expect(JSON.stringify([scene.scene.draws, scene.clips])).toBe(before);
    });
    it('matches direct seeks across action-window transitions and loop seams', () => {
        const snapshot = new AnimatedRigLabScene(1).snapshot(), channel = snapshot.channels.find(channel => channel.property === 'bones.root.poseX')!;
        const track = channel.track; if(track.kind !== 'number') throw new Error('Numeric track required.');
        channel.track = { ...track, actionWindows: [{ start: 1, end: 2, track: { ...track, times: [0, 1], values: [20, -10] } }] };
        const sequential = new AnimatedPolygonScene(snapshot);
        const pose = (scene: AnimatedPolygonScene) => [...scene.packedGeometry(), ...scene.clips].map(draw => ({ geometry: geometry(draw), matrix: { ...draw.transform! } }));
        for(const time of [0, .99999, 1, 1.99999, 2, 3, 0, 1.2]) {
            sequential.evaluate(time); const direct = new AnimatedPolygonScene(snapshot); direct.evaluate(time);
            expect(pose(sequential)).toEqual(pose(direct));
        }
    });
    it('rejects invalid binding references and unsupported animation channels up front', () => {
        let snapshot = new AnimatedRigLabScene(1).snapshot(); snapshot.rigs[0].bindings[0].pathId = 'missing';
        expect(() => new AnimatedPolygonScene(snapshot)).toThrow();
        snapshot = new AnimatedRigLabScene(1).snapshot(); snapshot.channels[0].property = 'opacity';
        expect(() => new AnimatedPolygonScene(snapshot)).toThrowError(/channel/);
    });
    it('replaces setup without aliasing input or prior-generation drawing IDs', () => {
        const fixture = new AnimatedRigLabScene(1), snapshot = fixture.snapshot(), scene = new AnimatedPolygonScene(snapshot);
        snapshot.targets.length = 0; scene.evaluate(.3); const first = scene.packedGeometry()[0];
        const next = new AnimatedPolygonScene(new AnimatedRigLabScene(1).snapshot()); next.evaluate(.3);
        expect(next.packedGeometry()[0].id).not.toBe(first.id);
    });
});
