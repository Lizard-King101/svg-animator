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

describe("PropertiesPanelComponent paint rendering", () => {
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
    });
});
