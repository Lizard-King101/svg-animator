import { Injectable } from "@angular/core";
import { Group, GroupSave } from "../editor/objects/elements/group.object";
import { SVG } from "../editor/objects/svg.object";
import { SVGImportError, SVGImporterService, SVGImportResult } from "../editor/import/svg-importer.service";
import { AnimationPlaybackService } from "./animation-playback.service";
import { DocumentMutationService } from "./document-mutation.service";
import { EditorService } from "./editor.service";
import { LayerCommandService } from "./layer-command.service";

export interface CurrentDocumentSVGImportResult extends SVGImportResult {
    layer: Group;
}

/** Imports an external SVG as one undoable layer group in the open document. */
@Injectable()
export class CurrentDocumentSVGImportService {
    constructor(
        private editor: EditorService,
        private importer: SVGImporterService,
        private animation: AnimationPlaybackService,
        private mutations: DocumentMutationService,
        private layers: LayerCommandService,
    ) {}

    import(source: string, name?: string): CurrentDocumentSVGImportResult {
        const target = this.editor.selectedSVG;
        if(!target) throw new SVGImportError("Open a project before importing SVG artwork.");
        const namespace = this.nextNamespace();
        const result = this.importer.import(source, { name, idNamespace: namespace });
        if(result.nativeElementCount === 0 && result.preservedNodeCount === 0) {
            throw new SVGImportError("The SVG does not contain drawable artwork.");
        }

        const importedState = JSON.stringify(result.document);
        let layerId = `${namespace}-asset`;
        let suffix = 1;
        while(importedState.includes(`"id":"${layerId}"`)) {
            layerId = `${namespace}-asset-${suffix}`;
            suffix += 1;
        }
        const layerSave: GroupSave = {
            type: "group",
            id: layerId,
            name: result.document.name,
            visible: true,
            locked: false,
            opacity: 1,
            transform: {
                translateX: (target.width - result.document.width) / 2,
                translateY: (target.height - result.document.height) / 2,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                originX: 0,
                originY: 0,
            },
            clipElementId: null,
            elements: result.document.elements,
        };
        const importedSave = {
            ...result.document,
            id: `${namespace}-document`,
            elements: [layerSave],
            importedSourceNodes: (result.document.importedSourceNodes ?? []).map((node) => ({
                ...node,
                parentId: node.parentId ?? layerId,
            })),
        };
        const restored = SVG.fromSave(importedSave, this.editor, target.width, target.height);
        const layer = restored.elements[0] as Group;

        this.animation.withBaseState(() => this.mutations.mutate(() => {
            target.elements.push(layer);
            target.importedSourceNodes.push(...restored.importedSourceNodes);
        }, "artwork"));
        this.layers.selectLayer(layer);
        return { ...result, layer };
    }

    private nextNamespace(): string {
        const serialized = JSON.stringify(this.editor.selectedSVG?.save() ?? {});
        let namespace: string;
        do namespace = `import-${this.editor.ID}`; while(serialized.includes(`${namespace}-`));
        return namespace;
    }
}
