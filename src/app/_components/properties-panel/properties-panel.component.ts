import { Component } from "@angular/core";

@Component({
    selector: "app-properties-panel",
    standalone: true,
    template: "<ng-content />",
    styles: [":host { display: contents; }"],
})
export class PropertiesPanelComponent {}
