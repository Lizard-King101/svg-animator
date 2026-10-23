import { EditorPreferencesService } from '../editor-preferences.service';
import { EditorService } from '../editor.service';
import { Group } from '../../editor/objects/elements/group.object';
import { Shape } from '../../editor/objects/elements/shape.object';
import { Point } from '../../editor/objects/point.object';
import { SVG } from '../../editor/objects/svg.object';
import { SelectTool } from './select.tool';

describe('Select tool canvas context menu', () => {
    function setup() {
        const editor = new EditorService(new EditorPreferencesService());
        const svg = new SVG(editor, { width: 200, height: 200, pos: new Point(0, 0) });
        const child = new Shape(editor, { type: 'rectangle', position: new Point(10, 10), width: 20, height: 20 });
        const group = new Group(editor); group.elements = [child];
        const other = new Shape(editor, { type: 'ellipse', position: new Point(100, 100), width: 20, height: 20 });
        svg.elements = [group, other];
        editor.selectedSVG = svg;
        const tool = editor.tools.find((item): item is SelectTool => item instanceof SelectTool)!;
        const menu = jasmine.createSpy('objectMenu');
        tool.objectMenu = menu;
        const hit = (element?: { id: string }) => {
            const node = document.createElement('div');
            if(element) node.id = element.id;
            spyOn(document, 'elementsFromPoint').and.returnValue(element ? [node] : []);
        };
        const rightClick = () => tool.contextMenu(new MouseEvent('contextmenu', { clientX: 5, clientY: 5 }));
        return { editor, child, group, other, menu, hit, rightClick };
    }

    it('selects an unselected object like a left click and opens its object menu', () => {
        const { editor, other, menu, hit, rightClick } = setup();
        hit(other); rightClick();
        expect(editor.selectedElement).toBe(other);
        expect(menu).toHaveBeenCalledOnceWith(jasmine.any(MouseEvent), other);
    });

    it('keeps an existing selection and targets the selected ancestor of the hit object', () => {
        const { editor, child, group, other, menu, hit, rightClick } = setup();
        editor.selectedElements = [group, other];
        hit(child); rightClick();
        expect(editor.selectedElements).toEqual([group, other]);
        expect(menu).toHaveBeenCalledOnceWith(jasmine.any(MouseEvent), group);
    });

    it('opens the canvas menu over empty canvas and ignores locked objects', () => {
        const { other, menu, hit, rightClick } = setup();
        other.locked = true;
        hit(other); rightClick();
        expect(menu).toHaveBeenCalledOnceWith(jasmine.any(MouseEvent));
    });
});
