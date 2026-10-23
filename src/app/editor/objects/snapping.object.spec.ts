import { EditorService } from '../../_services/editor.service';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { Group } from './elements/group.object';
import { Shape } from './elements/shape.object';
import { Point } from './point.object';
import { SVG } from './svg.object';
import { MoveSnapCandidate, MoveSnapSession, moveSnapCandidates, snapPoint } from './snapping.object';

const candidate = (value: number, axis: 'x' | 'y' = 'x', source: MoveSnapCandidate['source'] = 'guide'): MoveSnapCandidate =>
    ({ id: `${axis}:${value}`, axis, value, source, label: 'Guide', extent: [0, 300] });
const bounds = { x: 20, y: 30, width: 40, height: 20 };

describe('move snapping geometry', () => {
    it('acquires and releases at consistent screen distances at different zoom levels', () => {
        for(const zoom of [.5, 1, 2]) {
            const session = new MoveSnapSession({ ...bounds, width: 200 }, [candidate(100)]);
            expect(session.update({ x: 80 - 6 / zoom, y: 0 }, zoom).x).toBe(80);
            expect(session.update({ x: 80 + 9 / zoom, y: 0 }, zoom).x).toBe(80);
            const released = 80 + 11 / zoom;
            expect(session.update({ x: released, y: 0 }, zoom).x).toBe(released);
            expect(session.feedback).toBeUndefined();
        }
    });

    it('keeps a captured target instead of flickering to a nearer one until release', () => {
        const session = new MoveSnapSession(bounds, [candidate(100), candidate(108)]);
        expect(session.update({ x: 78, y: 0 }, 1).x).toBe(80);
        expect(session.update({ x: 87, y: 0 }, 1).x).toBe(80);
        expect(session.update({ x: 91, y: 0 }, 1).x).toBe(88);
    });

    it('matches both axes, prioritizes guide ties, and clears locks during bypass or return to start', () => {
        const session = new MoveSnapSession(bounds, [candidate(100), candidate(100, 'x', 'geometry'), candidate(120, 'y')]);
        expect(session.update({ x: 38, y: 89 }, 1)).toEqual({ x: 40, y: 90 });
        expect(session.feedback?.matches.map((hit) => [hit.candidate.source, hit.feature])).toEqual([['guide', 'end'], ['guide', 'start']]);
        expect(session.update({ x: 38, y: 89 }, 1, true)).toEqual({ x: 38, y: 89 });
        expect(session.feedback).toBeUndefined();
        expect(session.update({ x: 38, y: 89 }, 1)).toEqual({ x: 40, y: 90 });
        expect(session.update({ x: 0, y: 0 }, 1)).toEqual({ x: 0, y: 0 });
        expect(session.feedback).toBeUndefined();
    });

    it('excludes the moving subtree and its ancestors, but includes visible locked references and offset canvas bounds', () => {
        const editor = new EditorService(new EditorPreferencesService());
        const svg = new SVG(editor, { width: 400, height: 300, pos: new Point(0, 0) });
        svg.viewBoxX = -80; svg.viewBoxY = 10;
        svg.guides = [{ id: 'guide', axis: 'x', value: 25 }]; svg.guidesLocked = true;
        const moving = new Group(editor), parent = new Group(editor), hidden = new Group(editor);
        const shape = () => new Shape(editor, { type: 'rectangle', position: new Point(10, 20), width: 30, height: 40 });
        const child = shape(), sibling = shape(), hiddenChild = shape();
        moving.elements = [child]; parent.elements = [moving, sibling]; parent.transform.translateX = 7;
        sibling.locked = true; hidden.visible = false; hidden.elements = [hiddenChild];
        svg.elements = [parent, hidden];
        const candidates = moveSnapCandidates(svg, [moving]);
        const targets = candidates.filter((c) => c.source === 'geometry');
        expect(targets.length).toBe(6);
        expect(targets.every((c) => c.id.startsWith(`object:${sibling.id}:`))).toBeTrue();
        expect(targets.find((c) => c.id.endsWith('x:start'))?.value).toBe(17);
        expect(candidates.find((c) => c.id === 'canvas:x:center')?.value).toBe(120);
        expect(candidates[0].id).toBe('guide:guide');
        expect(snapPoint(svg, new Point(23, 93)).point.x).toBe(25);
        expect(snapPoint(svg, new Point(23, 93), { ignore: true }).point.x).toBe(23);
    });

    it('treats clipped compositions as one target without attracting moves to hidden mask edges', () => {
        const editor = new EditorService(new EditorPreferencesService());
        const svg = new SVG(editor, { width: 400, height: 300, pos: new Point(0, 0) });
        const group = new Group(editor);
        const clip = new Shape(editor, { type: 'rectangle', position: new Point(10, 20), width: 40, height: 30 });
        const artwork = new Shape(editor, { type: 'rectangle', position: new Point(0, 0), width: 200, height: 200 });
        group.elements = [clip, artwork]; group.clipElementId = clip.id; svg.elements = [group];
        const targets = moveSnapCandidates(svg, []).filter((c) => c.source === 'geometry');
        expect(targets.length).toBe(6);
        expect(targets[0].target).toEqual({ x: 10, y: 20, width: 40, height: 30 });
        expect(targets.every((c) => c.id.startsWith(`object:${group.id}:`))).toBeTrue();
    });
});
