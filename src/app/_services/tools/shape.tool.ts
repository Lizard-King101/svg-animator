import { ShapeBuildingTool } from './shape-building.tool';
import { ConstructionTool } from './construction.tool';
import { IconName } from '@fortawesome/fontawesome-common-types';
import { EditorService } from '../editor.service';
import { ToolGroup } from './tool-group';
import { Rectangle } from './shapes/rectangle.tool';
import { Ellipse } from './shapes/ellipse.tool';

export class Shapes extends ToolGroup {
    override readonly preferenceKey = 'shapes';
    override icon: IconName = 'shapes';

    constructor(editor: EditorService) {
        super(editor);
        this.children = [new Rectangle(editor, this), new Ellipse(editor, this), new ConstructionTool(editor, this, 'arc'), new ShapeBuildingTool(editor, this, 'regions')];
    }
}
