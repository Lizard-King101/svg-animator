import { EditorService } from '../editor.service';
import { EditorPreferencesService } from '../editor-preferences.service';
import { SVG } from '../../editor/objects/svg.object';
import { Point } from '../../editor/objects/point.object';
import { Path } from '../../editor/objects/elements/path.object';
import { Shape } from '../../editor/objects/elements/shape.object';
import { Color } from '../../editor/objects/color.object';
import { PenTool } from './pen.tool';
import { applyDrawingPaint } from '../../editor/objects/drawing-paint';

describe('Drawing colors across creation tools', () => {
    const key = 'svg-animator.editor-preferences.v1';
    beforeEach(() => localStorage.removeItem(key));
    afterEach(() => localStorage.removeItem(key));
    function setup() {
        const preferences = new EditorPreferencesService(); preferences.setDrawingPaint({ fill: '#12345680', stroke: '#abcdef' });
        const editor = new EditorService(preferences), svg = new SVG(editor, { width: 800, height: 600, pos: new Point(0, 0) });
        editor.selectedSVG = svg;
        spyOn(editor, 'toCanvasPoint').and.callFake((x: number | Point, y?: number) => typeof x === 'number' ? new Point(x, y!) : x);
        return { editor, preferences, svg };
    }
    const mouse = (x: number, y: number) => new MouseEvent('click', { clientX: x, clientY: y, altKey: true });

    for(const kind of ['rectangle', 'ellipse']) it(`uses independent colors for ${kind}, preserving widths and existing artwork`, () => {
        const { editor, preferences, svg } = setup();
        const tool = editor.tools.flatMap(tool => tool.children).find(tool => tool.preferenceKey === kind)!;
        tool.down(mouse(10, 10)); tool.drag(mouse(100, 100)); tool.up(mouse(100, 100));
        const shape = svg.elements[0] as Shape;
        expect((shape.settings.fill as Color).serialized).toBe('#12345680');
        expect((shape.settings.stroke as Color).hex).toBe('#abcdef'); expect(shape.settings.stroke_width).toBe(3);
        const saved = shape.save();
        preferences.setDrawingPaint({ fill: null, stroke: '#111111' });
        expect(shape.save()).toEqual(saved);
        tool.down(mouse(200, 200)); tool.drag(mouse(250, 250)); tool.up(mouse(250, 250));
        expect((svg.elements[1] as Shape).settings.fill).toBeNull();
        expect(SVG.fromSave(svg.save(), editor).elements[0].save()).toEqual(saved);
    });

    it('captures Pen paints at the start and enables the fill only on closure', () => {
        const { editor, preferences, svg } = setup();
        const pen = editor.tools.flatMap(tool => tool.children).find(tool => tool instanceof PenTool) as PenTool;
        pen.click(mouse(10, 10)); pen.click(mouse(100, 10));
        const path = svg.elements[0] as Path;
        expect(path.settings.fill_enabled).toBeFalse(); expect((pen.tmpPath!.settings.stroke as Color).hex).toBe('#abcdef');
        preferences.setDrawingPaint({ fill: '#ff0000', stroke: null });
        pen.click(mouse(100, 100)); pen.click(mouse(10, 10));
        expect(path.closed).toBeTrue(); expect(path.settings.fill_enabled).toBeTrue();
        expect((path.settings.fill as Color).serialized).toBe('#12345680');
        expect((path.settings.stroke as Color).hex).toBe('#abcdef');
        expect(path.settings.stroke_width).toBe(2);
    });

    it('does not share mutable Color objects or change restore/model defaults', () => {
        const { editor, preferences } = setup(); const a = new Path(editor), b = new Path(editor);
        const baseline = b.save(); applyDrawingPaint(a.settings, preferences.drawingPaint);
        applyDrawingPaint(b.settings, preferences.drawingPaint);
        (a.settings.stroke as Color).hex = '#ff0000';
        expect((b.settings.stroke as Color).hex).toBe('#abcdef');
        expect(preferences.drawingPaint.stroke).toBe('#abcdef');
        expect(new Path(editor).save().settings.fill).toEqual(baseline.settings.fill);
    });
});
