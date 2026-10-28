import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir, cpus } from 'node:os';
import { resolve } from 'node:path';
import { close, connectCdp, evaluate, findChrome, findPageTarget, listen, readDebugPort, stopChrome, waitFor } from './browser-test-support';

const scratch = await mkdtemp(resolve(tmpdir(), 'svg-renderer-lab-'));
const smoke = process.argv.includes('--smoke'), software = process.argv.includes('--software-gpu'), hardware = process.argv.includes('--hardware-gpu');
if(software && hardware) throw new Error('Choose one GPU backend.');
let chrome: ReturnType<typeof spawn> | undefined, socket: WebSocket | undefined;
let browserLog = '';
const browserErrors: unknown[] = [];
const server = createServer(async (request, response) => {
    try {
        if(request.url === '/' || request.url === '/index.html') { response.setHeader('Content-Type', 'text/html'); response.end(await readFile(resolve('scripts/renderer-lab/index.html'))); }
        else if(request.url === '/worker.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(resolve(scratch, 'worker.js'))); }
        else if(request.url === '/lab.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(resolve(scratch, 'lab.js'))); }
        else if(request.url === '/favicon.ico') response.writeHead(204).end();
        else response.writeHead(404).end();
    } catch { response.writeHead(500).end(); }
});
try {
    execFileSync(resolve('node_modules/.bin/esbuild'), ['scripts/renderer-lab/main.ts', '--bundle', '--format=esm', '--target=es2022', '--minify', `--outfile=${resolve(scratch, 'lab.js')}`], { stdio: 'inherit' });
    execFileSync(resolve('node_modules/.bin/esbuild'), ['scripts/renderer-lab/worker.ts', '--bundle', '--format=esm', '--target=es2022', '--minify', `--metafile=${resolve(scratch, 'worker-meta.json')}`, `--outfile=${resolve(scratch, 'worker.js')}`], { stdio: 'inherit' });
    const workerInputs = Object.keys(JSON.parse(await readFile(resolve(scratch, 'worker-meta.json'), 'utf8')).inputs);
    if(workerInputs.some(path => /angular|editor\/objects|_services/.test(path))) throw new Error('Worker bundle contains editor/framework dependencies.');
    const url = `http://127.0.0.1:${await listen(server)}/`;
    if(!smoke) {
        console.log(`Renderer comparison lab: ${url}\nLocal synthetic data only. Ctrl+C to stop.`);
        await new Promise<void>(done => { process.once('SIGINT', done); process.once('SIGTERM', done); });
    } else {
        chrome = spawn(await findChrome(), ['--headless', '--no-sandbox', '--disable-background-timer-throttling', '--window-size=1600,1000', '--remote-debugging-port=0', `--user-data-dir=${resolve(scratch, 'profile')}`,
            ...(software ? ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader', '--use-vulkan=swiftshader', '--disable-vulkan-surface']
                : hardware ? ['--enable-gpu', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-vulkan-surface'] : []), url], { stdio: ['ignore', 'ignore', 'pipe'] });
        chrome.stderr?.on('data', chunk => browserLog = (browserLog + String(chunk)).slice(-16000));
        const target = await findPageTarget(await readDebugPort(chrome), url), connection = await connectCdp(target.webSocketDebuggerUrl); socket = connection.socket;
        connection.onEvent(message => { if(message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded') browserErrors.push(message); });
        await connection.command('Runtime.enable'); await connection.command('Log.enable');
        await waitFor(async () => evaluate(connection, '!!window.rendererLab?.ready'), 'renderer lab');
        // Software rasterization is for correctness/instrumentation, not desktop timing.
        // Explicit verification surfaces (including 1380×1104) remain unchanged.
        if(software) await evaluate(connection, `document.querySelector('#reference').style.width = '256px'`);
        if(await evaluate(connection, 'window.rendererLab.experimentalEnabled')) throw new Error('GPU must default to off.');
        await evaluate(connection, 'window.rendererLab.setExperimental(true)');
        if(software || hardware) await evaluate(connection, 'window.rendererLab.retryGpu()');
        if(process.argv.includes('--screenshot')) {
            await evaluate(connection, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            const screenshot = await connection.command('Page.captureScreenshot', { format: 'png' });
            await writeFile('/tmp/svg-renderer-lab-before.png', Buffer.from(screenshot.result!['data'], 'base64'));
        }
        const verification = await evaluate(connection, 'window.rendererLab.verify()');
        if(!verification.skipped && !verification.passed) console.log(JSON.stringify({ verification }, null, 2));
        if(!verification.skipped && !verification.passed) throw new Error('GPU raster verification failed.');
        if(verification.skipped && process.argv.includes('--require-gpu')) throw new Error(verification.reason);
        if(verification.worker?.skipped && process.argv.includes('--require-gpu')) throw new Error(verification.worker.reason);
        const workerLifecycle: unknown[] = [];
        if(!verification.worker?.skipped) {
            // Exercise the actual lab handlers, including input after Escape and a new keyboard seek.
            await evaluate(connection, `(() => {
                const input = document.querySelector('#time');
                input.value = '0'; input.dispatchEvent(new PointerEvent('pointerdown'));
                input.value = '.7'; input.dispatchEvent(new Event('input'));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                input.value = '.9'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));
                if(Number(input.value) !== 0) throw new Error('Cancelled scrub resumed.');
            })()`);
            await waitFor(async () => evaluate(connection, `document.querySelector('#worker-status').textContent.includes('Final sample submitted at 0.000000 s.')`), 'cancelled scrub restoration');
            await evaluate(connection, `(() => {
                const input = document.querySelector('#time'); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
                input.value = '.321'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));
            })()`);
            await waitFor(async () => evaluate(connection, `document.querySelector('#worker-status').textContent.includes('Final sample submitted at 0.321000 s.')`), 'final keyboard sample');
            for(const workload of ['3,4', '10,4', 'rig-scene,1', 'rig-scene,3', 'rig-scene,10', 'scene-geometry-48', 'scene-layers-24', 'scene-combined', 'scene-static-2000']) {
                console.log(`Verifying worker workload: ${workload}`);
                await evaluate(connection, `window.rendererLab.setWorkload('${workload}')`);
                const result = await evaluate(connection, `window.rendererLab.verifyWorker(${!workload.startsWith('scene-')})`);
                if(result.skipped || !result.passed) throw new Error('Replacement worker verification failed: ' + JSON.stringify(result));
                workerLifecycle.push({ workload, ...result });
            }
            await evaluate(connection, `window.rendererLab.setWorkload('1,4')`);
        }
        const selectedWorkload = process.argv.find(arg => arg.startsWith('--workload='))?.slice('--workload='.length);
        if(selectedWorkload) await evaluate(connection, `window.rendererLab.setWorkload(${JSON.stringify(selectedWorkload)})`);
        else if(process.argv.includes('--rig-scene')) await evaluate(connection, `window.rendererLab.setWorkload('rig-scene,1')`);
        else if(!software) await evaluate(connection, `window.rendererLab.setWorkload('10,40')`);
        // Exercise the actual long-run UI without waiting for the entire selected run.
        await evaluate(connection, `(() => {
            const input = document.querySelector('#samples'); input.value = '7200';
            document.querySelector('#measure').click();
        })()`);
        await waitFor(async () => evaluate(connection, `!document.querySelector('#cancel-measure').hidden && !document.querySelector('#cancel-measure').disabled`), 'measurement cancellation control');
        await evaluate(connection, `document.querySelector('#cancel-measure').click()`);
        await waitFor(async () => evaluate(connection, `document.querySelector('#cancel-measure').hidden && !document.querySelector('#measure').disabled`), 'cancelled measurement cleanup');
        if(!(await evaluate(connection, `document.querySelector('#status').textContent.includes('cancelled')`))) throw new Error('Cancelled measurement was reported as complete.');
        const samples = Number(process.argv.find(arg => arg.startsWith('--samples='))?.slice('--samples='.length) ?? 90);
        if(!Number.isInteger(samples) || samples < 30 || samples > 7200) throw new Error('Use 30–7200 samples.');
        const measurement = process.argv.includes('--verify-only') ? undefined : await evaluate(connection, `window.rendererLab.measure(${samples})`);
        if(measurement) for(const result of measurement.results) {
            if(result.backend !== 'svg' && !result.unavailable && (!Number.isFinite(result.finalGpuDrainMs) || result.finalGpuDrainMs < 0)) {
                throw new Error('GPU measurement omitted its final queue-drain diagnostic.');
            }
        }
        if(process.argv.includes('--screenshot')) {
            await evaluate(connection, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            const screenshot = await connection.command('Page.captureScreenshot', { format: 'png' });
            await writeFile('/tmp/svg-renderer-lab.png', Buffer.from(screenshot.result!['data'], 'base64'));
        }
        if(!verification.skipped) {
            // Keep the independent static-preview interaction check outside the heavy scene.
            await evaluate(connection, `window.rendererLab.setWorkload('1,4')`);
            await evaluate(connection, `document.querySelector('#scene-preview').open = true`);
            await waitFor(async () => evaluate(connection, `document.querySelector('#scene-preview [role=status]').textContent.startsWith('Eligible scene.')`), 'scene preview');
            await evaluate(connection, `(() => {
                const root = document.querySelector('#scene-preview'), input = root.querySelector('input');
                input.value = '10'; input.dispatchEvent(new Event('input'));
                if(!root.querySelector('[data-scene-reference] g').getAttribute('transform').includes('10')) throw new Error('Scene transform preview failed.');
                const select = root.querySelector('select'); select.value = String(select.options.length - 1); select.dispatchEvent(new Event('change'));
                if(!root.querySelector('canvas').hidden || !root.querySelector('[role=status]').textContent.startsWith('SVG fallback:')) throw new Error('Scene eligibility fallback failed.');
            })()`);
        }
        await evaluate(connection, 'window.rendererLab.setExperimental(false)');
        if(await evaluate(connection, `window.rendererLab.experimentalEnabled || !document.querySelector('#worker-view').hidden || !document.querySelector('#gpu').parentElement.hidden || !document.querySelector('#scene-preview canvas').hidden`)) throw new Error('Disabling the experiment left a GPU surface active.');
        if(!(await evaluate(connection, 'window.rendererLab.verify()')).skipped) throw new Error('GPU verification bypassed opt-in.');
        if(!verification.skipped) {
            await evaluate(connection, 'window.rendererLab.setExperimental(true)');
            const restarted = await evaluate(connection, 'window.rendererLab.verifyWorker()');
            if(restarted.skipped || !restarted.passed) throw new Error('Experimental renderer re-enable failed.');
        }
        if(browserErrors.some((event: any) => event.method === 'Runtime.exceptionThrown')) throw new Error('Uncaught lab browser exception.');
        console.log(JSON.stringify({ cpu: cpus()[0]?.model, softwareRequested: software, hardwareRequested: hardware, verification, workerLifecycle, measurement }, null, 2));
    }
} catch(error) {
    console.error(browserLog, JSON.stringify(browserErrors)); throw error;
} finally {
    socket?.close(); if(chrome) await stopChrome(chrome); await close(server);
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
