import { EditorClipboardDirective } from './editor-clipboard.directive';

describe('editor clipboard routing', () => {
    function setup() {
        const objects = jasmine.createSpyObj('objects', ['copy', 'paste']);
        const reference = jasmine.createSpyObj('reference', ['paste']);
        const editor = { selectedSVG: {} };
        const animation = { mode: 'edit' };
        const ui = { activeDialog: undefined as string | undefined };
        const directive = new EditorClipboardDirective(editor as any, animation as any, ui as any, objects, reference);
        const event = (target: Element = document.createElement('div')) => {
            const value = new ClipboardEvent('paste', { clipboardData: new DataTransfer(), cancelable: true });
            Object.defineProperty(value, 'target', { value: target });
            return value;
        };
        return { directive, objects, reference, editor, animation, ui, event };
    }
    it('prioritizes image data over copied artwork and prevents duplicate paste', () => {
        const { directive, reference, objects, event } = setup();
        reference.paste.and.returnValue(true); objects.paste.and.returnValue(true);
        const paste = event(); directive.paste(paste);
        expect(paste.defaultPrevented).toBeTrue(); expect(objects.paste).not.toHaveBeenCalled();
    });
    it('falls back to the app object clipboard for non-image data', () => {
        const { directive, reference, objects, event } = setup();
        reference.paste.and.returnValue(false); objects.paste.and.returnValue(true);
        const paste = event(); directive.paste(paste);
        expect(objects.paste).toHaveBeenCalledOnceWith(); expect(paste.defaultPrevented).toBeTrue();
    });
    it('leaves text controls, dialogs, Animate, missing documents and already-handled events alone', () => {
        const { directive, reference, objects, event, animation, ui, editor } = setup();
        for(const tag of ['input', 'textarea', 'select']) directive.paste(event(document.createElement(tag)));
        const editable = document.createElement('div'); editable.contentEditable = 'true'; directive.paste(event(editable));
        ui.activeDialog = 'export'; directive.paste(event()); ui.activeDialog = undefined;
        animation.mode = 'animate'; directive.paste(event()); animation.mode = 'edit';
        const prevented = event(); prevented.preventDefault(); directive.paste(prevented);
        editor.selectedSVG = undefined as any; directive.paste(event());
        expect(reference.paste).not.toHaveBeenCalled(); expect(objects.paste).not.toHaveBeenCalled();
    });
    it('writes the copy marker through the native event and leaves ordinary text copy alone', () => {
        const { directive, objects, event } = setup(); objects.copy.and.returnValue(true);
        const copy = event(); directive.copy(copy);
        expect(objects.copy).toHaveBeenCalledOnceWith(copy.clipboardData); expect(copy.defaultPrevented).toBeTrue();
        directive.copy(event(document.createElement('input'))); expect(objects.copy).toHaveBeenCalledTimes(1);
    });
});
