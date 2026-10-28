import { LatestFrameQueue } from '../../src/app/editor/rendering/latest-frame-queue';
import type { RendererSceneSnapshot } from '../../src/app/editor/rendering/animated-polygon-scene';
import type { FrameInput, FrameResult, WorkerRequest, WorkerResponse } from './worker-protocol';

/** A scene replacement owns a fresh worker and canvas. terminate() bounds resource
 * lifetime and prevents an old generation from painting the replacement surface. */
export class OutlineWorkerClient {
    readonly ready: Promise<Record<string, unknown>>;
    private readonly worker: Worker;
    private readonly queue: LatestFrameQueue<FrameInput, FrameResult>;
    private timer?: ReturnType<typeof setTimeout>;
    private closed = false;
    private initialized = false;
    private activeId?: number;
    private resolveReady!: (adapter: Record<string, unknown>) => void;
    private rejectReady!: (error: Error) => void;
    constructor(canvas: HTMLCanvasElement, snapshot: RendererSceneSnapshot, private onFailure: (reason: string) => void) {
        this.worker = new Worker('/worker.js', { type: 'module' });
        this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
        this.queue = new LatestFrameQueue(snapshot.generation, (token, input) => {
            this.activeId = token.id; this.armTimeout(); this.post({ kind: 'frame', token, input });
        });
        this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
            const generation = data.kind === 'frame' ? data.token.generation : data.generation;
            if(this.closed || generation !== snapshot.generation) return;
            if(data.kind === 'frame' && data.token.id !== this.activeId) return;
            if(data.kind === 'ready' && this.initialized) return;
            clearTimeout(this.timer);
            if(data.kind === 'error') this.fail(new Error(data.reason));
            else if(data.kind === 'ready') { this.initialized = true; this.resolveReady(data.adapter); }
            else { this.activeId = undefined; this.queue.complete(data.token, data.result); }
        };
        this.worker.onerror = event => { event.preventDefault(); this.fail(new Error(event.message || 'Renderer worker failed.')); };
        this.worker.onmessageerror = () => this.fail(new Error('Renderer worker message could not be decoded.'));
        try {
            const surface = canvas.transferControlToOffscreen();
            this.armTimeout(); this.post({ kind: 'init', canvas: surface, snapshot }, [surface]);
        } catch(error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    }
    request(input: FrameInput, final = false): Promise<FrameResult | undefined> {
        if(!this.initialized) return Promise.reject(new Error('Worker is not ready.'));
        return this.queue.request(input, final);
    }
    cancel(): void { this.queue.cancel(); }
    destroy(error = new Error('Renderer worker disposed.')): void {
        if(this.closed) return;
        this.closed = true; clearTimeout(this.timer); this.worker.terminate();
        this.queue.fail(error); this.rejectReady(error);
    }
    private fail(error: Error): void {
        if(this.closed) return;
        this.destroy(error); this.onFailure(error.message);
    }
    private post(message: WorkerRequest, transfer: Transferable[] = []): void { this.worker.postMessage(message, transfer); }
    private armTimeout(): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.fail(new Error('Renderer worker timed out.')), 15000);
    }
}
