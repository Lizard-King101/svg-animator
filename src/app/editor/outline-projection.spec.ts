import { RuntimeContourV1, RuntimeLineV1 } from '../../../packages/runtime/src/contracts';
import { buildRuntimePathData } from '../../../packages/runtime/src/path-data';
import { closestOutlinePosition, fullOutlineSections, OutlineSection, outlineContourSegments, outlinePositionPoint, outlineSectionLines, outlineSectionsProblem, projectOutlineSections } from '../../../packages/runtime/src/outline';
import { cubicPoint } from '../../../packages/runtime/src/curve-range';

describe('derived outline geometry', () => {
    const point = (id: string, x: number, y: number) => ({ id, x, y });
    const line = (id: string, x1: number, y1: number, x2: number, y2: number): RuntimeLineV1 => ({ id, type: 'line', points: [point(`${id}-a`, x1, y1), point(`${id}-b`, x2, y2)] });
    const straight = (): RuntimeContourV1 => ({ id: 'contour', closed: false, lines: [line('edge', 0, 0, 100, 0)] });
    const section = (contour: RuntimeContourV1, start = 0, end = 1): OutlineSection => ({ id: 'outline', contourId: contour.id, start: { segmentId: contour.lines[0].id, t: start }, end: { segmentId: contour.lines[0].id, t: end } });
    const vertices = (data: string) => { const values = data.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []; return values.filter((_, index) => index % 2 === 0).map((x, index) => ({ x, y: values[index * 2 + 1] })); };

    it('cuts a cubic at exact curve-local positions without changing source points', () => {
        const contour = straight(), edge = contour.lines[0];
        edge.type = 'bezier'; edge.controlStart = point('c1', 20, 60); edge.controlEnd = point('c2', 80, -30);
        const before = JSON.stringify(contour), selected = section(contour, .2, .8), lines = outlineSectionLines(contour, selected);
        expect(lines.length).toBe(1); expect(lines[0].type).toBe('bezier');
        expect(lines[0].points[0].x).toBeCloseTo(cubicPoint(edge.points[0], edge.controlStart, edge.controlEnd, edge.points[1], .2).x, 9);
        expect(lines[0].points[1].y).toBeCloseTo(cubicPoint(edge.points[0], edge.controlStart, edge.controlEnd, edge.points[1], .8).y, 9);
        expect(JSON.stringify(contour)).toBe(before);
    });

    it('keeps addresses attached to a deforming source curve and finds draggable positions', () => {
        const contour = straight(), address = { segmentId: 'edge', t: .25 };
        expect(outlinePositionPoint(contour, address)).toEqual({ x: 25, y: 0 });
        contour.lines[0].points[1].x = 200;
        expect(outlinePositionPoint(contour, address)).toEqual({ x: 50, y: 0 });
        const nearest = closestOutlinePosition(contour, { x: 75, y: 5 })!;
        expect(nearest.segmentId).toBe('edge'); expect(nearest.t).toBeCloseTo(.375, 5);
    });

    it('includes implicit closing edges, wrapped sections, and full loops', () => {
        const contour: RuntimeContourV1 = { id: 'box', closed: true, lines: [line('top', 0, 0, 100, 0), line('right', 100, 0, 100, 100), line('bottom', 100, 100, 0, 100)] };
        expect(outlineContourSegments(contour).map(line => line.id)).toEqual(['top', 'right', 'bottom', 'box:close']);
        const wrap: OutlineSection = { id: 'wrap', contourId: 'box', start: { segmentId: 'box:close', t: .5 }, end: { segmentId: 'top', t: .5 } };
        const projected = projectOutlineSections([contour], [wrap], { width: 10 });
        expect(projected.sections[0].length).toBeCloseTo(100, 5);
        expect(projected.sections[0].start.x).toBe(0); expect(projected.sections[0].end.x).toBe(50);
        expect(projectOutlineSections([contour], fullOutlineSections([contour]), { width: 10 }).sections[0].data.endsWith('Z')).toBeTrue();
    });

    it('explicitly open coincident endpoints stay open and have caps', () => {
        const contour = { id: 'loop', closed: false, lines: [line('out', 0, 0, 100, 0), line('back', 100, 0, 0, 0)] };
        expect(buildRuntimePathData([contour], false).endsWith('Z')).toBeFalse();
        expect(fullOutlineSections([contour])[0].fullContour).toBeUndefined();
    });

    it('samples independent smooth tapers on straight geometry and retains full-width untouched ends', () => {
        const contour = straight(), selected = section(contour);
        selected.startTaper = { length: .2, tipWidth: 0 };
        const result = vertices(projectOutlineSections([contour], [selected], { width: 10 }).strokeData);
        expect(result[0]).toEqual({ x: 0, y: 0 });
        expect(result.some(point => point.x > 0 && point.x < 20 && point.y > 0 && point.y < 5)).toBeTrue();
        expect(result.some(point => point.x === 100 && point.y === 5)).toBeTrue();
        selected.endTaper = { length: .3, tipWidth: .4 };
        const tapered = vertices(projectOutlineSections([contour], [selected], { width: 10 }).strokeData);
        expect(tapered.some(point => point.x === 100 && point.y === 2)).toBeTrue();
    });

    it('keeps taper attached to the complete section when reveal and dashes split it', () => {
        const contour = straight(), selected = { ...section(contour), startTaper: { length: .2, tipWidth: 0 }, endTaper: { length: .2, tipWidth: 0 } };
        const result = vertices(projectOutlineSections([contour], [selected], { width: 10, drawProgress: .5, dasharray: [10, 10] }).strokeData);
        expect(Math.max(...result.map(point => point.x))).toBe(50);
        expect(result.some(point => point.x === 50 && Math.abs(point.y) === 5)).toBeTrue();
        expect(result.some(point => point.x === 20 && Math.abs(point.y) === 5)).toBeTrue();
    });

    it('renders zero-length painted dashes as dots or squares and keeps butt dots invisible', () => {
        const contour = straight(), selected = section(contour);
        const round = projectOutlineSections([contour], [selected], { width: 10, dasharray: [0, 10], lineCap: 'round' });
        const square = projectOutlineSections([contour], [selected], { width: 10, dasharray: [0, 10], lineCap: 'square' });
        expect((round.strokeData.match(/M /g) ?? []).length).toBe(11);
        expect((square.strokeData.match(/M /g) ?? []).length).toBe(11);
        expect(vertices(round.strokeData).some(point => point.x === -5)).toBeTrue();
        expect(projectOutlineSections([contour], [selected], { width: 10, dasharray: [0, 10], lineCap: 'butt' }).strokeData).toBe('');
    });

    it('keeps long constant-width dashed lines compact and refuses unbounded dash expansion', () => {
        const contour = straight(); contour.lines[0].points[1].x = 10000;
        const compact = projectOutlineSections([contour], [section(contour)], { width: 2, dasharray: [1, 1] });
        expect(compact.problem).toBeUndefined(); expect(vertices(compact.strokeData).length).toBe(20000);
        const excessive = projectOutlineSections([contour], [section(contour)], { width: 2, dasharray: [.000001, .000001] });
        expect(excessive.problem).toContain('20,000'); expect(excessive.strokeData).toBe('');
    });

    it('retains an implicit closing-edge address when deformation collapses that edge', () => {
        const contour: RuntimeContourV1 = { id: 'collapsed', closed: true, lines: [line('out', 0, 0, 100, 0), line('back', 100, 0, 0, 0)] };
        const selected: OutlineSection = { id: 'range', contourId: contour.id, start: { segmentId: 'out', t: .5 }, end: { segmentId: 'collapsed:close', t: .5 } };
        expect(outlineContourSegments(contour).some(line => line.id === 'collapsed:close')).toBeTrue();
        expect(projectOutlineSections([contour], [selected], { width: 5 }).sections[0].length).toBe(150);
        expect(outlinePositionPoint(contour, selected.end)).toEqual({ x: 0, y: 0 });
    });

    it('allocates draw progress across authored visible sections rather than hidden gaps', () => {
        const contour = straight(), first = section(contour, 0, .2), second = { ...section(contour, .8, 1), id: 'second' };
        const verticesAtHalf = vertices(projectOutlineSections([contour], [first, second], { width: 4, drawProgress: .5 }).strokeData);
        expect(Math.max(...verticesAtHalf.map(point => point.x))).toBe(20);
        expect(projectOutlineSections([contour], [first, second], { width: 4, drawProgress: 0 }).strokeData).toBe('');
    });

    it('keeps rounded source corners in visible sections and derives source gradient bounds', () => {
        const contour: RuntimeContourV1 = { id: 'corner', closed: false, lines: [line('a', 0, 0, 100, 0), line('b', 100, 0, 100, 100)] };
        contour.lines[0].points[1].cornerRadius = 20; contour.lines[1].points[0].cornerRadius = 20;
        const projected = projectOutlineSections([contour], fullOutlineSections([contour]), { width: 10 });
        expect(projected.sections[0].data).toContain('C');
        expect(projected.sections[0].length).toBeLessThan(200);
        expect(projected.sourceBounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('supports butt, square and round caps, and miter, bevel and round joins', () => {
        const contour = straight(), selected = section(contour);
        const butt = vertices(projectOutlineSections([contour], [selected], { width: 10 }).strokeData);
        const square = vertices(projectOutlineSections([contour], [selected], { width: 10, lineCap: 'square' }).strokeData);
        const round = vertices(projectOutlineSections([contour], [selected], { width: 10, lineCap: 'round' }).strokeData);
        expect(Math.min(...butt.map(point => point.x))).toBe(0);
        expect(Math.min(...square.map(point => point.x))).toBe(-5);
        expect(Math.min(...round.map(point => point.x))).toBeCloseTo(-5, 1);
        contour.lines.push(line('vertical', 100, 0, 100, 100));
        const whole = fullOutlineSections([contour]);
        const miter = projectOutlineSections([contour], whole, { width: 10, lineJoin: 'miter' }).strokeData;
        const bevel = projectOutlineSections([contour], whole, { width: 10, lineJoin: 'bevel' }).strokeData;
        const rounded = projectOutlineSections([contour], whole, { width: 10, lineJoin: 'round' }).strokeData;
        expect(new Set([miter, bevel, rounded]).size).toBe(3);
    });

    it('handles empty, zero-length and compound sections without NaN output', () => {
        const contour = straight();
        expect(projectOutlineSections([contour], [], { width: 10 }).strokeData).toBe('');
        expect(projectOutlineSections([contour], [section(contour, .5, .5)], { width: 10 }).strokeData).toBe('');
        const other = { ...straight(), id: 'other' };
        const projected = projectOutlineSections([contour, other], fullOutlineSections([contour, other]), { width: 10 });
        expect(projected.sections.length).toBe(2); expect(projected.strokeData).not.toMatch(/NaN|Infinity/);
    });

    it('rejects malformed references, overlapping sections and crossing taper lengths', () => {
        const contour = straight(), selected = section(contour);
        expect(outlineSectionsProblem([contour], [selected])).toBeUndefined();
        expect(outlineSectionsProblem([contour], [selected, { ...selected, id: 'overlap' }])).toContain('overlap');
        expect(outlineSectionsProblem([contour], [{ ...selected, start: { segmentId: 'missing', t: 0 } }])).toContain('missing');
        expect(outlineSectionsProblem([contour], [{ ...selected, startTaper: { length: .6, tipWidth: 0 }, endTaper: { length: .5, tipWidth: 0 } }])).toContain('overlap');
        expect(outlineSectionsProblem([contour], [{ ...selected, startTaper: null } as unknown as OutlineSection])).toContain('taper');
        expect(outlineSectionsProblem([contour], [{ ...selected, fullContour: 'true' } as unknown as OutlineSection])).toContain('boolean');
    });
});
