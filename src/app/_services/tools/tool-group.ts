import { Tool } from './tool';

/** Routes palette-group interactions to its remembered child. */
export class ToolGroup extends Tool {
    override onselect(): boolean {
        if(!this.selectedChild) {
            this.showChildren = true;
            return false;
        }
        if(!this.selected || !this.selectedChild.selected) this.selectedChild.onselect();
        this.selectedChild.selected = true;
        return true;
    }

    override down(event: MouseEvent): void { this.selectedChild?.down(event); }
    override drag(event: MouseEvent): void { this.selectedChild?.drag(event); }
    override up(event: MouseEvent): void { this.selectedChild?.up(event); }
    override click(event: MouseEvent): void { this.selectedChild?.click(event); }
    override doubleClick(event: MouseEvent): void { this.selectedChild?.doubleClick(event); }
    override contextMenu(event: MouseEvent): void { this.selectedChild?.contextMenu(event); }
    override keyPressed(key: string): void { this.selectedChild?.keyPressed(key); }
    override keyReleased(key: string): void { this.selectedChild?.keyReleased(key); }
    override leave(): void { this.selectedChild?.leave(); }
    override reset(): void { this.selectedChild?.reset(); }
    override deselect(): void {
        super.deselect();
        this.showChildren = false;
        this.selectedChild?.deselect();
    }
}
