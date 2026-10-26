import { NgZone } from '@angular/core';
import { EditorPreferencesService } from '../editor-preferences.service';
import { EditorService } from '../editor.service';
import { AnimationPlaybackService } from '../animation-playback.service';
import { DocumentMutationService } from '../document-mutation.service';
import { HistoryService } from '../history.service';
import { ProjectService } from '../project.service';
import { Path } from '../../editor/objects/elements/path.object';
import { Group } from '../../editor/objects/elements/group.object';
import { Line } from '../../editor/objects/line.object';
import { Point } from '../../editor/objects/point.object';
import { SVG } from '../../editor/objects/svg.object';
import { createDefaultAnimation } from '../../editor/objects/animation.object';
import { createPathBinding, pathTopology } from '../../editor/rig-binding';
import { pathTopologyProblem } from '../../editor/path-topology';
import { breakPathAtAnchor, closePathContour, insertPathPoint } from './path-edit.helpers';
import { SelectTool } from './select.tool';
import { createDocumentEnvelope, migrateDocument } from '../../editor/migrations/document-migrations';

function setup(closed = true) {
    const preferences = new EditorPreferencesService(), editor = new EditorService(preferences);
    const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0, 0) });
    const path = new Path(editor), a = new Point(10, 10), b = new Point(100, 10), c = new Point(100, 100);
    path.lines = [new Line(editor, { type: 'bezier', points: [a, b], controlStart: new Point(30, 0), controlEnd: new Point(80, 30) }),
        new Line(editor, { points: [b, c] })];
    path.closed = closed;
    svg.elements = [path]; editor.selectedSVG = svg; editor.selectedElement = path;
    return { editor, preferences, svg, path, a, b, c, line: (options: ConstructorParameters<typeof Line>[1]) => new Line(editor, options) };
}

