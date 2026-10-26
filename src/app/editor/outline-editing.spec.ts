import { OutlineSection, outlinePositionPoint, outlineSectionsProblem } from '../../../packages/runtime/src/outline';
import { EditorPreferencesService } from '../_services/editor-preferences.service';
import { EditorService } from '../_services/editor.service';
import { Path } from './objects/elements/path.object';
import { Line } from './objects/line.object';
import { Point } from './objects/point.object';
import { editOutlineTaper, fullOutlineSections, moveOutlineEndpoint, outlinePositionFromValue, outlinePositionValue, outlineSectionSpan, setOutlineSegmentsVisible } from './outline-editing';
import { pathOutlineContour } from './path-outline';

function setup(closed = true) {
    const editor = new EditorService(new EditorPreferencesService()), path = new Path(editor);
    const points = [new Point(0, 0), new Point(100, 0), new Point(100, 100), new Point(0, 100)];
    path.lines = points.slice(0, 3).map((point, i) => new Line(editor, {points: [point, points[i + 1]]}));
    path.closed = closed;
    const id = () => editor.ID, contour = path.contours[0];
    return { editor, path, contour, id, full: fullOutlineSections(path, id), position: (value: number) => outlinePositionFromValue(contour, value) };
}
describe('outline authoring intervals', () => {
    it('hides two seams while preserving a closed fill and the original point IDs', () => {
        const t = setup(), before = t.path.save();
        const sections = setOutlineSegmentsVisible(t.path, t.full, new Set([t.path.lines[0].id, t.path.lines[2].id]), false, t.id);
        expect(sections.length).toBe(2);
        expect(sections.map(section => outlineSectionSpan(t.contour, section))).toEqual([[1, 2], [3, 4]]);
        expect(t.path.save()).toEqual(before);
    });
    it('retains a continuous section across the implicit closing edge', () => {
        const t = setup();
        const sections = setOutlineSegmentsVisible(t.path, t.full, new Set([t.path.lines[1].id]), false, t.id);
        expect(sections.length).toBe(1);
        expect(outlineSectionSpan(t.contour, sections[0])).toEqual([2, 5]);
        expect(sections[0].fullContour).toBeFalse();
    });
    it('shows a hidden segment by merging adjacent sections without creating overlap', () => {
        const t = setup(), hidden = setOutlineSegmentsVisible(t.path, t.full, new Set([t.path.lines[1].id]), false, t.id);
        const shown = setOutlineSegmentsVisible(t.path, hidden, new Set([t.path.lines[1].id]), true, t.id);
        expect(shown.length).toBe(1); expect(shown[0].fullContour).toBeTrue();
        expect(outlineSectionSpan(t.contour, shown[0])).toEqual([0, 4]);
    });
    it('keeps Show on a fully visible contour a no-op', () => {
        const t = setup();
        expect(setOutlineSegmentsVisible(t.path, t.full, new Set([t.path.lines[1].id]), true, t.id)).toEqual(t.full);
    });
    it('preserves adjacent authored sections and their tapered boundary when showing a different gap', () => {
        const t = setup(false);
        const sections: OutlineSection[] = [{id: 'first', contourId: t.contour.id, start: t.position(0), end: t.position(1), endTaper: {length: .2, tipWidth: 0}},
            {id: 'second', contourId: t.contour.id, start: t.position(1), end: t.position(2), startTaper: {length: .2, tipWidth: 0}}];
        const result = setOutlineSegmentsVisible(t.path, sections, new Set([t.path.lines[2].id]), true, t.id);
        expect(result.length).toBe(2); expect(result[0]).toEqual({...sections[0], fullContour: false});
        expect(result[1].id).toBe('second'); expect(result[1].startTaper).toEqual(sections[1].startTaper);
        expect(outlineSectionSpan(t.contour, result[1])).toEqual([1, 3]);
    });
    it('edits the implicit closing segment without adding an anchor', () => {
        const t = setup();
        const hidden = setOutlineSegmentsVisible(t.path, t.full, new Set([`${t.contour.id}:close`]), false, t.id);
        expect(outlineSectionSpan(t.contour, hidden[0])).toEqual([0, 3]);
        expect(t.path.lines.length).toBe(3);
    });
    it('retains closing-edge addresses and interval lengths when deformation collapses the edge', () => {
        const t = setup(), last = t.path.lines[2].points[1], first = t.path.lines[0].points[0];
        const closeId = `${t.contour.id}:close`, originalIds = t.path.pathPoints().map(point => point.id);
        last.x = first.x; last.y = first.y;
        expect(last.id).not.toBe(first.id);
        expect(outlineSectionSpan(t.contour, t.full[0])).toEqual([0, 4]);
        expect(outlinePositionValue(t.contour, { segmentId: closeId, t: .5 })).toBe(3.5);
        expect(t.position(3.5)).toEqual({ segmentId: closeId, t: .5 });
        const trimmed = moveOutlineEndpoint(t.contour, t.full, t.full[0].id, 'end', t.position(3.5));
        expect(outlineSectionSpan(t.contour, trimmed[0])).toEqual([0, 3.5]);
        expect(outlineSectionsProblem([pathOutlineContour(t.contour)], trimmed)).toBeUndefined();
        expect(outlinePositionPoint(pathOutlineContour(t.contour), trimmed[0].end)).toEqual({ x: 0, y: 0 });
        const hidden = setOutlineSegmentsVisible(t.path, t.full, new Set([closeId]), false, t.id);
        expect(outlineSectionSpan(t.contour, hidden[0])).toEqual([0, 3]);
        const restored = setOutlineSegmentsVisible(t.path, hidden, new Set([closeId]), true, t.id);
        expect(outlineSectionSpan(t.contour, restored[0])).toEqual([0, 4]);
        last.y = 100;
        expect(trimmed[0].end).toEqual({ segmentId: closeId, t: .5 });
        expect(outlinePositionPoint(pathOutlineContour(t.contour), trimmed[0].end)).toEqual({ x: 0, y: 50 });
        expect(t.path.pathPoints().map(point => point.id)).toEqual(originalIds);
    });
    it('retains the untouched taper and resets newly exposed cut ends', () => {
        const t = setup(false), section = t.full[0];
        section.startTaper = {length: .2, tipWidth: .1}; section.endTaper = {length: .3, tipWidth: .4};
        const cut = setOutlineSegmentsVisible(t.path, t.full, new Set([t.path.lines[1].id]), false, t.id);
        expect(cut.length).toBe(2);
        expect(cut[0].startTaper).toEqual(section.startTaper); expect(cut[0].endTaper).toEqual({length: 0, tipWidth: 1});
        expect(cut[1].endTaper).toEqual(section.endTaper); expect(cut[1].startTaper).toEqual({length: 0, tipWidth: 1});
        expect(cut[0].id).not.toBe(cut[1].id);
    });
    it('clamps endpoints at neighbouring visible sections and its own opposite end', () => {
        const t = setup(false);
        const sections: OutlineSection[] = [{id: 'a', contourId: t.contour.id, start: t.position(.2), end: t.position(1)},
            {id: 'b', contourId: t.contour.id, start: t.position(2), end: t.position(2.8)}];
        const next = moveOutlineEndpoint(t.contour, sections, 'a', 'end', t.position(2.5));
        expect(outlineSectionSpan(t.contour, next[0])).toEqual([.2, 2]);
        const zero = moveOutlineEndpoint(t.contour, next, 'a', 'start', t.position(2.4));
        expect(outlineSectionSpan(t.contour, zero[0])).toEqual([2, 2]);
        expect(sections[0].end).toEqual(t.position(1));
    });
    it('supports continuous dragging beyond half a closed contour', () => {
        const t = setup(); let sections = t.full;
        for(const value of [.5, 1, 1.5, 2, 2.5, 3]) sections = moveOutlineEndpoint(t.contour, sections, sections[0].id, 'start', t.position(value));
        expect(outlineSectionSpan(t.contour, sections[0])).toEqual([3, 4]);
    });
    it('clamps the edited taper against the other end and leaves it unchanged', () => {
        const t = setup(), section = t.full[0]; section.endTaper = {length: .8, tipWidth: .4};
        editOutlineTaper(section, 'start', 'length', .7); editOutlineTaper(section, 'start', 'tipWidth', -2);
        expect(section.startTaper!.length).toBeCloseTo(.2); expect(section.startTaper!.tipWidth).toBe(0);
        expect(section.endTaper).toEqual({length: .8, tipWidth: .4});
    });
    it('preserves missing versus explicitly empty metadata across save/reopen', () => {
        const t = setup(); expect(t.path.save().outlineSections).toBeUndefined();
        t.path.outlineSections = [];
        expect(Path.fromSave(t.path.save(), t.editor).outlineSections).toEqual([]);
        t.path.outlineSections = t.full; const restored = Path.fromSave(t.path.save(), t.editor);
        restored.outlineSections![0].start.t = .4;
        expect(t.path.outlineSections[0].start.t).toBe(0);
    });
});
