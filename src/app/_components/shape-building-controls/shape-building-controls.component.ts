import { Component, DoCheck, HostListener, Input, OnDestroy } from '@angular/core';
import { NgIf } from '@angular/common';
import { EditorService } from '../../_services/editor.service';
import { ShapeBuildingService } from '../../_services/shape-building.service';
import { ShapeBuildingTool } from '../../_services/tools/shape-building.tool';
import { CanvasWorkspaceComponent } from '../canvas-workspace/canvas-workspace.component';
import { canvasToWorkspaceProjection } from '../../editor/canvas-workspace-projection';
import { bindToolKeyboard } from '../../editor/tool-keyboard';

@Component({
    selector: 'app-shape-building-controls', standalone: true, imports: [NgIf],
    template: `
      <svg *ngIf="selected" class="building-preview" aria-hidden="true">
        <g [attr.transform]="projection">
          <path [attr.d]="building.selectedPreview" fill="var(--accent)" fill-opacity=".35" fill-rule="evenodd" />
          <path [attr.d]="building.preview" [attr.fill]="building.mode === 'trim' ? 'none' : 'var(--accent)'" fill-opacity=".2" fill-rule="evenodd"
            stroke="var(--accent)" [attr.stroke-width]="building.mode === 'trim' ? 5 : 2" vector-effect="non-scaling-stroke" />
        </g>
      </svg>
      <div *ngIf="selected" class="building-controls" (mousedown)="$event.stopPropagation()" (click)="$event.stopPropagation()" (contextmenu)="$event.stopPropagation()">
        <span role="status">{{ building.hint }}</span>
        <div class="building-actions">
          <label><input type="checkbox" [checked]="building.selectionOnly" [disabled]="!building.selectionAvailable" (change)="scope($event)" /> Selection only</label>
          <button *ngIf="building.mode === 'regions'" class="btn btn-sm btn-primary" [disabled]="!building.chosen.size" (click)="building.create()">Create shape ({{ building.chosen.size }})</button>
          <button class="btn btn-sm btn-secondary" (click)="building.cancel()">Cancel</button>
          <button class="btn btn-sm btn-secondary" (click)="done()">Done</button>
        </div>
      </div>`,
    styles: `:host { display:contents; } .building-preview { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:3; }
      .building-controls { position:absolute; left:32px; bottom:12px; z-index:15; max-width:calc(100% - 48px); display:flex; flex-direction:column; gap:8px; padding:8px 10px; border:1px solid var(--border); border-radius:var(--radius-md); color:var(--text-secondary); background:var(--bg-surface); font-size:11px; }
      .building-actions { display:flex; align-items:center; flex-wrap:wrap; gap:10px; } label { display:flex; align-items:center; gap:5px; }`,
})
export class ShapeBuildingControlsComponent implements DoCheck, OnDestroy {
    @Input({ required: true }) artwork!: SVGElement;
    @Input({ required: true }) workspace!: CanvasWorkspaceComponent;
    private tools: ShapeBuildingTool[];
    private unbindKeys: () => void;
    get selected(): boolean { return this.editor.selectedTool?.selectedChild instanceof ShapeBuildingTool; }
    constructor(public building: ShapeBuildingService, private editor: EditorService) {
        this.tools = editor.tools.flatMap(tool => tool.children).filter((tool): tool is ShapeBuildingTool => tool instanceof ShapeBuildingTool);
        this.tools.forEach(tool => tool.building = building);
        const active = editor.selectedTool?.selectedChild;
        if(active instanceof ShapeBuildingTool) building.activate(active.mode);
        this.unbindKeys = bindToolKeyboard(() => this.selected, key => building.key(key));
    }
    get projection(): string {
        const svg = this.editor.selectedSVG;
        if(!svg || !this.artwork || !this.workspace) return '';
        const m = canvasToWorkspaceProjection(this.artwork.getBoundingClientRect(), this.workspace.element.getBoundingClientRect(), svg.canvasBounds).canvasToWorkspace;
        return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;
    }
    scope(event: Event): void { this.building.setSelectionOnly((event.target as HTMLInputElement).checked); }
    done(): void { this.building.invalidate(); this.editor.tools[0].restoreSelection(); }
    ngDoCheck(): void { if(this.selected) this.building.validate(); }
    @HostListener('window:blur') blur(): void { this.building.leave(); }
    ngOnDestroy(): void { this.unbindKeys(); this.building.invalidate(); this.tools.forEach(tool => tool.building = undefined); }
}
