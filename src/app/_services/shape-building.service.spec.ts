import { NgZone } from '@angular/core';
import { EditorService } from './editor.service';
import { EditorPreferencesService } from './editor-preferences.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { HistoryService } from './history.service';
import { ProjectService } from './project.service';
import { LayerOperationsService } from './layer-operations.service';
import { ElementFactory } from './element-factory.service';
import { ShapeBuildingService } from './shape-building.service';
import { ShapeBuildingControlsComponent } from '../_components/shape-building-controls/shape-building-controls.component';
import { ShapeBuildingTool } from './tools/shape-building.tool';
import { SVG } from '../editor/objects/svg.object';
import { Point } from '../editor/objects/point.object';
import { Path } from '../editor/objects/elements/path.object';
import { Shape } from '../editor/objects/elements/shape.object';
import { Group } from '../editor/objects/elements/group.object';
import { Line } from '../editor/objects/line.object';
import { ConstructionNetwork } from '../editor/objects/construction-network';
import { constructionSources } from '../editor/objects/construction-sources';
import { combinedMatrixFor } from '../editor/objects/element-bounds';
import { applyMatrix } from '../editor/objects/transform.object';
import { buildSVGMarkup } from '../editor/svg-markup';

const mouse = (x: number, y: number) => new MouseEvent('click', { clientX: x, clientY: y });
function setup() {
    const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
    const svg = new SVG(editor, { width: 800, height: 600, pos: new Point(0, 0) }); svg.zoom = 1; editor.selectedSVG = svg;
    spyOn(editor, 'toCanvasPoint').and.callFake((x: number | Point, y?: number) => typeof x === 'number' ? new Point(x, y!) : x);
    const animation = new AnimationPlaybackService(editor, new NgZone({ enableLongStackTrace: false }), preferences); animation.mode = 'edit';
    const projects = jasmine.createSpyObj<ProjectService>('projects', ['upsert', 'get']);
    const mutations = new DocumentMutationService(editor, animation, new HistoryService(), projects);
    const factory = new ElementFactory(editor), layers = new LayerOperationsService(editor, factory);
    const building = new ShapeBuildingService(editor, animation, mutations, layers, factory);
    const rect = new Shape(editor, { type: 'rectangle', position: new Point(100, 100), width: 200, height: 200 });
    const divider = new Path(editor); divider.lines = [new Line(editor, { points: [new Point(50, 200), new Point(350, 200)] })];
    svg.elements = [rect, divider]; svg.snapshot(); mutations.resetBaseline();
    const destroy = () => { building.ngOnDestroy(); mutations.ngOnDestroy(); animation.ngOnDestroy(); };
    return { preferences, editor, svg, animation, projects, mutations, building, rect, divider, destroy };
}

