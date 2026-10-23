import { EditorService } from '../../_services/editor.service';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { Group } from './elements/group.object';
import { Path } from './elements/path.object';
import { Shape } from './elements/shape.object';
import { combinedMatrixFor } from './element-bounds';
import { applyMatrix } from './transform.object';
import { Line } from './line.object';
import { Point } from './point.object';
import { SVG } from './svg.object';
import { PathSnapCandidate, PointSnapSession, pathSnapCandidates, pathSnapGeometry } from './path-snapping';

function setup() {
    const editor = new EditorService(new EditorPreferencesService());
    const svg = new SVG(editor, { width: 800, height: 600, pos: new Point(0, 0) }); svg.zoom = 1;
    return { editor, svg };
}
const target = (x: number, y: number, kind: PathSnapCandidate['kind'] = 'anchor'): PathSnapCandidate =>
    ({ id: `${x}:${y}:${kind}`, point: { x, y }, kind, label: kind });

describe('path snap geometry', () => {
    it('collects exact native ellipses with inherited transforms and the existing reference eligibility rules', () => {
        const { editor, svg } = setup();
        const ellipse = new Shape(editor, { type: 'ellipse', position: new Point(100, 100), width: 100, height: 60 });
        const parent = new Group(editor); parent.elements = [ellipse]; parent.transform.rotation = 35; parent.transform.scaleX = -2;
        ellipse.transform.rotation = 20; ellipse.locked = true; svg.elements = [parent];
        const matrix = combinedMatrixFor(svg.elements, ellipse), geometry = pathSnapGeometry(svg);
        expect(geometry.ellipses.length).toBe(1); expect(geometry.segments).toEqual([]);
        expect(geometry.ellipses[0].center).toEqual(applyMatrix(matrix, 150, 130));
        expect(geometry.ellipses[0].axisX).toEqual({ x: matrix.a * 50, y: matrix.b * 50 });
        parent.visible = false; expect(pathSnapGeometry(svg).ellipses).toEqual([]); parent.visible = true;
        parent.clipElementId = ellipse.id; expect(pathSnapGeometry(svg).ellipses).toEqual([]);
        parent.clipElementId = undefined; ellipse.settings.width = 0; expect(pathSnapGeometry(svg).ellipses).toEqual([]);
    });

    it('slides along interiors with screen-space hysteresis and upgrades to discrete crossings', () => {
        const { svg } = setup();
        for(const zoom of [.5, 1, 2]) {
            const session = new PointSnapSession([], svg, [
                { id: 'horizontal', label: 'Horizontal', start: { x: 100, y: 180 }, end: { x: 300, y: 180 } },
                { id: 'vertical', label: 'Vertical', start: { x: 200, y: 100 }, end: { x: 200, y: 250 } },
            ]);
            expect(session.update({ x: 130, y: 180 + 5 / zoom }, zoom).y).toBe(180);
            expect(session.feedback?.target?.kind).toBe('path');
            expect(session.update({ x: 160, y: 180 + 9 / zoom }, zoom).x).toBeCloseTo(160, 6);
            expect(session.feedback?.target?.point.y).toBe(180);
            expect(session.update({ x: 198, y: 179 }, zoom)).toEqual(jasmine.objectContaining({ x: 200, y: 180 }));
            expect(session.feedback?.target?.kind).toBe('intersection');
            expect(session.update({ x: 198, y: 179 }, zoom, true)).toEqual(jasmine.objectContaining({ x: 198, y: 179 }));
            expect(session.feedback).toBeUndefined();
            session.update({ x: 130, y: 180 + 5 / zoom }, zoom);
            expect(session.update({ x: 160, y: 180 + 11 / zoom }, zoom).y).toBe(180 + 11 / zoom);
            expect(session.feedback).toBeUndefined();
        }
    });

    it('queries transformed cubic interiors in canvas space and omits deforming segments', () => {
        const { editor, svg } = setup(); const path = new Path(editor), group = new Group(editor);
        path.lines = [new Line(editor, { type: 'bezier', points: [new Point(0, 0), new Point(100, 0)],
            controlStart: new Point(0, 100), controlEnd: new Point(100, 100) })];
        group.elements = [path]; group.transform = { translateX: 200, translateY: 200, scaleX: -2, scaleY: 1, rotation: 90, originX: 0, originY: 0 }; svg.elements = [group];
        const geometry = pathSnapGeometry(svg), session = new PointSnapSession(geometry.points, svg, geometry.segments);
        // Cubic t=.25 projects to (143.75,168.75); it is away from anchors/midpoint.
        const hit = session.update({ x: 143.75, y: 168.75 }, 1);
        expect(hit.x).toBeCloseTo(143.75, 2); expect(hit.y).toBeCloseTo(168.75, 2);
        expect(session.feedback?.target?.kind).toBe('path');
        expect(pathSnapGeometry(svg, { path, points: new Set([path.lines[0].points[0]]) }).segments).toEqual([]);
    });

    it('locks a whole point by radial screen distance, with hysteresis and immediate bypass', () => {
        const { svg } = setup();
        for(const zoom of [.5, 1, 2]) {
            const session = new PointSnapSession([target(160, 120)], svg);
            expect(session.update({ x: 160 - 6 / zoom, y: 120 }, zoom).x).toBe(160);
            expect(session.update({ x: 160 + 9 / zoom, y: 120 }, zoom).x).toBe(160);
            expect(session.update({ x: 160 + 11 / zoom, y: 120 }, zoom).x).toBe(160 + 11 / zoom);
            expect(session.feedback).toBeUndefined();
            session.update({ x: 158, y: 118 }, zoom);
            expect(session.update({ x: 158, y: 118 }, zoom, true).x).toBe(158);
            expect(session.feedback).toBeUndefined();
            expect(session.update({ x: 160 - 5 / zoom, y: 120 - 5 / zoom }, zoom).x).toBe(160 - 5 / zoom);
        }
    });

    it('prefers an anchor on exact ties and never combines axes from different point targets', () => {
        const { svg } = setup();
        const anchor = target(100, 120), midpoint = target(100, 120, 'midpoint');
        const session = new PointSnapSession([anchor, midpoint, target(104, 126)], svg);
        expect(session.update({ x: 101, y: 122 }, 1)).toEqual(jasmine.objectContaining({ x: 100, y: 120 }));
        expect(session.feedback?.target).toBe(anchor);
        expect(session.update({ x: 104, y: 125 }, 1)).toEqual(jasmine.objectContaining({ x: 100, y: 120 }));
    });

    it('falls back to locked guides and canvas center only when no path point is captured', () => {
        const { svg } = setup(); svg.guidesLocked = true; svg.guides = [{ id: 'g', axis: 'x', value: 100 }];
        const session = new PointSnapSession([target(104, 126)], svg);
        expect(session.update({ x: 101, y: 125 }, 1)).toEqual(jasmine.objectContaining({ x: 104, y: 126 }));
        expect(session.update({ x: 102, y: 299 }, 1)).toEqual(jasmine.objectContaining({ x: 100, y: 300 }));
        expect(session.feedback?.guides?.matches.length).toBe(2);
    });

    it('deduplicates shared anchors and projects cubic midpoints through nested transforms', () => {
        const { editor, svg } = setup();
        const path = new Path(editor), parent = new Group(editor);
        const a = new Point(0, 0), b = new Point(100, 0), c = new Point(100, 100);
        path.lines = [new Line(editor, { type: 'bezier', points: [a, b], controlStart: new Point(0, 100), controlEnd: new Point(100, 100) }), new Line(editor, { points: [b, c] })];
        parent.elements = [path]; parent.transform = { translateX: 200, translateY: 20, scaleX: -2, scaleY: 1, rotation: 90, originX: 0, originY: 0 }; svg.elements = [parent];
        const candidates = pathSnapCandidates(svg);
        expect(candidates.filter((item) => item.kind === 'anchor').length).toBe(3);
        const midpoint = candidates.find((item) => item.id.endsWith(path.lines[0].id))!;
        expect(midpoint.point.x).toBeCloseTo(125, 7); expect(midpoint.point.y).toBeCloseTo(-80, 7);
    });

    it('includes implicit closing edges and separate contours without welding coordinates', () => {
        const { editor, svg } = setup(); const path = new Path(editor);
        const a = new Point(20, 20), b = new Point(100, 20), c = new Point(100, 80);
        path.lines = [new Line(editor, { points: [a, b] }), new Line(editor, { points: [b, c] })]; path.closed = true;
        path.contours.push({ id: 'second', closed: false, lines: [new Line(editor, { points: [new Point(20, 20), new Point(200, 200)] })] }); svg.elements = [path];
        const candidates = pathSnapCandidates(svg);
        expect(candidates.filter((item) => item.kind === 'anchor').length).toBe(5);
        expect(candidates.find((item) => item.id.endsWith(':close'))?.point).toEqual({ x: 60, y: 50 });
    });

    it('excludes the moving anchor and connected midpoints while retaining stable parts of the same path', () => {
        const { editor, svg } = setup(); const path = new Path(editor);
        const a = new Point(20, 20), b = new Point(100, 20), c = new Point(100, 80);
        path.lines = [new Line(editor, { points: [a, b] }), new Line(editor, { points: [b, c] })]; svg.elements = [path];
        const candidates = pathSnapCandidates(svg, { path, points: new Set([a]) });
        expect(candidates.map((item) => item.id)).not.toContain(`${path.id}:anchor:${a.id}`);
        expect(candidates.filter((item) => item.kind === 'midpoint').map((item) => item.id)).toEqual([`${path.id}:midpoint:${path.lines[1].id}`]);
    });

    it('honors inherited visibility and clipping while allowing locked references and skipping rounded vertices', () => {
        const { editor, svg } = setup(); const path = new Path(editor), hidden = new Group(editor), clipped = new Group(editor);
        path.lines = [new Line(editor, { points: [new Point(20, 20), new Point(100, 80)] })]; path.locked = true;
        svg.elements = [path]; expect(pathSnapCandidates(svg).length).toBe(3);
        path.lines[0].points[0].cornerRadius = 10; expect(pathSnapCandidates(svg).length).toBe(1);
        hidden.elements = [path]; hidden.visible = false; svg.elements = [hidden]; expect(pathSnapCandidates(svg)).toEqual([]);
        clipped.elements = [path]; clipped.clipElementId = path.id; svg.elements = [clipped]; expect(pathSnapCandidates(svg)).toEqual([]);
    });
});
