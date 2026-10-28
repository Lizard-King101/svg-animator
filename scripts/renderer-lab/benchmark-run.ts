/** Bounded measurement lifetime; cancellation also releases a pending animation frame. */
export class BenchmarkRun {
    private readonly controller = new AbortController();
    private readonly hidden = () => { if(document.hidden) this.cancel('Measurement stopped because the tab was hidden.'); };
    constructor(readonly samples: number) {
        if(!Number.isInteger(samples) || samples < 30 || samples > 7200) throw new Error('Use 30–7200 samples.');
        document.addEventListener('visibilitychange', this.hidden);
        this.hidden();
    }
    cancel(reason = 'Measurement cancelled.'): void { this.controller.abort(new Error(reason)); }
    check(): void { this.controller.signal.throwIfAborted(); }
    /** Cancels our wait, not GPU work already submitted to the driver. */
    wait<T>(promise: Promise<T>): Promise<T> {
        const signal = this.controller.signal;
        return new Promise((resolve, reject) => {
            const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
            promise.then(value => { signal.removeEventListener('abort', aborted); resolve(value); },
                error => { signal.removeEventListener('abort', aborted); reject(error); });
            if(signal.aborted) aborted(); else signal.addEventListener('abort', aborted, { once: true });
        });
    }
    frame(): Promise<number> {
        this.check();
        return new Promise((resolve, reject) => {
            const aborted = () => { cancelAnimationFrame(id); reject(this.controller.signal.reason); };
            const id = requestAnimationFrame(at => { this.controller.signal.removeEventListener('abort', aborted); resolve(at); });
            this.controller.signal.addEventListener('abort', aborted, { once: true });
        });
    }
    dispose(): void { document.removeEventListener('visibilitychange', this.hidden); this.cancel(); }
}
