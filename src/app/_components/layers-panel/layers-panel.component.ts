import { NgClass, NgFor, NgIf } from "@angular/common";
import { ChangeDetectorRef, Component, DoCheck, ElementRef } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { LayerCommandService } from "../../_services/layer-command.service";
import { AnyElement } from "../../editor/objects/svg.object";

@Component({
    selector: "app-layers-panel",
    standalone: true,
    imports: [FormsModule, NgClass, NgFor, NgIf, FaIconComponent],
    templateUrl: "layers-panel.component.html",
    styles: [`
        :host { display: contents; }
        .layer-row:focus { outline: none; }
        .layer-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    `],
})
export class LayersPanelComponent implements DoCheck {
    /** Roving tab stop: the last focused row, else the first selected row, else the first row. */
    tabStopId?: string;
    focusedId?: string;

    constructor(public commands: LayerCommandService, private host: ElementRef<HTMLElement>, private changes: ChangeDetectorRef) {}

    ngDoCheck(): void {
        const rows = this.commands.layerRows;
        const focused = rows.find((row) => row.element.id === this.focusedId);
        this.tabStopId = (focused ?? rows.find((row) => this.commands.isLayerSelected(row.element)) ?? rows[0])?.element.id;
    }

    handleKey(event: KeyboardEvent, element: AnyElement): void {
        if(event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = this.commands.navigateLayers(event.key, element, event.shiftKey);
        if(!target) return;
        // Consumed so editor-wide arrow nudging does not also move the selection on the canvas.
        event.preventDefault();
        this.focusedId = target.id;
        // Render expanded/collapsed rows now so focus moves before the next key repeat.
        this.changes.detectChanges();
        this.host.nativeElement.querySelector<HTMLElement>(`.layer-row[data-layer-id="${CSS.escape(target.id)}"]`)?.focus();
    }

    /**
     * Pointer selection does not move focus into the tree, so arrow keys keep nudging canvas objects.
     * When the tree already has focus it follows the clicked row; a focused field elsewhere still
     * blurs, committing its edit as a normal click would.
     */
    keepPointerFocus(event: MouseEvent): void {
        if(event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        const active = document.activeElement;
        if(!(active instanceof HTMLElement) || active === document.body) return;
        if(this.host.nativeElement.contains(active)) (event.currentTarget as HTMLElement).focus({ preventScroll: true });
        else active.blur();
    }
}
