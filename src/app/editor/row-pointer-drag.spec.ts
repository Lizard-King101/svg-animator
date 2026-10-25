import { RowPointerDrag, rowDropPosition } from './row-pointer-drag';

describe('layer row pointer drag', () => {
    it('shares threshold, pointer identity and capture cancellation across layer trees', () => {
        const row=document.createElement('div'), drag=new RowPointerDrag<string>();
        spyOn(row,'setPointerCapture'); spyOn(row,'hasPointerCapture').and.returnValue(true); spyOn(row,'releasePointerCapture');
        const event=(x:number,id=1) => ({pointerId:id,clientX:x,clientY:0,preventDefault(){}} as PointerEvent);
        drag.begin(event(0),row,'bone'); expect(drag.move(event(3))).toBeUndefined(); expect(drag.move(event(10,2))).toBeUndefined();
        expect(drag.move(event(5))).toBe('bone'); drag.cancel(); expect(drag.pending).toBeUndefined();
        expect(row.releasePointerCapture).toHaveBeenCalledOnceWith(1); drag.cancel(); expect(row.releasePointerCapture).toHaveBeenCalledTimes(1);
    });
    it('uses edge ordering and a middle parenting zone', () => {
        const bounds={top:100,height:30};
        expect(rowDropPosition(bounds,104,true)).toBe('before'); expect(rowDropPosition(bounds,115,true)).toBe('inside');
        expect(rowDropPosition(bounds,126,true)).toBe('after'); expect(rowDropPosition(bounds,115,false)).toBe('after');
    });
});
