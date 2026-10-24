import { IconName } from '@fortawesome/fontawesome-svg-core';
import { Tool } from './tool';
import { EditorService } from '../editor.service';
import type { ShapeBuildingMode, ShapeBuildingService } from '../shape-building.service';

export class ShapeBuildingTool extends Tool {
    override readonly preferenceKey: string;
    override readonly label: string;
    override readonly usesDrawingPaint: boolean;
    override icon: IconName;
    building?: ShapeBuildingService;
    constructor(editor: EditorService, parent: Tool, readonly mode: ShapeBuildingMode) {
        super(editor, parent);
        this.preferenceKey = mode; this.label = mode === 'regions' ? 'Create shape' : 'Trim';
        this.usesDrawingPaint = mode === 'regions';
        this.icon = mode === 'regions' ? 'object-group' : 'scissors';
    }
    override onselect(): boolean { super.onselect(); this.building?.activate(this.mode); return true; }
    override drag(event: MouseEvent): void { this.building?.move(event); }
    override click(event: MouseEvent): void { this.building?.click(event); }
    override keyPressed(key: string): void { this.building?.key(key); }
    override contextMenu(event: MouseEvent): void { event.preventDefault(); this.reset(); }
    override leave(): void { this.building?.leave(); }
    override reset(): void { this.building?.cancel(); }
    override deselect(): void { super.deselect(); this.building?.invalidate(); }
}
