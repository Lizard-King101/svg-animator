/** Shared capture/threshold lifecycle for artwork and bone layer handles. */
export class RowPointerDrag<T> {
    pending?: { value: T; pointerId: number; x: number; y: number; row: HTMLElement; started: boolean };
    begin(event: PointerEvent, row: HTMLElement, value: T): void {
        this.cancel();
        this.pending = { value, row, pointerId:event.pointerId, x:event.clientX, y:event.clientY, started:false };
        row.setPointerCapture(event.pointerId);
    }
    move(event: PointerEvent): T | undefined {
        const pending = this.pending;
        if(!pending || pending.pointerId !== event.pointerId) return;
        pending.started ||= Math.hypot(event.clientX-pending.x,event.clientY-pending.y) >= 4;
        if(pending.started) { event.preventDefault(); return pending.value; }
        return undefined;
    }
    cancel(): void {
        const pending = this.pending; this.pending = undefined;
        if(pending?.row.hasPointerCapture(pending.pointerId)) pending.row.releasePointerCapture(pending.pointerId);
    }
}
export type RowDropPosition = 'before' | 'after' | 'inside';
export function rowDropPosition(bounds: { top:number; height:number }, y:number, acceptsChildren:boolean): RowDropPosition {
    const offset = y-bounds.top;
    return acceptsChildren && offset > bounds.height/3 && offset < bounds.height*2/3 ? 'inside' : offset < bounds.height/2 ? 'before' : 'after';
}
