import { IconName } from '@fortawesome/fontawesome-svg-core';
import { TextElement } from 'src/app/editor/objects/elements/text.object';
import { Point } from 'src/app/editor/objects/point.object';
import { EditorService } from '../editor.service';
import { Tool } from './tool';

export class TextTool extends Tool {
    override readonly preferenceKey = 'text';
    override icon: IconName = 'font';

    constructor(private _editor: EditorService) {
        super(_editor);
    }

    override click(event: MouseEvent) {
        if (!this._editor.selectedSVG) return;
        const pos = this._editor.toCanvasPoint(event.clientX, event.clientY);
        const text = new TextElement(this._editor, new Point(pos.x, pos.y));
        this._editor.selectedSVG.elements.push(text);
        this._editor.selectedElement = text;
        this._editor.activeElement = undefined;
    }
}
