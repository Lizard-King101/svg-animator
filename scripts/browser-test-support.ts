import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { Server } from 'node:http';

export interface DevtoolsTarget {
    type: string;
    url: string;
    webSocketDebuggerUrl: string;
}

export interface CdpMessage {
    id?: number;
    method?: string;
    params?: Record<string, any>;
    result?: Record<string, any>;
    error?: { message: string };
}

export async function listen(serverInstance: Server): Promise<number> {
    await new Promise<void>((resolveListen, reject) => {
        serverInstance.once("error", reject);
        serverInstance.listen(0, "127.0.0.1", () => resolveListen());
    });
    const address = serverInstance.address();
    if(!address || typeof address === "string") throw new Error("Web smoke server did not bind to a TCP port.");
    return address.port;
}

export async function close(serverInstance: Server): Promise<void> {
    if(!serverInstance.listening) return;
    await new Promise<void>((resolveClose) => serverInstance.close(() => resolveClose()));
}

export async function stopChrome(process: ReturnType<typeof spawn>): Promise<void> {
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

export async function findChrome(): Promise<string> {
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

export async function readDebugPort(process: ReturnType<typeof spawn>): Promise<number> {
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

export async function findPageTarget(port: number, pageUrl: string): Promise<DevtoolsTarget> {
    let target: DevtoolsTarget | undefined;
    await waitFor(async () => {
        const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()) as DevtoolsTarget[];
        target = targets.find((candidate) => candidate.type === "page" && candidate.url === pageUrl);
        return Boolean(target);
    }, "Chrome page target");
    return target!;
}

export async function connectCdp(url: string): Promise<{
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

export async function evaluate(connection: Awaited<ReturnType<typeof connectCdp>>, expression: string): Promise<any> {
    const response = await connection.command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const details = response.result?.["exceptionDetails"];
    if(details) throw new Error(formatException(details));
    return response.result?.["result"]?.value;
}

export async function waitFor(check: () => Promise<boolean>, description: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while(Date.now() < deadline) {
        try { if(await check()) return; }
        catch { /* The page or DevTools endpoint may still be loading. */ }
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error(`Timed out waiting for ${description}.`);
}

export function formatException(details: any): string {
    return String(details?.exception?.description ?? details?.text ?? details?.entry?.text ?? "Unknown browser exception");
}
