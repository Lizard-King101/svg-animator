export interface FrameToken { generation: number; id: number; }
interface Request<Input, Output> {
    token: FrameToken; input: Input; final: boolean; cancelled: boolean;
    resolve: (output: Output | undefined) => void; reject: (error: Error) => void;
}

/** Bounded backpressure: one sent frame, one replaceable preview. A final sample is
 * a barrier, not a preview: it cannot be displaced. Cancellation drops queued work
 * and suppresses delivery of sent work; it cannot retract already submitted pixels.
 */
export class LatestFrameQueue<Input, Output> {
    private nextId = 0;
    private active?: Request<Input, Output>;
    private queued?: Request<Input, Output>;
    private stopped?: Error;
    constructor(readonly generation: number, private readonly send: (token: FrameToken, input: Input) => void) {}
    request(input: Input, final = false): Promise<Output | undefined> {
        if(this.stopped) return Promise.reject(this.stopped);
        if(this.active?.final || this.queued?.final) return Promise.reject(new Error('Final frame is pending.'));
        return new Promise((resolve, reject) => {
            const request = { token: { generation: this.generation, id: ++this.nextId }, input, final, cancelled: false, resolve, reject };
            if(this.active) { this.queued?.resolve(undefined); this.queued = request; }
            else this.dispatch(request);
        });
    }
    complete(token: FrameToken, output: Output): void {
        if(!this.matches(token)) return;
        const active = this.active!; this.active = undefined;
        if(!active.cancelled) active.resolve(output);
        const next = this.queued; this.queued = undefined;
        if(next) this.dispatch(next);
    }
    cancel(): void {
        this.queued?.resolve(undefined); this.queued = undefined;
        if(this.active) { this.active.cancelled = true; this.active.final = false; this.active.resolve(undefined); }
    }
    fail(error: Error): void {
        this.stopped = error;
        this.active?.reject(error); this.queued?.reject(error);
        this.active = this.queued = undefined;
    }
    private matches(token: FrameToken): boolean { return token.generation === this.generation && token.id === this.active?.token.id; }
    private dispatch(request: Request<Input, Output>): void {
        this.active = request;
        try { this.send(request.token, request.input); } catch(error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    }
}
