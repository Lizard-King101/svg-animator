import { labWorkload, labWorkloads } from './workloads';
import { BenchmarkRun } from './benchmark-run';
import { verifyAnimatedScenes } from './verify-animated-scenes';
import { experimentalGpu } from './experimental-gpu';
import { AnimatedRigLabScene } from './rig-scene';
import { initializeScenePreview } from './scene-preview';
import { OutlineWorkerClient } from './worker-client';
import { createRendererScene } from '../../src/app/editor/rendering/animated-polygon-scene';
import type { FrameInput, FrameResult } from './worker-protocol';
import { OutlineLabScene } from './scene';
import { PolygonDraw } from '../../src/app/editor/rendering/polygon-scene';
import { WebGpuPolygonRenderer } from '../../src/app/editor/rendering/webgpu-polygon-renderer';
import { verifyPixels } from './verify';

const experimental = document.querySelector<HTMLInputElement>('#experimental-gpu')!;
const canvas = document.querySelector<HTMLCanvasElement>('#gpu')!;
const reference = document.querySelector<SVGSVGElement>('#reference')!;
const status = document.querySelector<HTMLElement>('#status')!;
const results = document.querySelector<HTMLElement>('#results')!;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const retry = document.querySelector<HTMLButtonElement>('#retry')!;
const time = document.querySelector<HTMLInputElement>('#time')!;
const workload = document.querySelector<HTMLSelectElement>('#workload')!;
workload.replaceChildren(...labWorkloads.map(item => new Option(item.label, item.id)));
const sampleCount = document.querySelector<HTMLSelectElement>('#samples')!;
const cancelMeasure = document.querySelector<HTMLButtonElement>('#cancel-measure')!;
let measurementRun: BenchmarkRun | undefined;
cancelMeasure.addEventListener('click', () => measurementRun?.cancel());
const controls = Array.from(document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select'));
let scrubStart: number | undefined, cancelledScrubTime: number | undefined;
let scene: OutlineLabScene | AnimatedRigLabScene = new OutlineLabScene(1, 4);
let scenePreview: ReturnType<typeof initializeScenePreview> | undefined;
let frame = 0, playing = false, busy = false, disposed = false;
let worker: OutlineWorkerClient | undefined, workerAdapter: unknown, workerUnavailable: string | undefined, workerOnly = false;
const workerView = document.querySelector<HTMLElement>('#worker-view')!;
const workerStatus = document.querySelector<HTMLElement>('#worker-status')!;
const playWorker = document.querySelector<HTMLButtonElement>('#play-worker')!;
let workerCanvas = document.querySelector<HTMLCanvasElement>('#worker-gpu')!;
let gpu: WebGpuPolygonRenderer | undefined;
let adapter: unknown;
let unavailable: string | undefined;
let paths: SVGPathElement[] = [];
async function setWorkload(value: string): Promise<void> {
    if(busy) throw new Error('A lab operation is already running.');
    const config = labWorkload(value);
    await exclusive(async () => {
        scrubStart = cancelledScrubTime = undefined; const next = config.kind === 'scene' ? new AnimatedRigLabScene(config.options) : new OutlineLabScene(config.rigs, config.segments);
        workload.value = value; scene = next; await initializeWorker();
    });
}
function pauseAtCurrentTime(): void { stop(); void finalWorker(Number(time.value)).catch(error => { workerStatus.textContent = String(error); }); }
function stop() { playing = false; cancelAnimationFrame(frame); worker?.cancel(); play.textContent = 'Play comparison'; playWorker.textContent = 'Play worker only'; }
function workerInput(at: number): FrameInput { return { time: at, width: canvas.width, height: canvas.height }; }
async function initializeWorker(): Promise<void> {
    worker?.destroy(); worker = undefined; workerAdapter = undefined;
    // A transferred canvas cannot be transferred again; replace its owning view.
    const next = document.createElement('canvas'); next.id = 'worker-gpu';
    workerCanvas.replaceWith(next); workerCanvas = next;
    workerView.hidden = true; playWorker.disabled = true;
    if(!experimentalGpu.enabled) { workerUnavailable = 'Experimental WebGPU is off.'; return; }
    try {
        const client = new OutlineWorkerClient(workerCanvas, scene.snapshot(), reason => {
            workerUnavailable = reason; workerStatus.textContent = reason + ' Main-thread backends remain available.';
            workerView.hidden = true; playWorker.disabled = true; retry.hidden = false;
            if(workerOnly && playing) stop();
        });
        worker = client;
        workerAdapter = await client.ready;
        if(disposed || worker !== client) return;
        workerUnavailable = undefined; retry.hidden = !!gpu; workerView.hidden = false; playWorker.disabled = false;
        workerStatus.textContent = 'Worker ready. Final seek acknowledgement confirms CPU evaluation and submission, not physical display presentation.';
    } catch(error) { workerUnavailable = String(error); workerStatus.textContent = workerUnavailable; retry.hidden = false; worker = undefined; }
}
function previewWorker(at: number): void {
    if(worker && !workerUnavailable) void worker.request(workerInput(at)).catch(error => { workerStatus.textContent = String(error); });
}
async function finalWorker(at: number): Promise<void> {
    if(worker && !workerUnavailable) {
        const result = await worker.request(workerInput(at), true);
        if(result) workerStatus.textContent = `Final sample submitted at ${result.time.toFixed(6)} s.`;
    }
}
function fail(reason: string) {
    unavailable = reason; gpu?.destroy(); gpu = undefined; stop(); canvas.parentElement!.hidden = true; retry.hidden = false;
    status.textContent = `${reason} SVG reference remains available.`;
}
function svgRender(data: string[] | string): void {
    if(typeof data === 'string') {
        const source = new DOMParser().parseFromString(data, 'image/svg+xml').documentElement;
        reference.replaceChildren(...Array.from(source.childNodes).map(node => document.importNode(node, true))); paths = []; return;
    }
    if(paths.length !== data.length) {
        paths = data.map(() => { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('fill', 'rgb(15% 48% 90%)'); return path; });
        reference.replaceChildren(...paths);
    }
    data.forEach((value, i) => { if(paths[i].getAttribute('d') !== value) paths[i].setAttribute('d', value); });
}
function syncSurface(): void {
    const bounds = reference.getBoundingClientRect(), scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(bounds.width * scale)), height = Math.max(1, Math.round(bounds.height * scale));
    if(canvas.width !== width) canvas.width = width;
    if(canvas.height !== height) canvas.height = height;
}
function render(at: number): void {
    syncSurface(); scene.evaluate(at, gpu ? 'both' : 'svg'); svgRender(scene.svgData());
    previewWorker(at);
    if(gpu) try { gpu.render(scene.packedGeometry(), { width: 1000, height: 800 }, scene.clips); } catch(error) { fail(String(error)); }
}
function animate(start: number, offset: number): void {
    if(!playing) return;
    const at = ((performance.now() - start) / 1000 + offset) % 3;
    time.value = String(at); if(workerOnly) previewWorker(at); else render(at); frame = requestAnimationFrame(() => animate(start, offset));
}
const summarize = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], p99: sorted[Math.floor(sorted.length * .99)] };
};
async function benchmark(backend: 'svg' | 'webgpu', run: BenchmarkRun) {
    const samples = run.samples;
    if(backend === 'webgpu' && !gpu) return { backend, unavailable };
    const times: number[] = [], intervals: number[] = [], evaluation: number[] = [], geometry: number[] = [], submission: number[] = [];
    const idle: number[] = []; let last = await run.frame();
    for(let i = 0; i < 30; i++) { const at = await run.frame(); idle.push(at - last); last = at; }
    const refresh = summarize(idle).p50;
    let started = await run.frame(), previous = started;
    for(let i = 0; i < samples + 30; i++) {
        const timestamp = await run.frame(), start = performance.now();
        scene.evaluate(((timestamp - started) / 1000) % 3, backend); const evaluated = performance.now();
        const data = backend === 'svg' ? scene.svgData() : scene.packedGeometry(); const projected = performance.now();
        if(backend === 'svg') svgRender(data as string[] | string); else gpu!.render(data as PolygonDraw[], { width: 1000, height: 800 }, scene.clips);
        const submitted = performance.now();
        if(i >= 30) { times.push(submitted - start); evaluation.push(evaluated - start); geometry.push(projected - evaluated); submission.push(submitted - projected); intervals.push(timestamp - previous); }
        previous = timestamp;
    }
    const drainStarted = performance.now();
    if(gpu) await run.wait(gpu.settled());
    const finalGpuDrainMs = performance.now() - drainStarted;
    const missed = intervals.reduce((sum, value) => sum + Math.max(0, Math.round(value / refresh) - 1), 0);
    return { backend, samples, measuredSeconds: intervals.reduce((a, b) => a + b, 0) / 1000, calibratedIntervalMs: refresh, applicationMs: summarize(times), evaluationMs: summarize(evaluation),
        geometryMs: summarize(geometry), submissionMs: summarize(submission), frameIntervalMs: summarize(intervals),
        missedRefreshPercent: missed / (samples + missed) * 100, ...(backend === 'webgpu' ? { clipMemory: gpu?.clipMemory, finalGpuDrainMs } : {}),
        note: (scene instanceof AnimatedRigLabScene && backend === 'svg' ? 'SVG scene reference regenerates markup and DOM each frame; it is not the retained editor renderer or an editor speedup baseline. ' : '') + 'Application time includes CPU preparation and submission, not GPU execution. Only the measured backend updates; the others remain static.' };
}
async function benchmarkWorker(run: BenchmarkRun) {
    const samples = run.samples;
    if(!worker || workerUnavailable) return { backend: 'webgpu-worker', unavailable: workerUnavailable };
    const client = worker;
    const idle: number[] = [], dispatch: number[] = [], processing: number[] = [], latency: number[] = [];
    const evaluation: number[] = [], geometry: number[] = [], submission: number[] = [], completions: number[] = [], intervals: number[] = [];
    const pending: Promise<void>[] = []; let superseded = 0, last = await run.frame();
    let clipMemory: FrameResult['clipMemory'] | undefined;
    for(let i = 0; i < 30; i++) { const at = await run.frame(); idle.push(at - last); last = at; }
    const refresh = summarize(idle).p50, started = await run.frame(); let previous = started, lastTime = 0;
    try {
        for(let i = 0; i < samples + 30; i++) {
            const timestamp = await run.frame(), start = performance.now(); lastTime = ((timestamp - started) / 1000) % 3;
            const response = client.request(workerInput(lastTime));
            if(i >= 30) { dispatch.push(performance.now() - start); intervals.push(timestamp - previous); }
            pending.push(response.then(result => {
                if(i < 30) return;
                if(!result) { superseded++; return; }
                clipMemory = result.clipMemory;
                completions.push(performance.now()); latency.push(performance.now() - start);
                evaluation.push(result.evaluationMs); geometry.push(result.geometryMs); submission.push(result.submissionMs);
                processing.push(result.evaluationMs + result.geometryMs + result.submissionMs);
            }).catch(error => run.cancel(String(error))));
            previous = timestamp;
        }
        await run.wait(Promise.all(pending)); run.check();
        const final = await run.wait(client.request({ ...workerInput(lastTime), settle: true }, true));
        const missed = intervals.reduce((sum, value) => sum + Math.max(0, Math.round(value / refresh) - 1), 0);
        return { backend: 'webgpu-worker', samples, measuredSeconds: intervals.reduce((a, b) => a + b, 0) / 1000, completed: processing.length, superseded, calibratedIntervalMs: refresh,
            mainThreadDispatchMs: summarize(dispatch), workerProcessingMs: summarize(processing), responseLatencyMs: summarize(latency),
            evaluationMs: summarize(evaluation), geometryMs: summarize(geometry), submissionMs: summarize(submission),
            mainThreadFrameIntervalMs: summarize(intervals), completionIntervalMs: summarize(completions.slice(1).map((time, index) => time - completions[index])),
            mainThreadMissedRefreshPercent: missed / (samples + missed) * 100, clipMemory, finalGpuDrainMs: final?.gpuDrainMs,
            note: 'Worker timings are CPU evaluation, geometry and submission. Response latency includes transport and queueing. Completion is not presentation; main-thread refresh cadence does not prove worker display cadence. Superseded previews are counted separately. No per-frame geometry transfers or readbacks.' };
    } finally { client.cancel(); await Promise.all(pending); }
}
async function verifyWorker(highResolution = true) {
    if(!experimentalGpu.enabled || !worker || workerUnavailable) return { skipped: true, reason: workerUnavailable ?? 'Worker unavailable.' };
    const snapshot = scene.snapshot(), expected = createRendererScene(snapshot);
    const large = highResolution && scene instanceof AnimatedRigLabScene && snapshot.rigs.length === 10;
    const surface = document.createElement('canvas'); surface.width = 256; surface.height = 205;
    const check = await WebGpuPolygonRenderer.create(surface, () => {});
    if(!('renderer' in check)) return { skipped: true, reason: check.reason };
    try {
        for(const at of [0, .12345, 2.9999, 3, 1.5, .12345, 0]) {
            if(large) { surface.width = 1380; surface.height = 1104; }
            expected.evaluate(at);
            const result = await worker.request({ time: at, width: surface.width, height: surface.height, capture: true }, true);
            const reference = await check.renderer.capture(expected.packedGeometry(), { width: 1000, height: 800 }, expected.clips);
            if(!result?.pixels || reference.length !== result.pixels.length || reference.some((value, index) => Math.abs(value - result.pixels![index]) > 3)) {
                return { skipped: false, passed: false, time: at };
            }
            if(large && (result.clipMemory.textures !== 2 || result.clipMemory.bytes !== 48752640)) return { skipped: false, passed: false, reason: 'Unexpected worker mask allocation.' };
            surface.width = surface.width === 256 ? 320 : 256; surface.height = surface.width === 256 ? 205 : 256;
        }
        // Rapid previews are replaceable, but the final fractional sample must survive.
        const previews = Array.from({ length: 20 }, (_, index) => worker!.request({ time: index / 10, width: 256, height: 205 }));
        const final = worker.request({ time: .87654321, width: 256, height: 205 }, true);
        await Promise.all(previews);
        const result = await final;
        return { skipped: false, passed: result?.time === .87654321, comparisons: 7, largeSurface: large, finalTime: result?.time };
    } finally { check.renderer.destroy(); }
}
async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if(busy) throw new Error('A lab operation is already running.');
    busy = true; stop(); controls.forEach(control => control.disabled = true);
    try { return await work(); }
    finally { busy = false; controls.forEach(control => control.disabled = false); playWorker.disabled = !worker || !!workerUnavailable; document.querySelector<HTMLButtonElement>('#verify')!.disabled = !experimentalGpu.enabled; render(Number(time.value)); scenePreview?.refresh(); }
}
async function measure(samples = 180) {
    return exclusive(async () => {
        const run = new BenchmarkRun(samples); measurementRun = run;
        cancelMeasure.hidden = false; cancelMeasure.disabled = false;
        try {
            run.check(); syncSurface(); status.textContent = 'Preparing measurement: waiting for prior GPU work to finish…';
            if(gpu) await run.wait(gpu.settled());
            if(worker && !workerUnavailable) await run.wait(worker.request({ ...workerInput(Number(time.value)), settle: true }, true));
            const config = labWorkload(workload.value), resultsByBackend = [];
            for(const backend of ['svg', 'webgpu', 'webgpu-worker'] as const) {
                run.check(); status.textContent = `Measuring ${backend}: ${samples.toLocaleString()} samples. Keep this tab visible.`;
                resultsByBackend.push(await (backend === 'webgpu-worker' ? benchmarkWorker(run) : benchmark(backend, run)));
            }
            run.check();
            const report = { pipeline: 'stress-scenes-v7', workload: workload.value, workloadLabel: config.label,
                workloadDetails: scene instanceof AnimatedRigLabScene ? scene.workloadDetails : config,
                requestedSamples: samples, browser: navigator.userAgent, canvasPixels: { width: canvas.width, height: canvas.height },
                devicePixelRatio: window.devicePixelRatio, adapter, workerAdapter,
                gpuDrainNote: 'finalGpuDrainMs waits for outstanding submissions after measurement. Worker drain follows an extra exact-final sample. This is not per-frame GPU execution or physical presentation timing.',
                results: resultsByBackend };
            results.textContent = JSON.stringify(report, null, 2); status.textContent = unavailable ?? 'Measurement complete.'; return report;
        } catch(error) {
            worker?.cancel();
            status.textContent = String(error); results.textContent = 'No complete measurement: ' + String(error); throw error;
        } finally { run.dispose(); measurementRun = undefined; cancelMeasure.hidden = true; }
    });
}
async function verify() {
    return exclusive(async () => {
        if(!experimentalGpu.enabled) return { skipped: true, reason: 'Enable Experimental WebGPU to run GPU checks.' };
        const pixels = await verifyPixels(), worker = await verifyWorker(), animated = await verifyAnimatedScenes();
        const report = { ...pixels, worker, animated, passed: pixels.passed && (worker.skipped || worker.passed) && (animated.skipped || animated.passed) }; results.textContent = JSON.stringify(report, null, 2); return report;
    });
}
play.addEventListener('click', () => { if(playing) pauseAtCurrentTime(); else { workerOnly = false; playing = true; play.textContent = 'Pause'; animate(performance.now(), Number(time.value)); } });
time.addEventListener('input', () => {
    if(cancelledScrubTime !== undefined) { time.value = String(cancelledScrubTime); return; }
    stop(); render(Number(time.value));
});
workload.addEventListener('change', () => void setWorkload(workload.value).catch(error => { results.textContent = String(error); }));
playWorker.addEventListener('click', () => { if(playing) pauseAtCurrentTime(); else { syncSurface(); workerOnly = true; playing = true; playWorker.textContent = 'Pause'; animate(performance.now(), Number(time.value)); } });
time.addEventListener('pointerdown', () => { cancelledScrubTime = undefined; scrubStart = Number(time.value); });
function cancelScrub(): void {
    if(scrubStart === undefined) return;
    stop(); cancelledScrubTime = scrubStart; time.value = String(scrubStart); scrubStart = undefined; render(Number(time.value));
    void finalWorker(Number(time.value)).catch(error => { workerStatus.textContent = String(error); });
}
time.addEventListener('keydown', event => { if(event.key === 'Escape') { event.preventDefault(); cancelScrub(); } else cancelledScrubTime = undefined; });
time.addEventListener('pointercancel', cancelScrub);
time.addEventListener('change', () => { if(cancelledScrubTime !== undefined) { time.value = String(cancelledScrubTime); return; } scrubStart = undefined; void finalWorker(Number(time.value)).catch(error => { workerStatus.textContent = String(error); }); });
document.querySelector('#measure')!.addEventListener('click', () => void measure(Number(sampleCount.value)).catch(error => { results.textContent = String(error); }));
document.querySelector('#verify')!.addEventListener('click', () => void verify().catch(error => { results.textContent = String(error); }));
document.addEventListener('visibilitychange', () => { if(document.hidden) stop(); });
window.addEventListener('resize', () => { if(!busy) { stop(); render(Number(time.value)); } });
window.addEventListener('pagehide', () => { disposed = true; stop(); worker?.destroy(); gpu?.destroy(); });
async function initializeGpu(): Promise<void> {
    if(gpu || disposed || !experimentalGpu.enabled) return;
    const revision = experimentalGpu.revision;
    const initialized = await WebGpuPolygonRenderer.create(canvas, fail);
    if('renderer' in initialized) {
        if(disposed || !experimentalGpu.enabled || revision !== experimentalGpu.revision) { initialized.renderer.destroy(); return; }
        gpu = initialized.renderer; unavailable = undefined; canvas.parentElement!.hidden = false; retry.hidden = true;
        const info = initialized.adapter;
        adapter = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter };
        status.textContent = `WebGPU ready: ${info.description || info.device || info.architecture || info.vendor || 'adapter identity unavailable'}.`;
    } else fail(initialized.reason);
}
const retryGpu = () => exclusive(async () => { if(!experimentalGpu.enabled) return { available: false, reason: 'Experimental WebGPU is off.' }; await initializeGpu(); await initializeWorker(); return { available: !!gpu, reason: unavailable }; });
retry.addEventListener('click', () => void retryGpu().catch(error => fail(String(error))));
async function setExperimental(enabled: boolean): Promise<void> {
    await exclusive(async () => {
        experimentalGpu.set(enabled); experimental.checked = enabled;
        if(enabled) { await initializeGpu(); await initializeWorker(); }
        else {
            worker?.destroy(); worker = undefined; gpu?.destroy(); gpu = undefined;
            adapter = workerAdapter = undefined; unavailable = workerUnavailable = 'Experimental WebGPU is off.';
            canvas.parentElement!.hidden = true; workerView.hidden = true; retry.hidden = true;
            status.textContent = workerStatus.textContent = 'SVG mode. Enable Experimental WebGPU to test GPU rendering.';
        }
    });
}
experimental.addEventListener('change', () => void setExperimental(experimental.checked).catch(error => { results.textContent = String(error); }));
scenePreview = initializeScenePreview();
await setExperimental(false);
// Development-only automation entry point; this lab is never imported by the editor.
Object.assign(window, { rendererLab: { ready: true, setExperimental, get experimentalEnabled() { return experimentalGpu.enabled; }, measure, verify, verifyWorker, setWorkload, retryGpu, get adapter() { return adapter; }, get unavailable() { return unavailable; } } });
