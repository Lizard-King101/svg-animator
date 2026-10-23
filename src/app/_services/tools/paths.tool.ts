import { ShapeBuildingTool } from './shape-building.tool';
import { IconName } from '@fortawesome/fontawesome-svg-core';
import { EditorService } from '../editor.service';
import { ConstructionTool } from './construction.tool';
import { PenTool } from './pen.tool';
import { ToolGroup } from './tool-group';

export class Paths extends ToolGroup {
    override readonly preferenceKey = 'paths';
    override icon: IconName = 'pen-fancy';

    constructor(editor: EditorService) {
        super(editor);
        const pen = new PenTool(editor, this);
        this.children = [pen, new ConstructionTool(editor, this, 'line'), new ShapeBuildingTool(editor, this, 'trim')];
        this.selectedChild = pen;
    }
}