describe('path topology and outline safety', () => {
    it('opens at an interior anchor while retaining every curve and the implicit closing edge', () => {
        const t = setup(), curve = t.path.lines[0], controls = [curve.controlStart, curve.controlEnd];
        expect(breakPathAtAnchor(t.path, t.b, t.line).changed).toBeTrue();
        expect(t.path.closed).toBeFalse();
        expect(t.path.lines.length).toBe(3);
        expect(t.path.lines[2]).toBe(curve); expect([curve.controlStart, curve.controlEnd]).toEqual(controls);
        const start = t.path.lines[0].points[0], end = t.path.lines[2].points[1];
        expect([start.x, start.y]).toEqual([end.x, end.y]); expect(start.id).not.toBe(end.id); expect(start).not.toBe(end);
        expect(t.path.raw).not.toContain('Z'); expect(t.path.rawUnrounded).not.toContain('Z');
        end.x += 8; expect(start.x).toBe(100);
        expect(closePathContour(t.path, t.path.contours[0]).changed).toBeTrue();
        expect(t.path.raw).toContain('Z');
    });

    it('breaks an open curve into two contours with independently editable coincident endpoints', () => {
        const t = setup(false), first = t.path.lines[0], second = t.path.lines[1];
        expect(breakPathAtAnchor(t.path, t.a, t.line).changed).toBeFalse();
        expect(breakPathAtAnchor(t.path, t.b, t.line).changed).toBeTrue();
        expect(t.path.contours.map(contour => contour.lines)).toEqual([[first], [second]]);
        expect(t.path.contours.every(contour => !contour.closed)).toBeTrue();
        expect(first.points[1].id).not.toBe(second.points[0].id);
        expect(first.points[1].x).toBe(second.points[0].x);
    });

    it('remaps curve-local outline endpoints when a cubic is split without losing taper settings', () => {
        const t = setup(false), curve = t.path.lines[0];
        t.path.outlineSections = [{ id: 'section', contourId: t.path.contours[0].id,
            start: { segmentId: curve.id, t: .1 }, end: { segmentId: curve.id, t: .9 },
            startTaper: { length: .2, tipWidth: 0 } }];
        const result = insertPathPoint(t.path, curve, t.line);
        expect(result.changed).toBeTrue();
        const section = t.path.outlineSections[0];
        expect(section.start.segmentId).toBe(curve.id);
        expect(section.start.t).toBeGreaterThan(.1);
        expect(section.end.segmentId).toBe(result.selectedLine!.id);
        expect(section.end.t).toBeLessThan(.9);
        expect(section.startTaper).toEqual({ length: .2, tipWidth: 0 });
        expect(pathTopologyProblem(t.svg, t.path, 'break')).toContain('Restore full outline');
        expect(breakPathAtAnchor(t.path, t.b, t.line).changed).toBeFalse();
    });

    it('refuses bone bindings, attached ancestors, and geometry channels in source actions', () => {
        const t = setup();
        t.svg.rigs.armatures = [{ id: 'rig', name: 'Rig', bones: [], bindings: [createPathBinding(t.svg, t.path, 'bone')] }];
        expect(pathTopologyProblem(t.svg, t.path, 'split')).toContain('bound to bones');
        const group = new Group(t.editor); group.elements = [t.path]; t.svg.elements = [group];
        t.svg.rigs.armatures[0].bindings = [];
        t.svg.rigs.armatures[0].attachments = [{ elementId: group.id } as any];
        expect(pathTopologyProblem(t.svg, t.path, 'trim')).toContain('bound to bones');
        t.svg.rigs.armatures = [];
        const animation = createDefaultAnimation(); animation.tracks = [{ id: 'point-key', targetId: t.path.id,
            property: `path.points.${t.a.id}.x`, valueType: 'number', keyframes: [] }];
        t.svg.animation.composition = { version: 1, actions: [{ id: 'action', name: 'Action', targetIds: [t.path.id], animation }], placements: [] };
        expect(pathTopologyProblem(t.svg, t.path, 'break')).toContain('geometry animation');
        animation.tracks[0].property = 'opacity'; expect(pathTopologyProblem(t.svg, t.path, 'break')).toBeUndefined();
    });

    it('runs a context-menu break in one undo step and ignores its stale callback after scope changes', () => {
        const t = setup();
        const animation = new AnimationPlaybackService(t.editor, new NgZone({ enableLongStackTrace: false }), t.preferences);
        const projects = jasmine.createSpyObj<ProjectService>('projects', ['upsert', 'get']);
        const mutations = new DocumentMutationService(t.editor, animation, new HistoryService(), projects);
        const tool = new SelectTool(t.editor); tool.topologyEdit = change => mutations.mutate(change);
        const node = document.createElement('circle'); node.dataset['pointRole'] = 'anchor'; node.dataset['pointId'] = t.b.id;
        const event = new MouseEvent('contextmenu'); Object.defineProperty(event, 'target', { value: node });
        spyOn(t.editor, 'toCanvasPoint').and.returnValue(new Point(0, 0));
        try {
            t.svg.snapshot(); mutations.resetBaseline(); tool.contextMenu(event);
            const command = t.editor.contextMenu!.items.find(item => item.label === 'Break at selected anchor')!;
            expect(command.disabled).toBeFalse(); command.action!();
            expect(t.path.closed).toBeFalse(); expect(projects.upsert).toHaveBeenCalledTimes(1);
            mutations.undo(); expect((t.svg.elements[0] as Path).closed).toBeTrue();
            mutations.redo(); expect((t.svg.elements[0] as Path).closed).toBeFalse();
            t.editor.selectedElement = undefined; const count = projects.upsert.calls.count(); command.action!();
            expect(projects.upsert.calls.count()).toBe(count);
        } finally { mutations.ngOnDestroy(); animation.ngOnDestroy(); }
    });

    it('migrates legacy coincident closure and valid rig signatures once without changing rest data', () => {
        const t = setup(false); t.path.lines.push(new Line(t.editor, { points: [t.c, t.a] }));
        t.svg.rigs.armatures = [{ id: 'rig', name: 'Rig', bones: [{ id: 'bone', name: 'Bone', parentId: null, x: 0, y: 0, angle: 0, length: 100, pose: 0 }],
            bindings: [createPathBinding(t.svg, t.path, 'bone')] }];
        const source = { ...createDocumentEnvelope(t.svg.save()), version: 15 }, before = JSON.stringify(source);
        const result = migrateDocument(source); expect(result.status).toBe('ok');
        if(result.status !== 'ok') return;
        const restored = SVG.fromSave(result.value.data, t.editor), path = restored.elements[0] as Path;
        expect(path.closed).toBeTrue(); expect(restored.rigs.armatures[0].bindings[0].topology).toBe(pathTopology(path));
        expect(restored.rigs.armatures[0].bindings[0].points).toEqual(t.svg.rigs.armatures[0].bindings[0].points);
        expect(JSON.stringify(source)).toBe(before);
        expect(migrateDocument(result.value)).toEqual({ status: 'ok', value: result.value, migrated: false, warnings: [] });
        const stale = structuredClone(source); stale.data.rigs!.armatures[0].bindings[0].topology = 'stale';
        const staleResult = migrateDocument(stale);
        if(staleResult.status === 'ok') expect(staleResult.value.data.rigs!.armatures[0].bindings[0].topology).toBe('stale');
        const explicitOpen = migrateDocument(createDocumentEnvelope(t.svg.save()));
        if(explicitOpen.status === 'ok') expect((SVG.fromSave(explicitOpen.value.data, t.editor).elements[0] as Path).closed).toBeFalse();
        const alignedLegacy = structuredClone(source);
        (alignedLegacy.data.elements[0] as ReturnType<Path['save']>).settings.stroke_alignment = 'outside';
        const alignedResult = migrateDocument(alignedLegacy);
        if(alignedResult.status === 'ok') expect((alignedResult.value.data.elements[0] as ReturnType<Path['save']>).settings.stroke_alignment).toBe('center');
    });
});
