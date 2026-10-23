import { IconName } from '@fortawesome/fontawesome-svg-core';
import { Tool } from './tool';
import { EditorService } from '../editor.service';
import type { ConstructionDrawingService } from '../construction-drawing.service';

export type ConstructionKind = 'line' | 'arc';

/** Palette adapter; the scoped drawing service owns all gesture state. */
export class ConstructionTool extends Tool {
    override readonly preferenceKey: string;
    override icon: IconName;
    drawing?: ConstructionDrawingService;
    get pointSnapFeedback() { return this.drawing?.pointSnapFeedback; }
    constructor(editor: EditorService, parent: Tool, public readonly kind: ConstructionKind) {
        super(editor, parent);
        this.preferenceKey = kind;
        this.icon = kind === 'line' ? 'slash' : 'circle-notch';
    }
    override onselect(): boolean {
        this.drawing?.cancel();
        return super.onselect();
    }
    override down(event: MouseEvent): void { this.drawing?.down(this.kind, event); }
    override drag(event: MouseEvent): void { this.drawing?.move(event); }
    override up(event: MouseEvent): void { this.drawing?.up(event); }
    override click(event: MouseEvent): void { this.drawing?.click(event); }
    override contextMenu(event: MouseEvent): void { event.preventDefault(); this.reset(); }
    override keyPressed(key: string): void { this.drawing?.key(key); }
    override keyReleased(key: string): void { this.drawing?.key(key); }
    override reset(): void { this.drawing?.cancel(); }
    override deselect(): void { super.deselect(); this.reset(); }
}
