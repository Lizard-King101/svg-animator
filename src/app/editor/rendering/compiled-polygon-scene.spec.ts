import { compilePolygonScene } from './compiled-polygon-scene';
import { layer, sceneCases } from '../../../../scripts/renderer-lab/scene-cases';
import { validatePolygonScene } from './polygon-scene';

describe('ordered polygon scene eligibility and transforms', () => {
    it('compiles supported scene fixtures without mutating source data', () => {
        for(const fixture of sceneCases()) {
            const original = JSON.stringify(fixture.targets), result = compilePolygonScene(fixture.targets, 1);
            expect(result.eligible).withContext(fixture.name).toBe(fixture.eligible);
            expect(JSON.stringify(fixture.targets)).toBe(original);
        }
    });
    it('keeps visible clip fill below content and clip stroke above content', () => {
        const fixture = sceneCases()[2], result = compilePolygonScene(fixture.targets, 1);
        if(!result.eligible) throw new Error(JSON.stringify(result.problems));
        expect(result.scene.draws.map(draw => JSON.parse(draw.id).slice(1))).toEqual([
            ['visibleMask', 'fill'], ['visibleArt', 'fill'], ['visibleMask', 'stroke'],
        ]);
        expect(result.scene.draws[0].clipId).toBeUndefined();
        expect(result.scene.draws[1].clipId).toBe(result.scene.clips[0].id);
        expect(result.scene.draws[2].clipId).toBeUndefined();
    });
    it('preserves hidden clip geometry and composes nested clips parent-first', () => {
        const result = compilePolygonScene(sceneCases()[0].targets, 1);
        if(!result.eligible) throw new Error(JSON.stringify(result.problems));
        expect(result.scene.clips.length).toBe(2);
        expect(result.scene.clips[1].clipId).toBe(result.scene.clips[0].id);
        expect(result.scene.draws.length).toBe(3);
        expect(result.scene.draws.at(-1)!.clipId).toBeUndefined();
    });
    it('updates parent and clip-source matrices without replacing geometry or revisions', () => {
        const fixture = sceneCases()[0], result = compilePolygonScene(fixture.targets, 1);
        if(!result.eligible) throw new Error(JSON.stringify(result.problems));
        const { scene } = result, draw = scene.draws[0], geometry = draw.polygons, matrix = draw.transform!, previous = { ...matrix };
        const clipMatrix = scene.clips[1].transform!, previousClip = { ...clipMatrix };
        scene.updateTransform('outer', { ...fixture.targets[0].transform, translateX: 18 });
        expect(draw.polygons).toBe(geometry); expect(draw.revision).toBe(1); expect(draw.transform).toBe(matrix);
        expect(matrix.e).toBeCloseTo(previous.e + 10); expect(clipMatrix.e).toBeCloseTo(previousClip.e + 10);
        const valid = { ...matrix };
        expect(() => scene.updateTransform('outer', { ...fixture.targets[0].transform, rotation: NaN })).toThrowError(/transform/);
        expect(matrix).toEqual(valid);
    });
    it('rejects unsupported paint and isolated compositing rather than partially drawing', () => {
        const target = layer('test', null);
        target.paints.fill = { kind: 'gradient', id: 'g', gradientType: 'linear-gradient', units: 'objectBoundingBox', spreadMethod: 'pad', transform: [1, 0, 0, 1, 0, 0], coordinates: {}, stops: [] };
        let result = compilePolygonScene([target], 1);
        expect(result.eligible).toBeFalse(); if(!result.eligible) expect(result.problems[0].reason).toContain('Gradient');
        target.paints.fill = { kind: 'solid', color: '#ff0000', opacity: 1 }; target.paints.stroke = target.paints.fill; target.opacity = .5;
        result = compilePolygonScene([target], 1); expect(result.eligible).toBeFalse();
        if(!result.eligible) expect(result.problems[0].reason).toContain('isolated');
    });
    it('rejects hierarchy corruption, duplicate IDs and invalid clip sources', () => {
        const a = layer('a', 'b', 'group'), b = layer('b', 'a', 'group');
        expect(compilePolygonScene([a, b], 1).eligible).toBeFalse();
        expect(compilePolygonScene([layer('a', 'missing')], 1).eligible).toBeFalse();
        expect(compilePolygonScene([layer('a', null), layer('a', null)], 1).eligible).toBeFalse();
        const fixture = sceneCases()[0]; fixture.targets[0].clipping!.clipElementId = 'tail';
        expect(compilePolygonScene(fixture.targets, 1).eligible).toBeFalse();
    });
    it('rejects curves and rounded fill geometry until their raster fidelity is supported', () => {
        const fixture = sceneCases()[1], source = fixture.targets[1];
        source.path!.contours[0].lines[0].type = 'bezier';
        expect(compilePolygonScene(fixture.targets, 1).eligible).toBeFalse();
        source.path!.contours[0].lines[0].type = 'line'; source.path!.rounded = true; source.path!.contours[0].lines[0].points[0].cornerRadius = 5;
        expect(compilePolygonScene(fixture.targets, 1).eligible).toBeFalse();
    });
    it('checks mask order, white coverage, missing IDs and nesting budgets at the renderer boundary', () => {
        const draw = { id: 'clip', revision: 1, color: [1, 1, 1, 1] as const, polygons: [] };
        expect(() => validatePolygonScene([], { width: 128, height: 128 }, [{ ...draw, clipId: 'missing' }])).toThrowError(/clip/);
        expect(() => validatePolygonScene([{ ...draw, id: 'paint', clipId: 'missing' }], { width: 128, height: 128 })).toThrowError(/clip/);
        expect(() => validatePolygonScene([], { width: 128, height: 128 }, [{ ...draw, color: [0, 0, 0, 1] }])).toThrowError(/white/);
        const chain = Array.from({ length: 17 }, (_, index) => ({ ...draw, id: String(index), clipId: index ? String(index - 1) : undefined }));
        expect(() => validatePolygonScene([], { width: 128, height: 128 }, chain)).toThrowError(/depth/);
    });
});