describe('shape creation and trim commands', () => {
    it('uses drawing paints for built regions without recoloring sources, and restores them on redo', () => {
        const t = setup(), original = t.preferences.drawingPaint;
        try {
            t.preferences.setDrawingPaint({ fill: '#12345680', stroke: null });
            const before = t.rect.save(); t.building.activate('regions');
            t.building.click(mouse(150, 150)); t.building.create();
            const path = t.svg.elements[2] as Path;
            expect(path.settings.fill_enabled).toBeTrue(); expect(path.settings.stroke).toBeNull();
            expect(path.save().settings.fill).toBe('#12345680'); expect(t.rect.save()).toEqual(before);
            expect(t.projects.upsert).toHaveBeenCalledTimes(1);
            const saved = path.save(); t.mutations.undo(); expect(t.svg.elements.length).toBe(2);
            t.mutations.redo(); expect(t.svg.elements[2].save()).toEqual(saved);
        } finally { t.preferences.setDrawingPaint(original); t.destroy(); }
    });
    for(const createRegion of [false, true]) for(const reverseLines of [false, true]) for(const rightFirst of [false, true]) {
        it(`trims both circle exteriors into compact semicircles (reverse lines: ${reverseLines}, right first: ${rightFirst}, region: ${createRegion})`, () => {
            const t = setup();
            try {
                const circles = [150, 450].map(x => new Shape(t.editor, { type: 'ellipse', position: new Point(x, 150.5), width: 200, height: 200 }));
                t.svg.elements = [...circles];
                for(const y of [150.5, 350.5]) {
                    const line = new Path(t.editor), points = [new Point(250, y), new Point(550, y)];
                    line.lines = [new Line(t.editor, { points: reverseLines ? points.reverse() : points })]; t.svg.elements.push(line);
                }
                t.svg.snapshot(); t.mutations.resetBaseline();
                if(createRegion) { t.building.activate('regions'); t.building.click(mouse(400, 250.5)); t.building.create(); }
                expect(t.svg.elements.length).toBe(createRegion ? 5 : 4);
                const built = t.svg.elements.at(-1)!.save();
                t.building.activate('trim');
                for(const index of rightFirst ? [1, 0] : [0, 1]) {
                    t.building.click(mouse(index ? 650 : 150, 250.5));
                    const path = t.editor.findElement(circles[index].id) as Path | undefined;
                    expect(path instanceof Path).toBeTrue();
                    if(!path) continue;
                    expect(path.contours.length).toBe(1); expect(path.closed).toBeFalse();
                    expect(path.lines.length).toBe(2);
                    expect(t.svg.elements.at(-1)!.save()).toEqual(built);
                }
                expect(t.svg.elements.length).toBe(createRegion ? 5 : 4);
                expect(t.projects.upsert).toHaveBeenCalledTimes(createRegion ? 3 : 2);
                t.mutations.undo(); expect(t.editor.findElement(circles[rightFirst ? 0 : 1].id) instanceof Shape).toBeTrue();
                t.mutations.redo(); expect((t.editor.findElement(circles[rightFirst ? 0 : 1].id) as Path)?.lines.length).toBe(2);
            } finally { t.destroy(); }
        });
    }
    it('previews/selects regions without saving, unions adjacent regions once, retains sources, and undoes/redoes', () => {
        const t = setup();
        try {
            const before = t.svg.save(); t.building.activate('regions');
            t.building.move(mouse(150, 150)); expect(t.building.preview).not.toBe('');
            t.building.click(mouse(150, 150)); t.building.click(mouse(150, 250));
            expect(t.building.chosen.size).toBe(2); expect(t.svg.save()).toEqual(before); expect(t.projects.upsert).not.toHaveBeenCalled();
            t.building.create(); expect(t.svg.elements.length).toBe(3); expect(t.projects.upsert).toHaveBeenCalledTimes(1);
            const shape = t.svg.elements[2] as Path;
            expect(shape.contours.length).toBe(1); expect(shape.closed).toBeTrue(); expect(shape.settings.fill_enabled).toBeTrue();
            const network = new ConstructionNetwork([{ id: shape.id, data: shape.raw }]);
            try { expect(network.regions[0].area).toBeCloseTo(40000, 4); } finally { network.dispose(); }
            expect(t.rect.save()).toEqual(before.elements[0] as any);
            t.mutations.undo(); expect(t.svg.elements.length).toBe(2); expect(t.building.chosen.size).toBe(0);
            t.mutations.redo(); expect(t.svg.elements.length).toBe(3);
            expect(buildSVGMarkup(t.svg)).toContain('<path');
        } finally { t.destroy(); }
    });
    it('trims the interior of an open line into two editable contours, preserves its identity, and commits once', () => {
        const t = setup();
        try {
            t.building.activate('trim'); t.building.click(mouse(200, 200));
            const path = t.svg.elements[1] as Path;
            expect(path.id).toBe(t.divider.id); expect(path.contours.length).toBe(2);
            expect(path.contours.every(contour => !contour.closed)).toBeTrue();
            expect(t.projects.upsert).toHaveBeenCalledTimes(1);
            t.mutations.undo(); expect((t.svg.elements[1] as Path).contours.length).toBe(1);
            t.mutations.redo(); expect((t.svg.elements[1] as Path).contours.length).toBe(2);
        } finally { t.destroy(); }
    });
    it('converts a trimmed native ellipse to an open editable cubic path and preserves the other outlines', () => {
        const t = setup();
        try {
            const circle = new Shape(t.editor, { type: 'ellipse', position: new Point(100, 100), width: 200, height: 200 });
            t.svg.elements[0] = circle; t.svg.snapshot(); t.mutations.resetBaseline();
            t.building.activate('trim'); t.building.click(mouse(200, 100));
            const path = t.editor.findElement(circle.id) as Path;
            expect(path instanceof Path).toBeTrue(); expect(path.id).toBe(circle.id);
            expect(path.contours.length).toBe(1); expect(path.closed).toBeFalse();
            expect(path.lines.some(line => line.type === 'bezier')).toBeTrue();
            expect(t.svg.elements[1]).toBe(t.divider);
            t.mutations.undo(); expect(t.svg.elements[0] instanceof Shape).toBeTrue();
        } finally { t.destroy(); }
    });
    it('keeps non-cardinal ellipse cuts compact and tangent under nested reflection, rotation, and stretch', () => {
        const t = setup();
        try {
            const ellipse = new Shape(t.editor, { type: 'ellipse', position: new Point(100, 150), width: 200, height: 100 });
            const angle = .37, at = (a: number, scale = 1) => new Point(200 + scale * 100 * Math.cos(a), 200 + scale * 50 * Math.sin(a));
            t.divider.lines = [new Line(t.editor, { points: [at(angle, -2), at(angle, 2)] })];
            const group = new Group(t.editor); group.transform.rotation = 31; group.transform.scaleX = -1.4; group.transform.scaleY = .8;
            group.elements = [ellipse, t.divider]; t.svg.elements = [group];
            const local = at(angle + Math.PI / 2), target = applyMatrix(combinedMatrixFor(t.svg.elements, ellipse), local.x, local.y);
            const dividerBefore = constructionSources(t.svg).find(source => source.id === t.divider.id)!.data;
            t.svg.snapshot(); t.mutations.resetBaseline(); t.building.activate('trim'); t.building.click(mouse(target.x, target.y));
            const path = t.editor.findElement(ellipse.id) as Path;
            expect(path instanceof Path).toBeTrue(); expect(path.closed).toBeFalse(); expect(path.lines.length).toBe(2);
            const endpoints = [path.lines[0].points[0], path.lines.at(-1)!.points[1]];
            for(const endpoint of endpoints) {
                expect(Math.min(...[at(angle), at(angle + Math.PI)].map(p => Math.hypot(p.x - endpoint.x, p.y - endpoint.y)))).toBeLessThan(1e-5);
            }
            for(const [anchor, handle] of [[endpoints[0], path.lines[0].controlStart!], [endpoints[1], path.lines.at(-1)!.controlEnd!]]) {
                const normal = { x: (anchor.x - 200) / 10000, y: (anchor.y - 200) / 2500 };
                expect(Math.abs(normal.x * (handle.x - anchor.x) + normal.y * (handle.y - anchor.y))).toBeLessThan(1e-6);
            }
            expect(constructionSources(t.svg).find(source => source.id === t.divider.id)!.data).toBe(dividerBefore);
            expect(t.projects.upsert).toHaveBeenCalledTimes(1);
            t.mutations.undo(); expect(t.editor.findElement(ellipse.id) instanceof Shape).toBeTrue();
            t.mutations.redo(); expect((t.editor.findElement(ellipse.id) as Path).lines.length).toBe(2);
        } finally { t.destroy(); }
    });
    it('preserves nested transforms when trimming and finds the region between two circles and common tangent lines', () => {
        const t = setup();
        try {
            const group = new Group(t.editor); group.transform.translateX = 40; group.transform.scaleX = -1; group.transform.rotation = 20;
            group.elements = [t.rect, t.divider]; t.svg.elements = [group];
            const reference = constructionSources(t.svg).find(source => source.id === t.rect.id)!;
            const point = applyMatrix(combinedMatrixFor(t.svg.elements, t.divider), 200, 200);
            t.svg.snapshot(); t.mutations.resetBaseline();
            t.building.activate('trim'); t.building.click(mouse(point.x, point.y));
            expect((group.elements[1] as Path).contours.length).toBe(2);
            expect(constructionSources(t.svg).find(source => source.id === t.rect.id)!.data).toBe(reference.data);
            t.svg.elements = [new Shape(t.editor, { type: 'ellipse', position: new Point(50, 50), width: 100, height: 100 }),
                new Shape(t.editor, { type: 'ellipse', position: new Point(250, 50), width: 100, height: 100 })];
            for(const y of [50, 150]) { const line = new Path(t.editor); line.lines = [new Line(t.editor, { points: [new Point(100, y), new Point(300, y)] })]; t.svg.elements.push(line); }
            t.building.activate('regions'); t.building.click(mouse(200, 100));
            expect(t.building.chosen.size).toBe(1); t.building.create();
            expect(t.svg.elements.length).toBe(5); expect(t.building.error).toBe('');
        } finally { t.destroy(); }
    });
    it('keeps a ring hole through region creation and skips hidden, locked, and masked geometry', () => {
        const t = setup();
        try {
            const inner = new Shape(t.editor, { type: 'rectangle', position: new Point(150, 150), width: 100, height: 100 });
            t.divider.locked = true; t.svg.elements.push(inner);
            t.svg.snapshot(); t.mutations.resetBaseline();
            t.building.activate('regions'); t.building.click(mouse(120, 120)); t.building.create();
            const path = t.svg.elements.at(-1) as Path;
            expect(path.contours.length).toBe(2); expect(path.fillRule).toBe('evenodd');
            const network = new ConstructionNetwork([{ id: path.id, data: path.raw }]);
            try { expect(network.regionAt({ x: 120, y: 120 })?.area).toBeCloseTo(30000, 4); } finally { network.dispose(); }
            const group = new Group(t.editor); group.elements = [inner]; group.visible = false;
            t.svg.elements = [group, t.divider]; expect(constructionSources(t.svg)).toEqual([]);
        } finally { t.destroy(); }
    });
    it('supports selection-only scope, cancellation, document/mode changes, and focused keyboard completion', () => {
        const t = setup(); const controls = new ShapeBuildingControlsComponent(t.building, t.editor);
        try {
            t.editor.selectedElement = t.rect;
            const tool = t.editor.tools.flatMap(tool => tool.children).find(tool => tool instanceof ShapeBuildingTool && tool.mode === 'regions')!;
            tool.restoreSelection(); t.building.setSelectionOnly(true);
            t.building.click(mouse(150, 150)); expect(t.building.chosen.size).toBe(1);
            const button = document.createElement('button'); document.body.appendChild(button);
            button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); button.remove();
            expect(t.projects.upsert).not.toHaveBeenCalled();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(t.building.chosen.size).toBe(0);
            t.building.click(mouse(150, 150)); t.animation.mode = 'animate'; t.building.create(); expect(t.projects.upsert).not.toHaveBeenCalled();
            t.animation.mode = 'edit'; t.building.click(mouse(150, 150)); t.editor.selectedSVG = undefined; t.building.create();
            expect(t.projects.upsert).not.toHaveBeenCalled();
        } finally { controls.ngOnDestroy(); t.destroy(); }
    });
});
