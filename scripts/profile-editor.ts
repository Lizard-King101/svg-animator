import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { cpus, tmpdir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
import { listen, close, stopChrome, findChrome, readDebugPort, findPageTarget, connectCdp, evaluate, waitFor } from './browser-test-support';

// Isolated production/development bundle measurement. No dependency on Angular debug APIs.
const directory = resolve(process.argv[2] ?? 'dist/svg-animator/browser'), fixture = process.argv[3];
if(!fixture) throw new Error('Usage: profile-editor <built-browser-directory> <project.json> [--trace]');
const trace = process.argv.includes('--trace'), milliseconds = 15000;
const server = createServer(async (request, response) => {
    try {
        const name = new URL(request.url!, 'http://localhost').pathname;
        const file = resolve(directory, name === '/' ? 'index.html' : '.' + name);
        if(file !== directory && !file.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
        let body: Buffer;
        if(name === '/fixture.json') body = await readFile(fixture);
        else try { body = await readFile(file); } catch { body = await readFile(resolve(directory, 'index.html')); }
        const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
        response.setHeader('Content-Type', types[extname(name)] ?? 'text/html'); response.end(body);
    } catch { response.writeHead(500).end(); }
});
const profile = await mkdtemp(resolve(tmpdir(), 'svg-performance-'));
let chrome: ReturnType<typeof spawn> | undefined, socket: WebSocket | undefined;
try {
    const url = `http://127.0.0.1:${await listen(server)}/`;
    chrome = spawn(await findChrome(), ['--headless', '--no-sandbox', '--disable-background-timer-throttling', '--window-size=1600,1000', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url], { stdio: ['ignore', 'ignore', 'pipe'] });
    const target = await findPageTarget(await readDebugPort(chrome), url), connection = await connectCdp(target.webSocketDebuggerUrl); socket = connection.socket;
    const errors: unknown[] = [], events: any[] = [];
    let traceComplete = false;
    connection.onEvent(message => {
        if(message.method === 'Runtime.exceptionThrown') errors.push(message.params);
        if(message.method === 'Tracing.dataCollected') events.push(...message.params!['value']);
        if(message.method === 'Tracing.tracingComplete') traceComplete = true;
    });
    await connection.command('Runtime.enable'); await connection.command('Performance.enable');
    await waitFor(async () => evaluate(connection, `!!document.querySelector('input[type=file]')`), 'home');
    await evaluate(connection, `(async()=>{
        const text=await (await fetch('/fixture.json')).text(), data=new DataTransfer();
        data.items.add(new File([text],'Performance project.json',{type:'application/json'}));
        const input=document.querySelector('input[type=file]'); input.files=data.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await waitFor(async () => evaluate(connection, `!!document.querySelector('.import-notice.success')`), 'project import');
    await evaluate(connection, `document.querySelector('.card-open').click()`);
    await waitFor(async () => evaluate(connection, `location.pathname==='/editor'`), 'editor navigation');
    const editorUrl = await evaluate(connection, `location.href+'&performance=1'`);
    await connection.command('Page.navigate', { url: editorUrl });
    await waitFor(async () => evaluate(connection, `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Animate')`), 'editor');
    await evaluate(connection, `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Animate').click()`);
    await waitFor(async () => evaluate(connection, `!!document.querySelector('button[title="Play"]')`), 'timeline');
    const refreshInterval = await evaluate(connection, `new Promise(resolve=>{
        const intervals=[];let last;function frame(t){if(last!==undefined)intervals.push(t-last);last=t;
        if(intervals.length<45)requestAnimationFrame(frame);else {intervals.sort((a,b)=>a-b);resolve(intervals[22]);}}requestAnimationFrame(frame);
    })`);
    await evaluate(connection, `document.querySelector('button[title="Play"]').click()`);
    await new Promise(resolveWait => setTimeout(resolveWait, 2000));
    if(trace) {
        await connection.command('Profiler.enable'); await connection.command('Profiler.start');
        await connection.command('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        await connection.command('Tracing.start', { categories: 'devtools.timeline,v8,disabled-by-default-v8.gc', transferMode: 'ReportEvents' });
    }
    const before = (await connection.command('Performance.getMetrics')).result;
    await evaluate(connection, `window.svgAnimatorPerformance?.start(${refreshInterval})`);
    const frames = await evaluate(connection, `new Promise(resolve=>{
        const intervals=[]; let last,start;
        function frame(t){if(last!==undefined)intervals.push(t-last);last=t;start??=t;
            if(t-start<${milliseconds})requestAnimationFrame(frame);
            else {intervals.sort((a,b)=>a-b);const interval=${refreshInterval};
                resolve({samples:intervals.length,interval,p95:intervals[Math.floor(intervals.length*.95)],p99:intervals[Math.floor(intervals.length*.99)],maximum:intervals.at(-1),lateFrames:intervals.filter(v=>v>interval*1.5).length,missedRefreshes:intervals.reduce((n,v)=>n+Math.max(0,Math.round(v/interval)-1),0)});}
        }requestAnimationFrame(frame);
    })`);
    const application = await evaluate(connection, `window.svgAnimatorPerformance?.report()`);
    await evaluate(connection, `window.svgAnimatorPerformance?.stop();document.querySelector('button[title="Pause"]').click()`);
    const after = (await connection.command('Performance.getMetrics')).result;
    let allocations: unknown, gc: unknown, cpuProfile: unknown, browserWork: unknown;
    if(trace) {
        const cpu = (await connection.command('Profiler.stop')).result!['profile'];
        const counts = new Map<number, number>();
        for(const sample of cpu.samples) counts.set(sample, (counts.get(sample) ?? 0) + 1);
        cpuProfile = cpu.nodes.map((node: any) => ({ function: node.callFrame.functionName, url: node.callFrame.url, samples: counts.get(node.id) ?? 0 }))
            .sort((a: any, b: any) => b.samples - a.samples).slice(0, 20);
        const heap = (await connection.command('HeapProfiler.stopSampling')).result!['profile'];
        const bytes = (node: any): number => node.selfSize + node.children.reduce((sum: number, child: any) => sum + bytes(child), 0);
        allocations = { estimatedAllocatedBytes: bytes(heap.head), samplingInterval: 32768, includesCollectedObjects: true };
        await connection.command('Tracing.end'); await waitFor(async () => traceComplete, 'trace completion');
        const main = events.find(event => event.name === 'thread_name' && event.args?.name === 'CrRendererMain');
        const durations = events.filter(event => event.tid === main?.tid && event.ph === 'X' && /^(MinorGC|MajorGC)$/.test(event.name)).map(event => event.dur / 1000);
        browserWork = Object.fromEntries(['Paint', 'PrePaint', 'UpdateLayoutTree', 'Layout', 'CompositeLayers'].map(name => {
            const work = events.filter(event => event.tid === main?.tid && event.ph === 'X' && event.name === name).map(event => event.dur / 1000);
            return [name, { events: work.length, totalMs: work.reduce((a, b) => a + b, 0), maximumMs: Math.max(0, ...work) }];
        }));
        gc = { events: durations.length, totalMs: durations.reduce((a, b) => a + b, 0), maximumMs: Math.max(0, ...durations) };
    }
    if(errors.length) throw new Error(JSON.stringify(errors));
    console.log(JSON.stringify({ fixture: resolve(fixture), build: directory, cpu: cpus()[0]?.model, logicalCores: cpus().length,
        browser: await evaluate(connection, 'navigator.userAgent'), trace, frames, application, before, after, allocations, gc, cpuProfile, browserWork }, null, 2));
} finally {
    socket?.close(); if(chrome) await stopChrome(chrome); await close(server);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
