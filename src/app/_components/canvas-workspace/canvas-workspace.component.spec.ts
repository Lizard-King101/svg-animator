import { ElementRef, NgZone } from '@angular/core';
import { CanvasWorkspaceComponent } from './canvas-workspace.component';
import { Point } from '../../editor/objects/point.object';

describe('workspace view gestures', () => {
    function setup() {
        const host = document.createElement('div'), overlay = document.createElement('div');
        host.append(overlay); document.body.append(host);
        // Weight-paint and bone controls reserve their own artwork gestures.
        overlay.addEventListener('mousedown', event => event.stopPropagation());
        const tool = jasmine.createSpyObj('tool', ['down', 'drag', 'up', 'reset', 'leave']);
        const editor = { selectedTool: tool, selectedSVG: { pos: new Point(10, 20) },
            closeContextMenu() {}, setViewPort() {}, toViewportPoint: (x: number, y: number) => new Point(x, y),
            rememberCanvasView: jasmine.createSpy('rememberCanvasView') };
        const mutations = jasmine.createSpyObj('mutations', ['commit']);
        const gestures = jasmine.createSpyObj('gestures', ['begin', 'end', 'cancel']);
        const component = new CanvasWorkspaceComponent(editor as never, mutations, new NgZone({ enableLongStackTrace: false }), new ElementRef(host), gestures);
        component.ngAfterViewInit();
        const mouse = (target: EventTarget, type: string, button: number, x: number, y: number) => {
            const event = new MouseEvent(type, { button, clientX: x, clientY: y, bubbles: true, cancelable: true });
            target.dispatchEvent(event); return event;
        };
        return { host, overlay, tool, editor, mutations, gestures, mouse, destroy: () => { component.ngOnDestroy(); host.remove(); } };
    }

    it('pans through overlay controls without drawing, painting, or recording document history', () => {
        const t = setup();
        try {
            expect(t.mouse(t.overlay, 'mousedown', 1, 50, 60).defaultPrevented).toBeTrue();
            t.mouse(t.overlay, 'mousemove', 1, 80, 100);
            expect(t.editor.selectedSVG.pos.x).toBe(40); expect(t.editor.selectedSVG.pos.y).toBe(60);
            t.mouse(document, 'mouseup', 1, 80, 100);
            expect(t.tool.down).not.toHaveBeenCalled(); expect(t.tool.drag).not.toHaveBeenCalled(); expect(t.tool.up).not.toHaveBeenCalled();
            expect(t.gestures.begin).not.toHaveBeenCalled(); expect(t.mutations.commit).not.toHaveBeenCalled();
            expect(t.editor.rememberCanvasView).toHaveBeenCalledTimes(1);
        } finally { t.destroy(); }
    });

    it('stops a pan on Escape without resetting the path or rig tool being used', () => {
        const t = setup();
        try {
            t.mouse(t.overlay, 'mousedown', 1, 10, 10); t.mouse(document, 'mousemove', 1, 30, 40);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            t.mouse(document, 'mousemove', 1, 80, 100); t.mouse(document, 'mouseup', 1, 80, 100);
            expect(t.editor.selectedSVG.pos.x).toBe(30); expect(t.editor.selectedSVG.pos.y).toBe(50);
            expect(t.tool.reset).not.toHaveBeenCalled(); expect(t.gestures.cancel).not.toHaveBeenCalled();
            expect(t.mutations.commit).not.toHaveBeenCalled();
        } finally { t.destroy(); }
    });

    it('preserves ordinary left-button drawing and leaves overlay-owned painting alone', () => {
        const t = setup();
        try {
            t.mouse(t.overlay, 'mousedown', 0, 10, 10); t.mouse(document, 'mouseup', 0, 10, 10);
            expect(t.tool.down).not.toHaveBeenCalled(); expect(t.mutations.commit).not.toHaveBeenCalled();
            t.mouse(t.host, 'mousedown', 0, 10, 10); t.mouse(t.host, 'mousemove', 0, 30, 40); t.mouse(document, 'mouseup', 0, 30, 40);
            expect(t.tool.down).toHaveBeenCalledTimes(1); expect(t.tool.drag).toHaveBeenCalledTimes(1); expect(t.tool.up).toHaveBeenCalledTimes(1);
            expect(t.gestures.begin).toHaveBeenCalledTimes(1); expect(t.gestures.end).toHaveBeenCalledTimes(1);
            expect(t.mutations.commit).toHaveBeenCalledTimes(1);
        } finally { t.destroy(); }
    });
});
