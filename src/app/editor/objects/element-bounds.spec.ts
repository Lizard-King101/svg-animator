import { EditorService } from '../../_services/editor.service';
import { localBounds, ownMatrix, ownTransformBounds, resolvedOrigin } from './element-bounds';
import { Group } from './elements/group.object';
import { Path } from './elements/path.object';
import { Line } from './line.object';
import { motionAdjustedMatrix } from './motion-path.object';
import { Point } from './point.object';
import { transformMatrix } from './transform.object';

describe('element bounds traversal', () => {
    let id = 0;
    const editor = { get ID() { return `bounds-${id++}`; } } as EditorService;
    function path(): Path {
        const result = new Path(editor);
        result.lines = [new Line(editor, { points: [new Point(10, 20), new Point(30, 60)] })];
        return result;
    }

    it('renders identity and translation matrices without inspecting descendant geometry', () => {
        const leaf = path(), group = new Group(editor);
        group.elements = [leaf];
        const geometry = leaf.contours, read = jasmine.createSpy('geometry').and.returnValue(geometry);
        Object.defineProperty(leaf, 'contours', { get: read });
        expect(ownMatrix(group)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        group.transform.translateX = 12; group.transform.translateY = -8;
        expect(motionAdjustedMatrix(undefined, group)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 12, f: -8 });
        expect(read).not.toHaveBeenCalled();
    });

    it('visits a leaf once through deeply nested automatic rotation origins', () => {
        const leaf = path(), geometry = leaf.contours;
        const read = jasmine.createSpy('geometry').and.returnValue(geometry);
        Object.defineProperty(leaf, 'contours', { get: read });
        let root: Path | Group = leaf;
        for(let depth = 0; depth < 10; depth++) {
            const group = new Group(editor);
            group.elements = [root]; group.transform.rotation = 90;
            root = group;
        }
        const bounds = ownTransformBounds(root);
        expect(bounds.x).toBeCloseTo(10, 8); expect(bounds.y).toBeCloseTo(20, 8);
        expect(bounds.width).toBeCloseTo(20, 8); expect(bounds.height).toBeCloseTo(40, 8);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('preserves live automatic origins, explicit pivots, reflections and tiny transforms', () => {
        const leaf = path();
        leaf.transform.scaleX = -2; leaf.transform.rotation = 35;
        expect(ownMatrix(leaf)).toEqual(transformMatrix(leaf.transform, { x: 20, y: 40 }));
        leaf.lines[0].points[1].x = 70;
        expect(resolvedOrigin(leaf)).toEqual({ x: 40, y: 40 });
        expect(ownMatrix(leaf)).toEqual(transformMatrix(leaf.transform, { x: 40, y: 40 }));
        leaf.transform.originX = 0; leaf.transform.originY = 5;
        expect(ownMatrix(leaf)).toEqual(transformMatrix(leaf.transform, { x: 0, y: 5 }));
        leaf.transform.scaleX = 1.0000001; leaf.transform.rotation = 0.0000001;
        expect(ownMatrix(leaf)).toEqual(transformMatrix(leaf.transform, { x: 0, y: 5 }));
    });

    it('keeps hidden clip-source geometry in group origins and excludes ordinary hidden art', () => {
        const clip = path(), hidden = path(), group = new Group(editor);
        clip.visible = false; hidden.visible = false;
        hidden.lines[0].points[1].x = 900;
        group.elements = [clip, hidden]; group.clipElementId = clip.id;
        group.transform.scaleX = -1;
        expect(localBounds(group)).toEqual({ x: 10, y: 20, width: 20, height: 40 });
        expect(ownTransformBounds(group)).toEqual({ x: 10, y: 20, width: 20, height: 40 });
        clip.visible = true;
        expect(ownTransformBounds(group)).toEqual({ x: 10, y: 20, width: 20, height: 40 });
    });
});
