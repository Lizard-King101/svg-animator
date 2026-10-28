import { createRendererScene } from '../../src/app/editor/rendering/animated-polygon-scene';
import { WebGpuPolygonRenderer } from '../../src/app/editor/rendering/webgpu-polygon-renderer';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

// Explicit narrow worker surface keeps DOM library declarations out of the protocol.
const scope = globalThis as unknown as {
    onmessage: (event: MessageEvent<WorkerRequest>) => void;
    postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};
let scene: ReturnType<typeof createRendererScene> | undefined, canvas: OffscreenCanvas | undefined, renderer: WebGpuPolygonRenderer | undefined;
let generation = 0, active = false, failed = false, lastId = 0;
function fail(error: unknown): void {
    if(failed) return;
    failed = true; renderer?.destroy(); renderer = undefined;
    scope.postMessage({ kind: 'error', generation, reason: String(error) });
}
scope.onmessage = event => void handle(event.data).catch(fail);
async function handle(message: WorkerRequest): Promise<void> {
    if(failed) return;
    if(active) throw new Error('Overlapping worker requests.');
    active = true;
    try {
        if(message.kind === 'init') {
            if(scene) throw new Error('Worker already owns a scene.');
            generation = message.snapshot.generation;
            scene = createRendererScene(message.snapshot); canvas = message.canvas;
            const result = await WebGpuPolygonRenderer.create(canvas, fail);
            if(!('renderer' in result)) throw new Error(result.reason);
            if(failed) { result.renderer.destroy(); return; }
            renderer = result.renderer;
            const info = result.adapter;
            scope.postMessage({ kind: 'ready', generation, adapter: { vendor: info.vendor, architecture: info.architecture,
                device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter } });
        } else {
            if(message.token.generation !== generation || message.token.id <= lastId) return;
            if(!renderer || !scene || !canvas) throw new Error('Worker is not initialized.');
            lastId = message.token.id;
            const { time, width, height, capture } = message.input;
            if(![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384)) throw new Error('Invalid worker surface size.');
            if(canvas.width !== width) canvas.width = width;
            if(canvas.height !== height) canvas.height = height;
            const started = performance.now();
            scene.evaluate(time); const evaluated = performance.now();
            const draws = scene.packedGeometry(), projected = performance.now();
            // Geometry never leaves this worker. Readback is explicitly diagnostic only.
            const pixels = capture ? new Uint8Array(await renderer.capture(draws, { width: 1000, height: 800 }, scene.clips)) : undefined;
            if(!capture) renderer.render(draws, { width: 1000, height: 800 }, scene.clips);
            const submitted = performance.now();
            let gpuDrainMs: number | undefined;
            if(message.input.settle) { await renderer.settled(); gpuDrainMs = performance.now() - submitted; }
            scope.postMessage({ kind: 'frame', token: message.token, result: { time, evaluationMs: evaluated - started,
                geometryMs: projected - evaluated, submissionMs: submitted - projected, clipMemory: renderer.clipMemory,
                ...(gpuDrainMs === undefined ? {} : { gpuDrainMs }), ...(pixels ? { pixels } : {}) } }, pixels ? [pixels.buffer] : []);
        }
    } finally { active = false; }
}
