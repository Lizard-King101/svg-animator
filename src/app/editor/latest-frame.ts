/** A gesture owns one pending preview. Release flushes the latest sample; cancellation
 * drops it so a late animation-frame callback cannot resurrect a cancelled draft.
 */
export class LatestFrame<T> {
    private id?: number;
    private pending?: { value: T };
    constructor(private readonly consume: (value: T) => void) {}
    queue(value: T): void {
        this.pending = { value };
        this.id ??= requestAnimationFrame(() => { this.id = undefined; this.flush(); });
    }
    flush(): void {
        if(this.id !== undefined) cancelAnimationFrame(this.id);
        this.id = undefined;
        const pending = this.pending; this.pending = undefined;
        if(pending) this.consume(pending.value);
    }
    cancel(): void {
        if(this.id !== undefined) cancelAnimationFrame(this.id);
        this.id = undefined; this.pending = undefined;
    }
}
