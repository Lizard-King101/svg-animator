import { Tool } from './tool';
import type { BoneDrawingService } from '../bone-drawing.service';

/** Palette adapter. Creation drafts belong to the scoped drawing service. */
export class BoneTool extends Tool {
    override readonly preferenceKey = 'bone';
    override readonly label = 'Bone';
    override icon = 'bone' as const;
    drawing?: BoneDrawingService;
    override onselect(): boolean { this.drawing?.activate(); return super.onselect(); }
    override down(event: MouseEvent): void { this.drawing?.down(event); }
    override drag(event: MouseEvent): void { this.drawing?.move(event); }
    override up(event: MouseEvent): void { this.drawing?.up(event); }
    override reset(): void { this.drawing?.cancel(); }
    override deselect(): void { super.deselect(); this.reset(); }
    override contextMenu(event: MouseEvent): void { event.preventDefault(); this.reset(); }
}
