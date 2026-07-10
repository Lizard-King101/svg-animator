import { IconName } from "@fortawesome/fontawesome-svg-core";
import { EditorService } from "../editor.service";

export class Tool {
    readonly preferenceKey: string = "tool";
    icon: IconName = "question-circle";
    get getIcon() {
        if(this.children.length && this.selectedChild) {
            return this.selectedChild.icon;
        } else {
            return this.icon;
        }
    }
    selected: boolean = false;
    interactsWithGuides = false;

    children: Tool[] = [];
    selectedChild?: Tool;
    showChildren: boolean = false;

    constructor(protected editor: EditorService, protected parentTool?: Tool) {
    }

    select(event: MouseEvent) : void | boolean {
        if(event.button == 2) {
            event.preventDefault();
            
            if(this.children.length) {
                this.showChildren = true;
            }
            this.onselect();
            return false;
        }
        if(this.onselect()) {
            this.activate();
        }
    }

    restoreSelection(): boolean {
        if(!this.onselect()) {
            return false;
        }

        this.activate();
        return true;
    }

    private activate() {
        const activeTool = this.parentTool ?? this;
        const rememberedTool = this.selectedChild ?? this;
        this.selected = true;
        activeTool.selected = true;
        this.editor.selectedTool = activeTool;
        this.editor.deselectOther(activeTool);
        this.editor.rememberSelectedTool(rememberedTool.preferenceKey);
    }

    onselect() : boolean {
        return true;
    }

    deselectOtherChildren(tool: Tool) {
        this.children.forEach((t: Tool) => {
            if(t != tool) {
                t.selected = false;
            }
        })
    }

    deselect() : void {
        this.selected = false;
    }

    click(event: MouseEvent) {}

    doubleClick(event: MouseEvent) {}

    down(event: MouseEvent) {}

    up(event: MouseEvent) {}

    drag(event: MouseEvent) {}

    contextMenu(event: MouseEvent) {}

    reset(): void {}

    keyPressed(key: string): void {}

    keyReleased(key: string): void {}
}
