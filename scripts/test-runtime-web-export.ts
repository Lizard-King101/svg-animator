import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildWebBundleHtml } from "../src/app/editor/export/web-bundle-template";

interface DevtoolsTarget {
    type: string;
    url: string;
    webSocketDebuggerUrl: string;
}

interface CdpMessage {
    id?: number;
    method?: string;
    params?: Record<string, any>;
    result?: Record<string, any>;
    error?: { message: string };
}

const root = resolve(process.cwd());
const fixtureDirectory = resolve(root, "fixtures/runtime-showcase-v1");
const embeddedPage = `<!doctype html>
<meta charset="utf-8">
<title>Embedded Animation SVG</title>
<object id="artwork" data="/embedded-showcase.svg" type="image/svg+xml"></object>
<script src="/runtime/svg-animator-runtime.min.js?v=smoke"></script>
<script>
document.getElementById("artwork").addEventListener("load", () => {
  const root=document.getElementById("artwork").contentDocument.documentElement;
  window.__runtimeEmbeddedSmokePlayer=SVGAnimatorRuntime.createEmbeddedPlayer(root);
}, { once: true });
</script>`;
const routes = new Map<string, { type: string; body: string | Buffer }>([
    ["/", { type: "text/html; charset=utf-8", body: buildWebBundleHtml("Runtime Web Export Minified", { runtimeRevision: "smoke" }) }],
    ["/minified.html", { type: "text/html; charset=utf-8", body: buildWebBundleHtml("Runtime Web Export Minified", { runtimeRevision: "smoke" }) }],
    ["/unminified.html", { type: "text/html; charset=utf-8", body: buildWebBundleHtml("Runtime Web Export Unminified", { runtimeFilename: "svg-animator-runtime.js", runtimeRevision: "smoke" }) }],
    ["/embedded.html", { type: "text/html; charset=utf-8", body: embeddedPage }],
    ["/animation.json", { type: "application/json", body: await readFile(resolve(fixtureDirectory, "runtime-bundle-v1.json")) }],
    ["/artwork.svg", { type: "image/svg+xml", body: await readFile(resolve(fixtureDirectory, "runtime-artwork.svg")) }],
    ["/embedded-showcase.svg", { type: "image/svg+xml", body: await readFile(resolve(fixtureDirectory, "embedded-showcase.svg")) }],
    ["/runtime/svg-animator-runtime.min.js", { type: "text/javascript; charset=utf-8", body: await readFile(resolve(root, "packages/runtime/dist/svg-animator-runtime.min.js")) }],
    ["/runtime/svg-animator-runtime.min.js.map", { type: "application/json", body: await readFile(resolve(root, "packages/runtime/dist/svg-animator-runtime.min.js.map")) }],
    ["/runtime/svg-animator-runtime.js", { type: "text/javascript; charset=utf-8", body: await readFile(resolve(root, "packages/runtime/dist/svg-animator-runtime.js")) }],
    ["/runtime/svg-animator-runtime.js.map", { type: "application/json", body: await readFile(resolve(root, "packages/runtime/dist/svg-animator-runtime.js.map")) }],
]);

const server = createServer((request, response) => {
    if(request.url === "/favicon.ico") { response.writeHead(204).end(); return; }
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const route = routes.get(pathname);
    if(!route) { response.writeHead(404).end("Not found"); return; }
    response.writeHead(200, { "Content-Type": route.type, "Cache-Control": "no-store" });
    response.end(route.body);
});
const profileDirectory = await mkdtemp(resolve(tmpdir(), "svg-animator-web-smoke-"));
let chrome: ReturnType<typeof spawn> | undefined;
let socket: WebSocket | undefined;

