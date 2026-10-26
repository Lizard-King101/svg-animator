import { fullOutlineSections, OutlineSection, projectOutlineSections } from '../../../packages/runtime/src/outline';
import { EditorPreferencesService } from '../_services/editor-preferences.service';
import { EditorService } from '../_services/editor.service';
import { Path } from './objects/elements/path.object';
import { Line } from './objects/line.object';
import { Point } from './objects/point.object';
import { effectiveStrokeAlignment } from './objects/stroke-style.object';
import { outlineGradientTransform, pathOutlineContours, projectPathOutline } from './path-outline';
import { resolvedOutlineSections, setOutlinePreview } from './outline-preview';

describe('cached authoring outline projection', () => {
    function fixture() {
        const editor = new EditorService(new EditorPreferencesService()), path = new Path(editor);
        const points = [new Point(0, 0), new Point(100, 0, undefined, 12), new Point(100, 100), new Point(0, 100)];
        path.lines = points.slice(0, -1).map((point, index) => new Line(editor, { points: [point, points[index + 1]] }));
        path.lines[2].type = 'bezier'; path.lines[2].controlStart = new Point(80, 120); path.lines[2].controlEnd = new Point(20, 80);
        path.closed = true; path.settings.stroke_width = 8;
        path.outlineSections = fullOutlineSections(pathOutlineContours(path));
        return path;
    }
    function direct(path: Path, sections: OutlineSection[] = path.outlineSections ?? [], rounded = true) {
        const settings = path.settings;
        return projectOutlineSections(pathOutlineContours(path), sections, {
            width: settings.stroke_width, alignment: effectiveStrokeAlignment(path), lineCap: settings.line_cap,
            lineJoin: settings.line_join, miterLimit: settings.stroke_miterlimit, dasharray: settings.stroke_dasharray,
            dashoffset: settings.stroke_dashoffset, drawProgress: path.drawProgress, rounded,
        });
    }

    it('reuses expanded curves for unchanged inputs, including unrelated UI and metadata edits', () => {
        const path = fixture(), projection = projectPathOutline(path);
        path.name = 'Renamed hair'; path.visible = false; path.opacity = .4; path.transform.translateX = 40;
        path.outlineSections = structuredClone(path.outlineSections);
        expect(projectPathOutline(path)).toBe(projection);
        expect(projectPathOutline(path)).toEqual(direct(path));
    });

    it('shares the expansion with gradient bounds without resampling any curves', () => {
        const path = fixture(), distances = spyOn(Math, 'hypot').and.callThrough();
        const projection = projectPathOutline(path);
        expect(distances.calls.count()).toBeGreaterThan(0);
        distances.calls.reset();
        outlineGradientTransform(path);
        expect(projectPathOutline(path)).toBe(projection);
        expect(distances).not.toHaveBeenCalled();
    });

    const geometryChanges: Array<[string, (path: Path) => void]> = [
        ['anchor position', path => path.lines[0].points[0].x += 15],
        ['handle position', path => path.lines[2].controlStart!.y += 25],
        ['corner radius', path => path.lines[0].points[1].cornerRadius = 20],
        ['anchor identity used by closing edges', path => path.lines[2].points[1].id = path.lines[0].points[0].id],
        ['contour closure', path => path.contours[0].closed = false],
        ['contour identity', path => path.contours[0].id += '-new'],
        ['segment identity', path => path.lines[0].id += '-new'],
        ['segment type', path => path.lines[2].type = 'line'],
        ['removed control', path => path.lines[2].controlEnd = undefined],
        ['segment order', path => path.lines.reverse()],
        ['incomplete segment', path => path.lines[0].points.pop()],
        ['added contour', path => path.contours.push({ id: 'extra', closed: false, lines: [path.lines[1]] })],
    ];
    for(const [name, change] of geometryChanges) it(`invalidates ${name} changes made in place`, () => {
        const path = fixture(), before = projectPathOutline(path), original = JSON.stringify(before);
        change(path);
        const after = projectPathOutline(path);
        expect(after).not.toBe(before);
        expect(after).toEqual(direct(path));
        expect(JSON.stringify(before)).toBe(original);
    });

    const styleChanges: Array<[string, (path: Path) => void]> = [
        ['width', path => path.settings.stroke_width = 20],
        ['alignment', path => path.settings.stroke_alignment = 'inside'],
        ['caps', path => path.settings.line_cap = 'round'],
        ['joins', path => path.settings.line_join = 'round'],
        ['miter limit', path => path.settings.stroke_miterlimit = 12],
        ['dash array', path => path.settings.stroke_dasharray.push(12, 4)],
        ['dash offset', path => path.settings.stroke_dashoffset = 3],
        ['draw progress', path => path.drawProgress = .5],
    ];
    for(const [name, change] of styleChanges) it(`invalidates ${name} edits`, () => {
        const path = fixture(), before = projectPathOutline(path);
        change(path);
        expect(projectPathOutline(path)).not.toBe(before);
        expect(projectPathOutline(path)).toEqual(direct(path));
    });

    it('follows in-place outline endpoint, taper and section edits without a mutation revision', () => {
        const path = fixture(), section = path.outlineSections![0];
        const changes = [
            () => section.start.t = .25,
            () => section.end.t = .8,
            () => section.fullContour = false,
            () => section.startTaper = { length: .2, tipWidth: 0 },
            () => section.startTaper!.tipWidth = .3,
            () => section.endTaper = { length: .25, tipWidth: .5 },
            () => section.end.segmentId = path.lines[1].id,
            () => section.id = 'renamed-section',
            () => path.outlineSections = [],
        ];
        for(const change of changes) {
            const before = projectPathOutline(path); change();
            expect(projectPathOutline(path)).not.toBe(before);
            expect(projectPathOutline(path)).toEqual(direct(path));
        }
    });

    it('uses current preview sections, cancels back to authored geometry, and follows deformation', () => {
        const path = fixture(), saved = path.save(), baseline = projectPathOutline(path);
        const preview = structuredClone(path.outlineSections!);
        preview[0].startTaper = { length: .2, tipWidth: 0 };
        setOutlinePreview(path, preview);
        const draft = projectPathOutline(path, resolvedOutlineSections(path));
        expect(draft).not.toBe(baseline);
        preview[0].startTaper!.length = .4;
        expect(projectPathOutline(path, resolvedOutlineSections(path))).toEqual(direct(path, preview));
        expect(projectPathOutline(path, resolvedOutlineSections(path))).not.toBe(draft);
        setOutlinePreview(path, undefined);
        expect(projectPathOutline(path, resolvedOutlineSections(path))).toEqual(baseline);
        expect(path.save()).toEqual(saved);
        // Rig playback mutates the existing points without committing a document revision.
        path.pathPoints().forEach(point => { point.x += point.y * .25; });
        expect(projectPathOutline(path)).toEqual(direct(path));
        expect(projectPathOutline(path).strokeData).not.toBe(baseline.strokeData);
    });

    it('retains separate rounded and unrounded variants and treats new path instances independently', () => {
        const path = fixture(), rounded = projectPathOutline(path), unrounded = projectPathOutline(path, path.outlineSections, false);
        expect(rounded.strokeData).not.toBe(unrounded.strokeData);
        expect(projectPathOutline(path)).toBe(rounded);
        expect(projectPathOutline(path, path.outlineSections, false)).toBe(unrounded);
        const restored = Path.fromSave(path.save(), new EditorService(new EditorPreferencesService()));
        expect(projectPathOutline(restored)).not.toBe(rounded);
        expect(projectPathOutline(restored)).toEqual(rounded);
    });
});
