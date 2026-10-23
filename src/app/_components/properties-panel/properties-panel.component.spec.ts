import { TestBed } from "@angular/core/testing";
import { AnimationPlaybackService } from "../../_services/animation-playback.service";
import { DocumentMutationService } from "../../_services/document-mutation.service";
import { EditorService } from "../../_services/editor.service";
import { PaintEditingService } from "../../_services/paint-editing.service";
import { Path } from "../../editor/objects/elements/path.object";
import { Line } from "../../editor/objects/line.object";
import { createDefaultGradient } from "../../editor/objects/paint.object";
import { Point } from "../../editor/objects/point.object";
import { PropertiesPanelComponent } from "./properties-panel.component";
import { EditorPreferencesService } from "../../_services/editor-preferences.service";
import { SelectTool } from "../../_services/tools/select.tool";
import { SVG } from "../../editor/objects/svg.object";

describe("PropertiesPanelComponent", () => {
    for(const closure of ["open", "implicit", "explicit", "coincident", "straight-cubic"] as const) it(`rounds a selected straight corner through the radius input (${closure})`, async () => {
        const editor = new EditorService(new EditorPreferencesService());
        const path = new Path(editor), a = new Point(100, 100), b = new Point(200, 100), c = new Point(200, 200);
        path.lines = [new Line(editor, { points: [a, b] }), new Line(editor, { points: [b, c] })];
        if(closure !== 'open') {
            const d = new Point(100, 200);
            path.lines.push(new Line(editor, { points: [c, d] }));
            if(closure !== 'implicit') path.lines.push(new Line(editor, { points: [d, closure === 'coincident' ? new Point(a.x, a.y) : a] }));
            path.closed = true;
        }
        if(closure === 'straight-cubic') path.lines.forEach(line => {
            line.type = 'bezier'; line.controlStart = line.points[0].add(0, 0); line.controlEnd = line.points[1].add(0, 0);
        });
        const anchor = closure === 'open' ? b : a;
        const svg = new SVG(editor, { width: 800, height: 600, pos: new Point(0, 0) }); svg.elements = [path];
        editor.selectedSVG = svg; editor.selectedElement = path;
        spyOn(editor, 'toCanvasPoint').and.returnValue(anchor);
        const schedule = jasmine.createSpy('schedule');
        await TestBed.configureTestingModule({
            imports: [PropertiesPanelComponent],
            providers: [
                { provide: EditorService, useValue: editor },
                { provide: AnimationPlaybackService, useValue: { mode: 'edit' } },
                { provide: DocumentMutationService, useValue: { schedule } },
                { provide: PaintEditingService, useValue: { apply: () => true } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(PropertiesPanelComponent);
        const tool = new SelectTool(editor), target = document.createElement('div');
        target.dataset['pointRole'] = 'anchor'; target.dataset['pointId'] = anchor.id;
        const down = new MouseEvent('mousedown'); Object.defineProperty(down, 'target', { value: target });
        tool.down(down); tool.up(new MouseEvent('mouseup'));
        fixture.detectChanges(); await fixture.whenStable();
        const label = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('label')).find(label => label.textContent?.trim() === 'Corner Radius');
        const input = label?.querySelector('input');
        expect(input).toBeTruthy(); expect(input?.disabled).toBeFalse();
        input!.value = '20'; input!.dispatchEvent(new Event('input'));
        fixture.detectChanges(); await fixture.whenStable();
        expect(anchor.cornerRadius).toBe(20);
        expect(path.raw).toContain(closure === 'open' ? 'L 180 100 C' : 'M 120 100');
        expect(path.raw).toContain(closure === 'open' ? '200 120' : 'L 100 120 C');
        expect(schedule).toHaveBeenCalledTimes(1);
        const restored = Path.fromSave(path.save(), editor);
        expect(restored.raw).toBe(path.raw); expect(restored.cornerEligible(restored.findPointById(anchor.id)!)).toBeTrue();
    });
    it("stabilizes when selecting a restored path with gradient paint", async () => {
        let id = 0;
        const modelEditor = { get ID() { return `id-${++id}`; } } as EditorService;
        const source = new Path(modelEditor);
        const gradient = createDefaultGradient("previous-gradient");
        gradient.units = "userSpaceOnUse";
        gradient.coordinates = { x1: 192.9, y1: 339.31, x2: 614.7, y2: 386.87 };
        source.settings.stroke = gradient;
        source.lines = [new Line(modelEditor, { points: [new Point(180, 320), new Point(630, 400)] })];
        const save = source.save();
        const savedGradient = save.settings.stroke as Exclude<typeof save.settings.stroke, string | null>;
        savedGradient.stops.forEach((stop) => delete stop.opacity);
        const path = Path.fromSave(save, modelEditor);
        const editor = {
            inspectedElement: path,
            selectedElement: path,
            selectedElements: [path],
            selectedGradientPaintKey: undefined,
        };

        await TestBed.configureTestingModule({
            imports: [PropertiesPanelComponent],
            providers: [
                { provide: EditorService, useValue: editor },
                { provide: AnimationPlaybackService, useValue: { mode: "edit" } },
                { provide: DocumentMutationService, useValue: { schedule: () => undefined } },
                { provide: PaintEditingService, useValue: { apply: () => true } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(PropertiesPanelComponent);

        fixture.detectChanges();
        for(let index = 0; index < 25; index += 1) fixture.detectChanges();

        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelectorAll("app-paint-editor").length).toBe(2);
        expect(root.querySelectorAll(".paint-stop-marker").length).toBe(2);
        // Without a selected anchor the Anchor section is omitted rather than left as an empty divider.
        const sections = [...root.querySelectorAll(".transform-section")];
        expect(sections.every((section) => section.querySelector(".transform-title"))).toBeTrue();
        expect(sections.map((section) => section.querySelector(".transform-title")?.textContent)).not.toContain("Anchor");
    });
});