try {
    const port = await listen(server);
    const pageUrl = `http://127.0.0.1:${port}/`;
    const executable = await findChrome();
    chrome = spawn(executable, [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-timer-throttling",
        "--remote-debugging-port=0",
        `--user-data-dir=${profileDirectory}`,
        pageUrl,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    const debugPort = await readDebugPort(chrome);
    const target = await findPageTarget(debugPort, pageUrl);
    const connection = await connectCdp(target.webSocketDebuggerUrl);
    socket = connection.socket;
    const errors: string[] = [];
    connection.onEvent((message) => {
        if(message.method === "Runtime.exceptionThrown") errors.push(formatException(message.params));
        if(message.method === "Log.entryAdded" && message.params?.["entry"]?.level === "error") errors.push(String(message.params["entry"].text));
    });

    await connection.command("Runtime.enable");
    await connection.command("Log.enable");
    await connection.command("Page.enable");
    const minifiedTime = await exercisePage(connection, `${pageUrl}minified.html`, "Minified", errors);
    const unminifiedTime = await exercisePage(connection, `${pageUrl}unminified.html`, "Unminified", errors);
    const embeddedTime = await exerciseEmbeddedPage(connection, `${pageUrl}embedded.html`, errors);
    console.log(`Runtime web smoke tests passed for minified (${minifiedTime.toFixed(3)}s), unminified (${unminifiedTime.toFixed(3)}s), and embedded-animation (${embeddedTime.toFixed(3)}s) exports.`);
} finally {
    socket?.close();
    if(chrome) await stopChrome(chrome);
    await close(server);
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function listen(serverInstance: Server): Promise<number> {
    await new Promise<void>((resolveListen, reject) => {
        serverInstance.once("error", reject);
        serverInstance.listen(0, "127.0.0.1", () => resolveListen());
    });
    const address = serverInstance.address();
    if(!address || typeof address === "string") throw new Error("Web smoke server did not bind to a TCP port.");
    return address.port;
}

async function close(serverInstance: Server): Promise<void> {
    if(!serverInstance.listening) return;
    await new Promise<void>((resolveClose) => serverInstance.close(() => resolveClose()));
}

async function stopChrome(process: ReturnType<typeof spawn>): Promise<void> {
    if(process.exitCode != null) return;
    const exited = new Promise<void>((resolveExit) => process.once("exit", () => resolveExit()));
    process.kill("SIGTERM");
    await Promise.race([
        exited,
        new Promise<void>((resolveWait) => setTimeout(resolveWait, 2_000)),
    ]);
    if(process.exitCode == null) {
        process.kill("SIGKILL");
        await exited;
    }
}

async function findChrome(): Promise<string> {
    const candidates = [
        process.env["CHROME_BIN"],
        "/opt/google/chrome/google-chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ].filter((candidate): candidate is string => Boolean(candidate));
    for(const candidate of candidates) {
        try { await access(candidate, constants.X_OK); return candidate; }
        catch { /* Try the next supported Chrome location. */ }
    }
    throw new Error("Chrome was not found. Set CHROME_BIN to run the Runtime Web Bundle smoke test.");
}

async function readDebugPort(process: ReturnType<typeof spawn>): Promise<number> {
    return new Promise<number>((resolvePort, reject) => {
        const timer = setTimeout(() => reject(new Error("Chrome DevTools did not start within 10 seconds.")), 10_000);
        process.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited before DevTools started (${code}).`)); });
        process.stderr?.setEncoding("utf8");
        process.stderr?.on("data", (chunk: string) => {
            const match = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(chunk);
            if(!match) return;
            clearTimeout(timer);
            resolvePort(Number(match[1]));
        });
    });
}

async function findPageTarget(port: number, pageUrl: string): Promise<DevtoolsTarget> {
    let target: DevtoolsTarget | undefined;
    await waitFor(async () => {
        const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()) as DevtoolsTarget[];
        target = targets.find((candidate) => candidate.type === "page" && candidate.url === pageUrl);
        return Boolean(target);
    }, "Chrome page target");
    return target!;
}

async function connectCdp(url: string): Promise<{
    socket: WebSocket;
    command: (method: string, params?: Record<string, unknown>) => Promise<CdpMessage>;
    onEvent: (listener: (message: CdpMessage) => void) => void;
}> {
    const webSocket = new WebSocket(url);
    await new Promise<void>((resolveOpen, reject) => {
        webSocket.addEventListener("open", () => resolveOpen(), { once: true });
        webSocket.addEventListener("error", () => reject(new Error("Could not connect to Chrome DevTools.")), { once: true });
    });
    let nextId = 1;
    const pending = new Map<number, { resolve: (message: CdpMessage) => void; reject: (error: Error) => void }>();
    const listeners = new Set<(message: CdpMessage) => void>();
    webSocket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as CdpMessage;
        if(message.id != null) {
            const request = pending.get(message.id);
            if(request) {
                pending.delete(message.id);
                if(message.error) request.reject(new Error(message.error.message)); else request.resolve(message);
            }
        } else listeners.forEach((listener) => listener(message));
    });
    return {
        socket: webSocket,
        command(method, params = {}) {
            const id = nextId++;
            webSocket.send(JSON.stringify({ id, method, params }));
            return new Promise<CdpMessage>((resolveCommand, reject) => pending.set(id, { resolve: resolveCommand, reject }));
        },
        onEvent(listener) { listeners.add(listener); },
    };
}

async function evaluate(connection: Awaited<ReturnType<typeof connectCdp>>, expression: string): Promise<any> {
    const response = await connection.command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const details = response.result?.["exceptionDetails"];
    if(details) throw new Error(formatException(details));
    return response.result?.["result"]?.value;
}

async function exercisePage(connection: Awaited<ReturnType<typeof connectCdp>>, url: string, label: string, errors: string[]): Promise<number> {
    errors.length = 0;
    await connection.command("Page.navigate", { url });
    await waitFor(async () => Boolean(await evaluate(connection, `document.title.endsWith(${JSON.stringify(label)}) && typeof document.getElementById('play')?.onclick === 'function'`)), `${label} generated player controls to mount`);
    if(errors.length) throw new Error(`${label} generated page failed during mount:\n${errors.join("\n")}`);
    const started = await evaluate(connection, "window.__runtimeWebSmokePlayer=document.getElementById('play').onclick();({state:__runtimeWebSmokePlayer.state,time:__runtimeWebSmokePlayer.time})");
    if(started?.state !== "playing") throw new Error(`${label} Play control did not start the runtime player: ${JSON.stringify(started)}`);
    await waitFor(async () => Number((await evaluate(connection, "__runtimeWebSmokePlayer.time")) ?? 0) > 0, `${label} runtime playback to advance`);
    const advanced = await evaluate(connection, "({state:__runtimeWebSmokePlayer.state,time:__runtimeWebSmokePlayer.time})");
    if(advanced?.state !== "playing" || !(advanced.time > 0)) throw new Error(`${label} runtime playback did not remain active: ${JSON.stringify(advanced)}`);
    const sought = await evaluate(connection, "__runtimeWebSmokePlayer.pause().seek(__runtimeWebSmokePlayer.duration/2);({state:__runtimeWebSmokePlayer.state,time:__runtimeWebSmokePlayer.time,duration:__runtimeWebSmokePlayer.duration})");
    if(sought?.state !== "paused" || sought.time !== sought.duration / 2) throw new Error(`${label} runtime controls failed after playback: ${JSON.stringify(sought)}`);
    if(errors.length) throw new Error(`${label} generated page emitted browser errors:\n${errors.join("\n")}`);
    return Number(advanced.time);
}

async function exerciseEmbeddedPage(connection: Awaited<ReturnType<typeof connectCdp>>, url: string, errors: string[]): Promise<number> {
    errors.length = 0;
    await connection.command("Page.navigate", { url });
    await waitFor(async () => Boolean(await evaluate(connection, "window.__runtimeEmbeddedSmokePlayer")), "embedded-animation player to mount");
    if(errors.length) throw new Error(`Embedded Animation SVG failed during mount:\n${errors.join("\n")}`);
    const mounted = await evaluate(connection, "({state:__runtimeEmbeddedSmokePlayer.state,time:__runtimeEmbeddedSmokePlayer.time,duration:__runtimeEmbeddedSmokePlayer.duration})");
    if(mounted?.state !== "paused" || mounted.time !== 0 || !(mounted.duration > 0)) throw new Error(`Embedded Animation SVG did not mount paused: ${JSON.stringify(mounted)}`);
    await evaluate(connection, "__runtimeEmbeddedSmokePlayer.play()");
    await waitFor(async () => Number((await evaluate(connection, "__runtimeEmbeddedSmokePlayer.time")) ?? 0) > 0, "embedded-animation playback to advance");
    const advanced = await evaluate(connection, "__runtimeEmbeddedSmokePlayer.pause();({state:__runtimeEmbeddedSmokePlayer.state,time:__runtimeEmbeddedSmokePlayer.time})");
    if(advanced?.state !== "paused" || !(advanced.time > 0)) throw new Error(`Embedded Animation SVG playback failed: ${JSON.stringify(advanced)}`);
    if(errors.length) throw new Error(`Embedded Animation SVG emitted browser errors:\n${errors.join("\n")}`);
    return Number(advanced.time);
}

async function waitFor(check: () => Promise<boolean>, description: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while(Date.now() < deadline) {
        try { if(await check()) return; }
        catch { /* The page or DevTools endpoint may still be loading. */ }
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error(`Timed out waiting for ${description}.`);
}

function formatException(details: any): string {
    return String(details?.exception?.description ?? details?.text ?? details?.entry?.text ?? "Unknown browser exception");
}
