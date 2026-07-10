import { Component } from "@angular/core";

@Component({
    selector: "app-layers-panel",
    standalone: true,
    template: "<ng-content />",
    styles: [":host { display: contents; }"],
})
export class LayersPanelComponent {}
