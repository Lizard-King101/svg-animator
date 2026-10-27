import { EditorPage } from "./editor.page";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap, provideRouter } from "@angular/router";
import { ProjectService } from "../_services/project.service";
import { FaIconLibrary } from "@fortawesome/angular-fontawesome";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { far } from "@fortawesome/free-regular-svg-icons";
import { RigEditingService } from '../_services/rig-editing.service';

describe("editor page keyboard shortcuts", () => {
    function setup() {
        const selectedElement = {};
        const editor = {
            selectedElement,
            selectedPathAnchor: undefined,
            contextMenu: undefined,
            keyPressed: jasmine.createSpy("keyPressed"),
            keyReleased: jasmine.createSpy("keyReleased"),
        };
        const layers: {
            renamingLayer: object | undefined;
            selectedLayers: object[];
            deleteLayer: jasmine.Spy;
            deleteSelectedLayers: jasmine.Spy;
        } = {
            renamingLayer: undefined,
            selectedLayers: [selectedElement],
            deleteLayer: jasmine.createSpy("deleteLayer"),
            deleteSelectedLayers: jasmine.createSpy("deleteSelectedLayers"),
        };
        const page = new EditorPage({ hidesArtworkHandles: false } as any,
            {} as any,
            editor as any,
            { mode: "edit" } as any,
            {} as any,
            {} as any,
            layers as any,
            { activeDialog: undefined } as any,
            {} as any,
            {} as any,
            { handleKey: () => false } as any,
            { active: false } as any,
        );
        return { editor, layers, page, selectedElement };
    }

    function keyEvent(key: string, target: Element): KeyboardEvent {
        return {
            key,
            target,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            preventDefault: jasmine.createSpy("preventDefault"),
        } as unknown as KeyboardEvent;
    }

    it("leaves Backspace and Delete with focused property editors", () => {
        const { editor, layers, page } = setup();

        page.handleKeyDown(keyEvent("Backspace", document.createElement("textarea")));
        page.handleKeyDown(keyEvent("Delete", document.createElement("input")));

        expect(layers.deleteLayer).not.toHaveBeenCalled();
        expect(layers.deleteSelectedLayers).not.toHaveBeenCalled();
        expect(editor.keyPressed).not.toHaveBeenCalled();
    });

    it("leaves editing keys with the layer rename input", () => {
        const { editor, layers, page, selectedElement } = setup();
        layers.renamingLayer = selectedElement;
        const input = document.createElement("input");

        page.handleKeyDown(keyEvent("Backspace", input));
        page.handleKeyDown(keyEvent("Enter", input));

        expect(layers.deleteLayer).not.toHaveBeenCalled();
        expect(layers.renamingLayer).toBe(selectedElement);
        expect(editor.keyPressed).not.toHaveBeenCalled();
    });

    it("retains Delete as a canvas-level layer shortcut", () => {
        const { layers, page, selectedElement } = setup();
        const event = keyEvent("Delete", document.createElement("div"));

        page.handleKeyDown(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(layers.deleteLayer).toHaveBeenCalledOnceWith(selectedElement);
    });

    it('leaves Enter and Space with focused action buttons', () => {
        const { page, editor, layers } = setup();
        const button = document.createElement('button');
        const enter = keyEvent('Enter', button);
        page.handleKeyDown(enter);
        page.handleKeyDown(keyEvent(' ', button));
        expect(enter.preventDefault).not.toHaveBeenCalled();
        expect(layers.renamingLayer).toBeUndefined();
        expect(editor.keyPressed).not.toHaveBeenCalled();
    });
});

describe('new project canvas lifecycle', () => {
    it('opens the initial dialog and creates sibling artwork/overlays without late binding changes', async () => {
        await TestBed.configureTestingModule({ imports: [EditorPage], providers: [
            provideRouter([]),
            { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
            { provide: ProjectService, useValue: { get: () => undefined, upsert: () => undefined, uniqueName: (base: string) => base } },
        ] }).compileComponents();
        TestBed.inject(FaIconLibrary).addIconPacks(fas, far);
        const fixture = TestBed.createComponent(EditorPage);
        fixture.detectChanges();
        expect(() => fixture.checkNoChanges()).not.toThrow();
        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector('.dialog-overlay')).not.toBeNull();
        (root.querySelector('.btn-create') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(() => fixture.checkNoChanges()).not.toThrow();
        const artwork = root.querySelector('svg[display]')!;
        expect(artwork).not.toBeNull();
        expect(root.querySelector('svg[editorOverlay]')?.parentElement).toBe(artwork.parentElement);
        expect(root.querySelector('.dialog-overlay')).toBeNull();
        fixture.componentInstance.animation.setMode('animate'); fixture.detectChanges();
        expect(root.querySelector('.canvas-ruler')).toBeNull();
        fixture.componentInstance.animation.setMode('edit'); fixture.detectChanges();
        expect(root.querySelector('.canvas-ruler')).not.toBeNull();
        expect(() => fixture.checkNoChanges()).not.toThrow();
        fixture.destroy();
    });

    it('retains rig selection, pose inspector and canvas controls when entering Animate', async () => {
        await TestBed.configureTestingModule({ imports: [EditorPage], providers: [
            provideRouter([]),
            { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
            { provide: ProjectService, useValue: { get: () => undefined, upsert: () => undefined, uniqueName: (base: string) => base } },
        ] }).compileComponents();
        TestBed.inject(FaIconLibrary).addIconPacks(fas, far);
        const fixture = TestBed.createComponent(EditorPage);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        (root.querySelector('.btn-create') as HTMLButtonElement).click(); fixture.detectChanges();
        const rig = fixture.debugElement.injector.get(RigEditingService);
        rig.create(); fixture.detectChanges();
        const selectedBone = rig.boneId, panel = root.querySelector('app-editor-side-panel');
        expect(rig.visible).toBeTrue();
        fixture.componentInstance.animation.setMode('animate'); fixture.detectChanges();
        expect(root.querySelector('app-editor-side-panel')).toBe(panel);
        expect(rig.boneId).toBe(selectedBone);
        expect(rig.visible).toBeTrue();
        expect(rig.workspace).toBe('pose');
        expect(root.querySelector('app-rig-overlay [aria-label="Armature bones"]')).not.toBeNull();
        expect(root.querySelector('app-ik-target')).not.toBeNull();
        expect(root.querySelector('input[aria-label="Pose offset X"]')).not.toBeNull();
        expect(root.textContent).toContain('Key selected control');
        expect(() => fixture.checkNoChanges()).not.toThrow();
        fixture.componentInstance.animation.setMode('edit'); fixture.detectChanges();
        expect(root.querySelector('app-editor-side-panel')).toBe(panel);
        expect(rig.visible).toBeTrue();
        fixture.destroy();
    });
});
