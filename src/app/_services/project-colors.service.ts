import { Injectable } from '@angular/core';
import { EditorService } from './editor.service';
import { DocumentMutationService } from './document-mutation.service';
import { authoredColors, canonicalColor, mergeProjectColors, ProjectColor, useProjectColor } from '../editor/objects/project-colors';
import { SVG } from '../editor/objects/svg.object';

@Injectable()
export class ProjectColorsService {
    private document?: SVG;
    private revision = -1;
    private cached: ProjectColor[] = [];
    constructor(private editor: EditorService, private mutations: DocumentMutationService) {}

    get available(): boolean { return !!this.editor.selectedSVG; }
    get colors(): readonly ProjectColor[] {
        const svg = this.editor.selectedSVG;
        if(svg !== this.document || this.revision !== this.mutations.revision) {
            this.document = svg; this.revision = this.mutations.revision;
            const save = this.mutations.captureSave();
            this.cached = mergeProjectColors(save?.projectColors ?? [], authoredColors(save).values())
                .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
        }
        return this.cached;
    }

    /** Explicit choices outside an artwork edit, such as new drawing defaults. */
    remember(value: string | string[]): void {
        const svg = this.editor.selectedSVG, colors = (Array.isArray(value) ? value : [value]).map(canonicalColor).filter((color): color is string => !!color);
        if(!svg || !colors.length) return;
        this.mutations.mutate(() => {
            for(const color of colors) svg.projectColors = useProjectColor(svg.projectColors, color);
        }, 'metadata');
    }

    rename(color: string, name: string): void { this.update(color, { name: name.trim().slice(0, 80) || undefined }); }
    pin(color: string, pinned: boolean): void { this.update(color, { pinned: pinned || undefined }); }
    private update(color: string, changes: Partial<ProjectColor>): void {
        const svg = this.editor.selectedSVG, item = this.colors.find(item => item.color === color);
        if(!svg || !item || Object.entries(changes).every(([key, value]) => item[key as keyof ProjectColor] === value)) return;
        this.mutations.mutate(() => {
            const colors = mergeProjectColors(svg.projectColors, [color]);
            svg.projectColors = colors.map(entry => entry.color === color ? { ...entry, ...changes } : entry);
        }, 'metadata');
    }
}
